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

        for (const [index, member] of hike.members.entries()) {
            await dbRun(`
                INSERT INTO hike_members (
                    hike_id,
                    position,
                    name,
                    phone
                )
                VALUES (?, ?, ?, ?)
            `, [
                hikeId,
                index + 1,
                member.name,
                member.phone
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


// Columns of a hike and of its hiker, in the format read by buildHikes
const HIKE_COLUMNS = `
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
`;

// Passage points of the given hikes, in the order of the route: Map hikeId -> [name]
const getPassagesByHikeId = async (hikeIds) => {
    const passagesByHikeId = new Map();

    if (hikeIds.length === 0) {
        return passagesByHikeId;
    }

    const placeholders = hikeIds.map(() => '?').join(', ');

    const passageRows = await dbAll(`
        SELECT hike_id AS hikeId, name
        FROM hike_passages
        WHERE hike_id IN (${placeholders})
        ORDER BY hike_id ASC, position ASC
    `, hikeIds);

    for (const passage of passageRows) {
        if (!passagesByHikeId.has(passage.hikeId)) {
            passagesByHikeId.set(passage.hikeId, []);
        }
        passagesByHikeId.get(passage.hikeId).push(passage.name);
    }

    return passagesByHikeId;
};

// Party members of the given hikes, in the order they were given: Map hikeId -> [{ name, phone }]
const getMembersByHikeId = async (hikeIds) => {
    const membersByHikeId = new Map();

    if (hikeIds.length === 0) {
        return membersByHikeId;
    }

    const placeholders = hikeIds.map(() => '?').join(', ');

    const memberRows = await dbAll(`
        SELECT hike_id AS hikeId, name, phone
        FROM hike_members
        WHERE hike_id IN (${placeholders})
        ORDER BY hike_id ASC, position ASC
    `, hikeIds);

    for (const member of memberRows) {
        if (!membersByHikeId.has(member.hikeId)) {
            membersByHikeId.set(member.hikeId, []);
        }
        membersByHikeId.get(member.hikeId).push({ name: member.name, phone: member.phone ?? null });
    }

    return membersByHikeId;
};

// Hikes with their hiker, passage points and party members, from rows selected with HIKE_COLUMNS
const buildHikes = async (hikeRows, nowMs) => {
    const hikeIds = hikeRows.map(row => row.hikeId);
    const passagesByHikeId = await getPassagesByHikeId(hikeIds);
    const membersByHikeId = await getMembersByHikeId(hikeIds);

    return hikeRows.map(row => ({
        hikeId: row.hikeId,
        destination: row.destination,
        route: row.route,
        passages: passagesByHikeId.get(row.hikeId) ?? [],
        scheduledDeparture: row.scheduledDeparture,
        expectedArrival: row.expectedArrival,
        partySize: row.partySize,
        members: membersByHikeId.get(row.hikeId) ?? [],
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

export const getActiveHikes = async () => {
    const nowIso = new Date().toISOString();

    const hikeRows = await dbAll(`
        SELECT ${HIKE_COLUMNS}
        FROM hikes h
        JOIN users u ON u.user_id = h.user_id
        WHERE h.status = 'scheduled'
          AND h.scheduled_departure <= ?
        ORDER BY h.expected_arrival ASC
    `, [nowIso]);

    return buildHikes(hikeRows, Date.parse(nowIso));
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

    const hikeIds = hikeRows.map(row => row.hikeId);
    const passagesByHikeId = await getPassagesByHikeId(hikeIds);
    const membersByHikeId = await getMembersByHikeId(hikeIds);

    return hikeRows.map(row => ({
        hikeId: row.hikeId,
        destination: row.destination,
        route: row.route,
        passages: passagesByHikeId.get(row.hikeId) ?? [],
        scheduledDeparture: row.scheduledDeparture,
        expectedArrival: row.expectedArrival,
        partySize: row.partySize,
        members: membersByHikeId.get(row.hikeId) ?? [],
        status: row.status,
        createdAt: row.createdAt
    }));
};


// Alerts for the hikers who have not recorded the end of the hike (see utils/missingHikeRules.js)

// Scheduled hikes whose expected return time is not after the given instant (ISO 8601, UTC)
export const getOverdueScheduledHikes = async (cutoffIso) => {
    return dbAll(`
        SELECT hike_id AS hikeId, expected_arrival AS expectedArrival
        FROM hikes
        WHERE status = 'scheduled'
          AND expected_arrival <= ?
    `, [cutoffIso]);
};

/**
 * Saves an alert of a hike. Returns false if that alert was already saved, so an alert
 * is never created twice, not even if the check runs again.
 */
export const createHikeAlert = async (hikeId, alertNumber, createdAtIso) => {
    const result = await dbRun(`
        INSERT OR IGNORE INTO hike_alerts (hike_id, alert_number, created_at)
        VALUES (?, ?, ?)
    `, [hikeId, alertNumber, createdAtIso]);

    return result.changes === 1;
};

export const markAlertEmailSent = async (hikeId, alertNumber, sentAtIso) => {
    await dbRun(`
        UPDATE hike_alerts
        SET email_sent_at = ?
        WHERE hike_id = ? AND alert_number = ?
    `, [sentAtIso, hikeId, alertNumber]);
};

// Scheduled hikes with their last alert (alertNumber, lastAlertAt), the oldest return first
const getHikesWithLastAlert = async ({ onlyEmailToSend = false } = {}) => {
    const hikeRows = await dbAll(`
        SELECT
            ${HIKE_COLUMNS},
            a.alert_number AS alertNumber,
            a.created_at AS lastAlertAt
        FROM hike_alerts a
        JOIN hikes h ON h.hike_id = a.hike_id
        JOIN users u ON u.user_id = h.user_id
        WHERE h.status = 'scheduled'
          AND a.alert_number = (
              SELECT MAX(alert_number) FROM hike_alerts WHERE hike_id = a.hike_id
          )
          ${onlyEmailToSend ? 'AND a.email_sent_at IS NULL' : ''}
        ORDER BY h.expected_arrival ASC
    `);

    const hikes = await buildHikes(hikeRows, Date.now());

    return hikes.map((hike, index) => ({
        ...hike,
        alertNumber: hikeRows[index].alertNumber,
        lastAlertAt: hikeRows[index].lastAlertAt
    }));
};

// Hikers considered missing: not back yet and with at least one alert
export const getMissingHikes = () => getHikesWithLastAlert();

// Hikes whose last alert has not been emailed yet (the email is tried again until it is sent)
export const getHikesWithEmailToSend = () => getHikesWithLastAlert({ onlyEmailToSend: true });

// Emails of the wardens, who receive the alerts
export const getWardenEmails = async () => {
    const rows = await dbAll(`
        SELECT email
        FROM users
        WHERE role = 'warden'
        ORDER BY user_id ASC
    `);

    return rows.map(row => row.email);
};
