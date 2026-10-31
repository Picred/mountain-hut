import { dbAll, dbGet, dbRun } from '../../utils/dbHelpers.js';

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