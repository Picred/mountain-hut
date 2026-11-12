import sqlite from 'sqlite3';

import { DB_PATH } from '../../db/db.js';
import { dbAll, dbGet, dbRun } from '../../utils/dbHelpers.js';
import { runExclusive } from '../../utils/transactionQueue.js';

import BadRequestError from '../errors/BadRequestError.js';
import NotFoundError from '../errors/NotFoundError.js';
import ConflictError from '../errors/ConflictError.js';


const toUtcIso = value => new Date(value).toISOString();

const SLOT_SELECT = `
    SELECT
        s.slot_id,
        s.start_at,
        s.end_at,
        t.table_id,
        t.table_code,
        t.seats
    FROM slots s
    LEFT JOIN slot_tables st ON st.slot_id = s.slot_id
    LEFT JOIN tables t ON t.table_id = st.table_id
`;

// a slot without tables has hasTables = false and totalSeats = 0

const buildSlots = rows => {
    const slots = new Map();

    for (const row of rows) {
        if (!slots.has(row.slot_id)) {
            slots.set(row.slot_id, {
                slotId: row.slot_id,
                startAt: row.start_at,
                endAt: row.end_at,
                hasTables: false,
                totalSeats: 0,
                tables: []
            });
        }

        if (row.table_id !== null) {
            const slot = slots.get(row.slot_id);
            slot.tables.push({
                tableId: row.table_id,
                code: row.table_code,
                seats: row.seats
            });
            slot.totalSeats += row.seats;
            slot.hasTables = true;
        }
    }

    return [...slots.values()];
};

/**
 * retrieves all slots (also the ones without tables) with their tables and total seats
 * dates managed as in getSlotsByDate
 */
export const listSlots = async ({ from, to } = {}) => {
    const conditions = [];
    const params = [];

    if (from) {
        conditions.push("DATE(s.start_at, 'localtime') >= ?");
        params.push(from);
    }
    if (to) {
        conditions.push("DATE(s.start_at, 'localtime') <= ?");
        params.push(to);
    }

    const rows = await dbAll(`
        ${SLOT_SELECT}
        ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
        ORDER BY s.start_at, t.table_code, t.seats
    `, params);

    return buildSlots(rows);
};

export const getSlot = async slotId => {
    const rows = await dbAll(`
        ${SLOT_SELECT}
        WHERE s.slot_id = ?
        ORDER BY t.table_code, t.seats
    `, [slotId]);

    return buildSlots(rows)[0];
};

/**
 * creates a slot (no tables, 0 seats) that:
 * - start in the future
 * - end after its start
 * - not overlap another slot (which also rules out identical duplicates)
 */
export const createSlot = async (startAt, endAt) => {
    const start = toUtcIso(startAt);
    const end = toUtcIso(endAt);

    if (end <= start) {
        throw new BadRequestError('INVALID_TIME_RANGE');
    }
    if (start <= new Date().toISOString()) {
        throw new BadRequestError('SLOT_IN_THE_PAST');
    }

    const result = await dbRun(`
        INSERT INTO slots (start_at, end_at)
        SELECT ?, ?
        WHERE NOT EXISTS (
            SELECT 1 FROM slots WHERE start_at < ? AND end_at > ?
        )
    `, [start, end, end, start]);

    if (result.changes === 0) {
        throw new ConflictError('SLOT_OVERLAP');
    }

    return getSlot(result.lastID);
};

/**
 * adds tables of the catalog to a slot:
 * - the slot must not have reservations (cancelled are ok)
 * - not two tables with the same code (yes in catalog, not in the same slot)
 *
 * all tables are inserted by a single statement: either all or none
 */
export const addTablesToSlot = async (slotId, tableIds) => {
    const ids = [...new Set(tableIds)];
    if (ids.length === 0) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const slot = await dbGet('SELECT slot_id FROM slots WHERE slot_id = ?', [slotId]);
    if (!slot) {
        throw new NotFoundError('SLOT_NOT_FOUND');
    }

    const placeholders = ids.map(() => '?').join(',');
    const wanted = await dbAll(
        `SELECT table_id, table_code FROM tables WHERE table_id IN (${placeholders})`,
        ids
    );
    if (wanted.length !== ids.length) {
        throw new NotFoundError('TABLE_NOT_FOUND');
    }

    const codes = wanted.map(table => table.table_code);
    if (new Set(codes).size !== codes.length) {
        throw new BadRequestError('DUPLICATE_TABLE_CODE');
    }
    const codePlaceholders = codes.map(() => '?').join(',');

    const result = await dbRun(`
        INSERT INTO slot_tables (slot_id, table_id)
        SELECT ?, table_id
        FROM tables
        WHERE table_id IN (${placeholders})
            AND NOT EXISTS (
                SELECT 1 FROM reservations
                WHERE slot_id = ? AND status <> 'cancelled'
            )
            AND NOT EXISTS (
                SELECT 1
                FROM slot_tables st
                JOIN tables t ON t.table_id = st.table_id
                WHERE st.slot_id = ? AND t.table_code IN (${codePlaceholders})
            )
    `, [slotId, ...ids, slotId, slotId, ...codes]);

    if (result.changes === 0) {
        // no insertion: which rule blocked it
        const reservation = await dbGet(`
            SELECT reservation_id
            FROM reservations
            WHERE slot_id = ? AND status <> 'cancelled'
            LIMIT 1
        `, [slotId]);

        throw new ConflictError(
            reservation ? 'SLOT_HAS_RESERVATIONS' : 'TABLE_CODE_ALREADY_IN_SLOT'
        );
    }

    return getSlot(slotId);
};

// copies the tables of another slot into this slot
export const copyTablesToSlot = async (slotId, fromSlotId) => {
    if (slotId === fromSlotId) {
        throw new BadRequestError('SAME_SLOT');
    }

    const source = await dbGet('SELECT slot_id FROM slots WHERE slot_id = ?', [fromSlotId]);
    if (!source) {
        throw new NotFoundError('SOURCE_SLOT_NOT_FOUND');
    }

    const rows = await dbAll('SELECT table_id FROM slot_tables WHERE slot_id = ?', [fromSlotId]);
    if (rows.length === 0) {
        throw new BadRequestError('NO_TABLES_TO_COPY');
    }

    return addTablesToSlot(slotId, rows.map(row => row.table_id));
};

// Copy of a week of slots

// Dates are handled as days of the calendar (YYYY-MM-DD), without time zones
const DAY_MS = 24 * 60 * 60 * 1000;
const toDayNumber = date => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const fromDayNumber = day => new Date(day * DAY_MS).toISOString().slice(0, 10);

// Returns the Monday of the week (Monday to Sunday) that contains the given date
const mondayOf = date => {
    const day = toDayNumber(date);
    const weekday = (new Date(day * DAY_MS).getUTCDay() + 6) % 7; // 0 = Monday
    return fromDayNumber(day - weekday);
};

const SQLITE_VARIABLES_PER_QUERY = 500;

// Retrieves the slots (with their tables) matching the given IDs, in the same format as getSlot
const getSlotsById = async slotIds => {
    const slots = [];

    for (let i = 0; i < slotIds.length; i += SQLITE_VARIABLES_PER_QUERY) {
        const chunk = slotIds.slice(i, i + SQLITE_VARIABLES_PER_QUERY);
        const rows = await dbAll(`
            ${SLOT_SELECT}
            WHERE s.slot_id IN (${chunk.map(() => '?').join(',')})
            ORDER BY s.start_at, t.table_code, t.seats
        `, chunk);

        slots.push(...buildSlots(rows));
    }

    return slots.sort((a, b) => a.startAt.localeCompare(b.startAt));
};

/**
 * Copies the slots of a source week into a single target week:
 * - Weeks run from Monday to Sunday; fromDate and toDate can be any day of the respective week
 * - Tables and menu of each slot can optionally be copied as well
 * - Checks the entire target week: if any slot in the target week has active reservations,
 *   the whole operation is aborted and rolled back
 * - If no slots in the target week have active reservations, all existing slots in the target
 *   week are deleted and replaced by the copied slots
 */
export const copyWeek = (fromDate, toDate, { copyTables = true, copyMenu = true } = {}) =>
    runExclusive(() => copyWeekInTransaction(fromDate, toDate, copyTables, copyMenu));

const copyWeekInTransaction = async (fromDate, toDate, copyTables, copyMenu) => {
    if (
        Number.isNaN(Date.parse(`${fromDate}T00:00:00Z`)) ||
        Number.isNaN(Date.parse(`${toDate}T00:00:00Z`)) ||
        typeof copyTables !== 'boolean' || typeof copyMenu !== 'boolean'
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const fromMonday = mondayOf(fromDate);
    const fromSunday = fromDayNumber(toDayNumber(fromMonday) + 6);

    const toMonday = mondayOf(toDate);
    const toSunday = fromDayNumber(toDayNumber(toMonday) + 6);

    // The source week and target week must be different
    if (fromMonday === toMonday) {
        throw new BadRequestError('SOURCE_WEEK_IN_TARGET_WEEKS');
    }

    // Dedicated connection for the write transaction
    const connection = new sqlite.Database(DB_PATH, sqlite.OPEN_READWRITE);
    let transactionStarted = false;

    try {
        await dbRun('PRAGMA foreign_keys = ON', [], connection);
        await dbRun('BEGIN IMMEDIATE', [], connection);
        transactionStarted = true;

        // 1. Fetch all source slots for the source week
        const sourceSlots = await dbAll(`
            SELECT slot_id AS slotId, start_at AS startAt, end_at AS endAt
            FROM slots
            WHERE DATE(start_at, 'localtime') BETWEEN ? AND ?
            ORDER BY start_at
        `, [fromMonday, fromSunday], connection);

        if (sourceSlots.length === 0) {
            throw new BadRequestError('NO_SLOTS_TO_COPY');
        }

        // 2. Fetch all existing slots in the entire target week (Monday to Sunday)
        const targetSlots = await dbAll(`
            SELECT slot_id AS slotId, start_at AS startAt, end_at AS endAt
            FROM slots
            WHERE DATE(start_at, 'localtime') BETWEEN ? AND ?
            ORDER BY start_at
        `, [toMonday, toSunday], connection);

        if (targetSlots.length > 0) {
            const targetIds = targetSlots.map(s => s.slotId);
            const placeholders = targetIds.map(() => '?').join(',');

            // Check if any slot in the target week has active reservations
            const slotsWithReservations = await dbAll(`
                SELECT DISTINCT s.slot_id AS slotId, s.start_at AS startAt, s.end_at AS endAt
                FROM reservations r
                JOIN slots s ON s.slot_id = r.slot_id
                WHERE r.slot_id IN (${placeholders})
                  AND r.status <> 'cancelled'
                ORDER BY s.start_at
            `, targetIds, connection);

            // Abort the entire copy if at least one slot has active reservations
            if (slotsWithReservations.length > 0) {
                const details = slotsWithReservations
                    .map(s => `slotId: ${s.slotId} (${s.startAt} - ${s.endAt})`)
                    .join(', ');
                throw new ConflictError(`SLOT_HAS_RESERVATIONS: ${details}`);
            }

            // Delete any cancelled reservations tied to target slots (required due to ON DELETE RESTRICT)
            await dbRun(`
                DELETE FROM reservations
                WHERE slot_id IN (${placeholders})
            `, targetIds, connection);

            // Delete all existing slots in the target week (slot_tables and slots_dishes cascade automatically)
            await dbRun(`
                DELETE FROM slots
                WHERE slot_id IN (${placeholders})
            `, targetIds, connection);
        }

        // 3. Copy all source slots into the target week
        const now = new Date().toISOString();
        const createdIds = [];
        const skipped = [];

        const days = toDayNumber(toMonday) - toDayNumber(fromMonday);
        const shift = `${days >= 0 ? '+' : ''}${days} days`;

        for (const sourceSlot of sourceSlots) {
            // Shift timestamps in local time to preserve local wall-clock hours across DST
            const shifted = await dbGet(`
                SELECT
                    strftime('%Y-%m-%dT%H:%M:%fZ', ?1, 'localtime', ?3, 'utc') AS startAt,
                    strftime('%Y-%m-%dT%H:%M:%fZ', ?2, 'localtime', ?3, 'utc') AS endAt
            `, [sourceSlot.startAt, sourceSlot.endAt, shift], connection);

            // Guard against dates exceeding year 9999
            if (!shifted?.startAt || !shifted?.endAt) {
                throw new BadRequestError('INVALID_INPUT');
            }

            const { startAt, endAt } = shifted;

            if (endAt <= startAt) {
                skipped.push({ startAt, endAt, reason: 'INVALID_TIME_RANGE' });
                continue;
            }
            if (startAt <= now) {
                skipped.push({ startAt, endAt, reason: 'SLOT_IN_THE_PAST' });
                continue;
            }

            const result = await dbRun(`
                INSERT INTO slots (start_at, end_at)
                VALUES (?, ?)
            `, [startAt, endAt], connection);

            const slotId = result.lastID;

            // Copy tables and menu items as they are, even if empty
            if (copyTables) {
                await dbRun(`
                    INSERT INTO slot_tables (slot_id, table_id)
                    SELECT ?, table_id FROM slot_tables WHERE slot_id = ?
                `, [slotId, sourceSlot.slotId], connection);
            }

            if (copyMenu) {
                await dbRun(`
                    INSERT INTO slots_dishes (slot_id, dish_id)
                    SELECT ?, dish_id FROM slots_dishes WHERE slot_id = ?
                `, [slotId, sourceSlot.slotId], connection);
            }

            createdIds.push(slotId);
        }

        await dbRun('COMMIT', [], connection);
        transactionStarted = false;

        return {
            fromWeek: fromMonday,
            toWeek: toMonday,
            copyTables,
            copyMenu,
            created: await getSlotsById(createdIds),
            skipped
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
            connection.close(closeErr => {
                if (closeErr) {
                    console.error('Failed to close database connection:', closeErr);
                }
                resolve();
            });
        });
    }
};