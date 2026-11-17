import sqlite from 'sqlite3';

import { DB_PATH } from '../../db/db.js';
import { dbGet, dbRun } from '../../utils/dbHelpers.js';
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