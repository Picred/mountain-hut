import sqlite from 'sqlite3';
import NotFoundError from '../errors/NotFoundError.js';

import { DB_PATH } from '../../db/db.js';
import { dbAll, dbGet, dbRun } from '../../utils/dbHelpers.js';
import ConflictError from '../errors/ConflictError.js';

export const createHike = async (userId, hike) => {
    const connection = new sqlite.Database(DB_PATH, sqlite.OPEN_READWRITE);
    let transactionStarted = false;

    try {
        await dbRun('PRAGMA foreign_keys = ON', [], connection);
        await dbRun('BEGIN IMMEDIATE', [], connection);
        transactionStarted = true;

        const overlappingHike = await dbGet(`
            SELECT hike_id
            FROM hikes
            WHERE user_id = ?
              AND status = 'scheduled'
              AND scheduled_departure < ?
              AND expected_arrival > ?
            LIMIT 1
        `, [
            userId,
            hike.expectedArrival,
            hike.scheduledDeparture
        ], connection);

        if (overlappingHike) {
            throw new ConflictError('HIKE_TIME_CONFLICT');
        }

        const result = await dbRun(`
            INSERT INTO hikes (
                user_id,
                destination,
                route,
                scheduled_departure,
                expected_arrival,
                party_size
            )
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            userId,
            hike.destination,
            hike.route,
            hike.scheduledDeparture,
            hike.expectedArrival,
            hike.partySize
        ], connection);

        const hikeId = result.lastID;

        for (const [index, passage] of hike.passages.entries()) {
            await dbRun(`
                INSERT INTO hike_passages (
                    hike_id,
                    position,
                    name
                )
                VALUES (?, ?, ?)
            `, [
                hikeId,
                index + 1,
                passage
            ], connection);
        }

        await dbRun('COMMIT', [], connection);
        transactionStarted = false;

        return {
            hikeId,
            userId,
            ...hike,
            status: 'scheduled'
        };

    } catch (err) {
        if (transactionStarted) {
            try {
                await dbRun('ROLLBACK', [], connection);
            } catch (rollbackErr) {
                console.error('Rollback failed:', rollbackErr);
            }
        }

        throw err;

    } finally {
        await new Promise(resolve => {
            connection.close(err => {
                if (err) {
                    console.error('Failed to close database connection:', err);
                }
                resolve();
            });
        });
    }
};

export const getActiveHikes = async () => {
    const nowIso = new Date().toISOString();

    const hikeRows = await dbAll(`
        SELECT
            h.hike_id AS hikeId,
            h.destination,
            h.route,
            h.scheduled_departure AS scheduledDeparture,
            h.expected_arrival AS expectedArrival,
            h.party_size AS partySize,
            h.status,
            h.created_at AS createdAt,
            u.user_id AS userId,
            u.name AS hikerName,
            u.email AS hikerEmail,
            u.phone AS hikerPhone,
            u.notes AS hikerNotes,
            u.emergency_contact AS hikerEmergencyContact
        FROM hikes h
        JOIN users u ON u.user_id = h.user_id
        WHERE h.status = 'scheduled'
          AND h.scheduled_departure <= ?
        ORDER BY h.expected_arrival ASC
    `, [nowIso]);

    if (hikeRows.length === 0) {
        return [];
    }

    const hikeIds = hikeRows.map(row => row.hikeId);
    const placeholders = hikeIds.map(() => '?').join(', ');

    const passageRows = await dbAll(`
        SELECT hike_id AS hikeId, name
        FROM hike_passages
        WHERE hike_id IN (${placeholders})
        ORDER BY hike_id ASC, position ASC
    `, hikeIds);

    const passagesByHikeId = new Map();
    for (const passage of passageRows) {
        if (!passagesByHikeId.has(passage.hikeId)) {
            passagesByHikeId.set(passage.hikeId, []);
        }
        passagesByHikeId.get(passage.hikeId).push(passage.name);
    }

    const nowMs = Date.parse(nowIso);

    return hikeRows.map(row => ({
        hikeId: row.hikeId,
        destination: row.destination,
        route: row.route,
        passages: passagesByHikeId.get(row.hikeId) ?? [],
        scheduledDeparture: row.scheduledDeparture,
        expectedArrival: row.expectedArrival,
        partySize: row.partySize,
        status: row.status,
        createdAt: row.createdAt,
        isOverdue: Date.parse(row.expectedArrival) < nowMs,
        hiker: {
            userId: row.userId,
            name: row.hikerName,
            email: row.hikerEmail,
            phone: row.hikerPhone,
            notes: row.hikerNotes ?? null,
            emergencyContact: row.hikerEmergencyContact ?? null
        }
    }));
};


export const confirmSafeArrival = async (userId, hikeId) => {
    const hike = await dbGet(`
        SELECT status
        FROM hikes
        WHERE hike_id = ? AND user_id = ?
    `, [hikeId, userId]);

    if (!hike) {
        throw new NotFoundError('HIKE_NOT_FOUND');
    }

    const result = await dbRun(`
        UPDATE hikes
        SET status = 'returned'
        WHERE hike_id = ?
          AND user_id = ?
          AND status = 'scheduled'
    `, [hikeId, userId]);

    if (result.changes !== 1) {
        throw new ConflictError('HIKE_ALREADY_CONFIRMED');
    }

    return {
        hikeId,
        userId,
        status: 'returned'
    };
};


export const getHikersHikes = async (userId) => {

    const hikeRows = await dbAll(`
        SELECT
            hike_id AS hikeId,
            destination,
            route,
            scheduled_departure AS scheduledDeparture,
            expected_arrival AS expectedArrival,
            party_size AS partySize,
            status,
            created_at AS createdAt
        FROM hikes
        WHERE user_id = ?
        ORDER BY scheduled_departure ASC
    `, [userId]);

    if (hikeRows.length === 0) {
        return [];
    }

    const hikeIds = hikeRows.map(row => row.hikeId);
    const placeholders = hikeIds.map(() => '?').join(', ');

    const passageRows = await dbAll(`
        SELECT hike_id AS hikeId, name
        FROM hike_passages
        WHERE hike_id IN (${placeholders})
        ORDER BY hike_id ASC, position ASC
    `, hikeIds);

    const passagesByHikeId = new Map();

    for (const passage of passageRows) {
        if (!passagesByHikeId.has(passage.hikeId)) {
            passagesByHikeId.set(passage.hikeId, []);
        }

        passagesByHikeId.get(passage.hikeId).push(passage.name);
    }

    return hikeRows.map(row => ({
        hikeId: row.hikeId,
        destination: row.destination,
        route: row.route,
        passages: passagesByHikeId.get(row.hikeId) ?? [],
        scheduledDeparture: row.scheduledDeparture,
        expectedArrival: row.expectedArrival,
        partySize: row.partySize,
        status: row.status,
        createdAt: row.createdAt
    }));
};
