import sqlite from 'sqlite3';

import db, { DB_PATH } from '../../db/db.js';
import { dbAll, dbGet, dbRun } from '../../utils/dbHelpers.js';
import { runExclusive } from '../../utils/transactionQueue.js';
import { validateRequirementOperations } from './reservationDAO.js';

import BadRequestError from '../errors/BadRequestError.js';
import NotFoundError from '../errors/NotFoundError.js';
import ConflictError from '../errors/ConflictError.js';

/**
 * The employee can put more people at a table than it has seats
 * (e.g. "an extra chair"). TO BE CONFIRMED with the product owner:
 * set to false to make the seats of a table a hard limit.
 */
export const ALLOW_OVERBOOKING = true;

const isId = value => Number.isInteger(value) && value > 0;

/* ---------- transaction ---------- */

// Same pattern of makeReservation: queue + dedicated connection + BEGIN IMMEDIATE.
const inTransaction = task => runExclusive(async () => {
    const connection = new sqlite.Database(DB_PATH, sqlite.OPEN_READWRITE);
    let started = false;

    try {
        await dbRun('PRAGMA foreign_keys = ON', [], connection);
        await dbRun('BEGIN IMMEDIATE', [], connection);
        started = true;

        const result = await task(connection);

        await dbRun('COMMIT', [], connection);
        started = false;
        return result;
    } catch (err) {
        if (started) {
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
                if (err) console.error('Failed to close database connection:', err);
                resolve();
            });
        });
    }
});

/* ---------- shared helpers ---------- */

// Tables of a slot with the seats occupied by the confirmed reservations.
const loadSlotTables = (slotId, connection) => dbAll(`
    SELECT
        st.slot_table_id AS slotTableId,
        t.table_id AS tableId,
        t.table_code AS code,
        t.seats AS seats,
        COALESCE((
            SELECT SUM(rt.allocated_seats)
            FROM reservation_table rt
            JOIN reservations r ON r.reservation_id = rt.reservation_id
            WHERE rt.slot_table_id = st.slot_table_id AND r.status = 'confirmed'
        ), 0) AS occupied
    FROM slot_tables st
    JOIN tables t ON t.table_id = st.table_id
    WHERE st.slot_id = ?
    ORDER BY t.table_id
`, [slotId], connection);

const loadCurrentAllocation = (reservationId, connection) => dbAll(`
    SELECT st.slot_table_id AS slotTableId, st.table_id AS tableId, rt.allocated_seats AS seats
    FROM reservation_table rt
    JOIN slot_tables st ON st.slot_table_id = rt.slot_table_id
    WHERE rt.reservation_id = ?
    ORDER BY st.table_id
`, [reservationId], connection);

/**
 * Validates [{ tableId, seats }] and maps it to the tables of the slot.
 * Tables not in the slot cannot be used (tables cannot be added to a slot with reservations).
 */
const normalizeAllocation = (tables, slotTables) => {
    if (!Array.isArray(tables) || tables.length === 0) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const byTableId = new Map(slotTables.map(table => [table.tableId, table]));
    const seen = new Set();

    return tables.map(entry => {
        if (!isId(entry?.tableId) || !isId(entry?.seats) || seen.has(entry.tableId)) {
            throw new BadRequestError('INVALID_INPUT');
        }
        seen.add(entry.tableId);

        const slotTable = byTableId.get(entry.tableId);
        if (!slotTable) {
            throw new BadRequestError('TABLE_NOT_IN_SLOT');
        }
        return { slotTableId: slotTable.slotTableId, tableId: entry.tableId, seats: entry.seats };
    });
};

const totalSeats = allocation => allocation.reduce((sum, entry) => sum + entry.seats, 0);

const allocationKey = allocation =>
    allocation.map(entry => `${entry.tableId}:${entry.seats}`).sort().join('|');

const replaceAllocation = async (reservationId, allocation, connection) => {
    await dbRun('DELETE FROM reservation_table WHERE reservation_id = ?', [reservationId], connection);

    for (const entry of allocation) {
        await dbRun(`
            INSERT INTO reservation_table (reservation_id, slot_table_id, allocated_seats)
            VALUES (?, ?, ?)
        `, [reservationId, entry.slotTableId, entry.seats], connection);
    }
};

/**
 * Final check of the slot, after all the changes: returns the overbooked tables,
 * or throws if overbooking is not allowed.
 */
const checkCapacity = async (slotId, connection) => {
    const tables = await loadSlotTables(slotId, connection);
    const overbooked = tables
        .filter(table => table.occupied > table.seats)
        .map(table => ({
            tableId: table.tableId,
            code: table.code,
            seats: table.seats,
            occupiedSeats: table.occupied
        }));

    if (overbooked.length > 0 && !ALLOW_OVERBOOKING) {
        throw new ConflictError('TABLE_OVERBOOKED');
    }
    return overbooked;
};

/**
 * Seats `extra` more people using the current tables of the reservation first,
 * then the other tables with free seats (by table id).
 */
const extendAllocation = (current, slotTables, extra) => {
    const result = new Map(current.map(entry => [entry.tableId, { ...entry }]));
    let remaining = extra;

    const ordered = [...slotTables].sort((a, b) =>
        (Number(result.has(b.tableId)) - Number(result.has(a.tableId))) || (a.tableId - b.tableId));

    for (const table of ordered) {
        if (remaining === 0) break;

        const free = table.seats - table.occupied;
        if (free <= 0) continue;

        const added = Math.min(free, remaining);
        const entry = result.get(table.tableId)
            ?? { slotTableId: table.slotTableId, tableId: table.tableId, seats: 0 };
        entry.seats += added;
        result.set(table.tableId, entry);
        remaining -= added;
    }

    if (remaining > 0) {
        throw new ConflictError('NO_AVAILABILITY');
    }
    return [...result.values()];
};

/**
 * Loads a reservation the employee can edit: confirmed (waiting ones are not
 * touched for now) and in a slot that is not over yet.
 */
const loadEditableReservation = async (reservationId, connection) => {
    const reservation = await dbGet(`
        SELECT
            r.reservation_id AS reservationId,
            r.slot_id AS slotId,
            r.party_size AS partySize,
            r.status,
            strftime('%s', s.end_at) - strftime('%s', 'now') AS secondsUntilEnd
        FROM reservations r
        JOIN slots s ON s.slot_id = r.slot_id
        WHERE r.reservation_id = ?
    `, [reservationId], connection);

    if (!reservation) {
        throw new NotFoundError('RESERVATION_NOT_FOUND');
    }
    if (reservation.status !== 'confirmed') {
        throw new ConflictError('RESERVATION_NOT_EDITABLE');
    }
    // TO BE CONFIRMED with the product owner: for now until the end of the slot.
    if (reservation.secondsUntilEnd <= 0) {
        throw new ConflictError('SLOT_ALREADY_ENDED');
    }
    return reservation;
};

// Applies add / update / remove of the requirements; the covered people cannot exceed the party.
const applyRequirements = async (reservationId, operations, newPartySize, connection) => {
    const { add, update, remove } = operations ?? { add: [], update: [], remove: [] };

    const existing = await dbAll(`
        SELECT id, people_count AS peopleCount
        FROM reservation_requirements
        WHERE reservation_id = ?
    `, [reservationId], connection);
    const existingIds = new Set(existing.map(requirement => requirement.id));

    if (update.some(r => !existingIds.has(r.id)) || remove.some(id => !existingIds.has(id))) {
        throw new NotFoundError('REQUIREMENT_NOT_FOUND');
    }

    const updated = new Map(update.map(requirement => [requirement.id, requirement]));
    const removed = new Set(remove);

    const covered =
        existing
            .filter(requirement => !removed.has(requirement.id))
            .reduce((sum, requirement) =>
                sum + (updated.get(requirement.id)?.peopleCount ?? requirement.peopleCount), 0) +
        add.reduce((sum, requirement) => sum + requirement.peopleCount, 0);

    if (covered > newPartySize) {
        throw new BadRequestError('INVALID_INPUT');
    }

    for (const requirement of update) {
        await dbRun(`
            UPDATE reservation_requirements
            SET people_count = ?, description = ?, is_allergy = ?
            WHERE id = ? AND reservation_id = ?
        `, [requirement.peopleCount, requirement.description.trim(),
            requirement.isAllergy ? 1 : 0, requirement.id, reservationId], connection);
    }
    for (const id of remove) {
        await dbRun('DELETE FROM reservation_requirements WHERE id = ? AND reservation_id = ?',
            [id, reservationId], connection);
    }
    for (const requirement of add) {
        await dbRun(`
            INSERT INTO reservation_requirements (reservation_id, people_count, description, is_allergy)
            VALUES (?, ?, ?, ?)
        `, [reservationId, requirement.peopleCount, requirement.description.trim(),
            requirement.isAllergy ? 1 : 0], connection);
    }
};

/* ---------- reads ---------- */

/**
 * Full detail of a reservation (also guests and cancelled ones).
 * The connection can be passed to read inside a transaction.
 */
export const getReservationDetail = async (reservationId, connection) => {
    const row = await dbGet(`
        SELECT
            r.reservation_id AS reservationId,
            r.slot_id AS slotId,
            s.start_at AS startAt,
            s.end_at AS endAt,
            r.party_size AS partySize,
            r.status,
            r.created_at AS createdAt,
            r.user_id AS userId,
            r.guest_name AS guestName,
            r.guest_phone AS guestPhone,
            r.created_by AS createdById,
            cb.name AS createdByName,
            u.name AS userName,
            u.email AS userEmail,
            u.phone AS userPhone,
            u.notes AS userNotes,
            u.emergency_contact AS userEmergencyContact
        FROM reservations r
        JOIN slots s ON s.slot_id = r.slot_id
        JOIN users cb ON cb.user_id = r.created_by
        LEFT JOIN users u ON u.user_id = r.user_id
        WHERE r.reservation_id = ?
    `, [reservationId], connection);

    if (!row) {
        throw new NotFoundError('RESERVATION_NOT_FOUND');
    }

    const requirements = await dbAll(`
        SELECT id, people_count AS peopleCount, description, is_allergy AS isAllergy
        FROM reservation_requirements
        WHERE reservation_id = ?
        ORDER BY id
    `, [reservationId], connection);

    const tableAllocation = await dbAll(`
        SELECT t.table_id AS tableId, t.table_code AS tableCode, rt.allocated_seats AS allocatedSeats
        FROM reservation_table rt
        JOIN slot_tables st ON st.slot_table_id = rt.slot_table_id
        JOIN tables t ON t.table_id = st.table_id
        WHERE rt.reservation_id = ?
        ORDER BY t.table_id
    `, [reservationId], connection);

    const isGuest = row.userId === null;

    return {
        reservationId: row.reservationId,
        slotId: row.slotId,
        startAt: row.startAt,
        endAt: row.endAt,
        partySize: row.partySize,
        status: row.status,
        createdAt: row.createdAt,
        createdBy: { userId: row.createdById, name: row.createdByName },
        hiker: {
            userId: row.userId,
            isGuest,
            name: isGuest ? row.guestName : row.userName,
            email: isGuest ? null : row.userEmail,
            phone: isGuest ? row.guestPhone : row.userPhone,
            notes: isGuest ? null : row.userNotes,
            emergencyContact: isGuest ? null : row.userEmergencyContact
        },
        requirements: requirements.map(requirement => ({
            ...requirement,
            isAllergy: requirement.isAllergy === 1
        })),
        tableAllocation
    };
};

/**
 * Data for the floor map of a slot, in one call:
 * - tables: for each table, who is seated there (click on a table)
 * - reservations: for each reservation, its tables (click on a reservation -> highlight its tables)
 */
export const getSlotFloor = async slotId => {
    const slot = await dbGet(`
        SELECT slot_id AS slotId, start_at AS startAt, end_at AS endAt, menu
        FROM slots
        WHERE slot_id = ?
    `, [slotId]);

    if (!slot) {
        throw new NotFoundError('SLOT_NOT_FOUND');
    }

    const tableRows = await loadSlotTables(slotId);

    const reservationRows = await dbAll(`
        SELECT
            r.reservation_id AS reservationId,
            r.party_size AS partySize,
            r.status,
            r.user_id AS userId,
            COALESCE(u.name, r.guest_name) AS displayName,
            COALESCE(u.phone, r.guest_phone) AS phone
        FROM reservations r
        LEFT JOIN users u ON u.user_id = r.user_id
        WHERE r.slot_id = ? AND r.status IN ('confirmed', 'waiting')
        ORDER BY r.reservation_id
    `, [slotId]);

    const requirementRows = await dbAll(`
        SELECT
            rr.reservation_id AS reservationId,
            rr.id,
            rr.people_count AS peopleCount,
            rr.description,
            rr.is_allergy AS isAllergy
        FROM reservation_requirements rr
        JOIN reservations r ON r.reservation_id = rr.reservation_id
        WHERE r.slot_id = ? AND r.status IN ('confirmed', 'waiting')
        ORDER BY rr.id
    `, [slotId]);

    const allocationRows = await dbAll(`
        SELECT
            rt.reservation_id AS reservationId,
            t.table_id AS tableId,
            t.table_code AS tableCode,
            rt.allocated_seats AS seats
        FROM reservation_table rt
        JOIN slot_tables st ON st.slot_table_id = rt.slot_table_id
        JOIN tables t ON t.table_id = st.table_id
        WHERE st.slot_id = ?
        ORDER BY t.table_id
    `, [slotId]);

    const reservations = reservationRows.map(row => {
        const requirements = requirementRows
            .filter(requirement => requirement.reservationId === row.reservationId)
            .map(({ reservationId, isAllergy, ...rest }) => ({ ...rest, isAllergy: isAllergy === 1 }));

        return {
            reservationId: row.reservationId,
            displayName: row.displayName,
            phone: row.phone,
            isGuest: row.userId === null,
            partySize: row.partySize,
            status: row.status,
            editable: row.status === 'confirmed',
            hasRequirements: requirements.length > 0,
            hasAllergy: requirements.some(requirement => requirement.isAllergy),
            requirements,
            allocation: allocationRows
                .filter(entry => entry.reservationId === row.reservationId)
                .map(({ tableId, tableCode, seats }) => ({ tableId, tableCode, seats }))
        };
    });

    const byId = new Map(reservations.map(reservation => [reservation.reservationId, reservation]));

    const tables = tableRows.map(table => ({
        tableId: table.tableId,
        code: table.code,
        seats: table.seats,
        bookedSeats: table.occupied,
        remainingSeats: table.seats - table.occupied,
        overbooked: table.occupied > table.seats,
        guests: allocationRows
            .filter(entry => entry.tableId === table.tableId)
            .map(entry => {
                const reservation = byId.get(entry.reservationId);
                return {
                    reservationId: entry.reservationId,
                    displayName: reservation?.displayName ?? null,
                    allocatedSeats: entry.seats,
                    hasRequirements: reservation?.hasRequirements ?? false,
                    hasAllergy: reservation?.hasAllergy ?? false
                };
            })
    }));

    return { slot, tables, reservations };
};

/* ---------- writes ---------- */

/**
 * Employee update of a confirmed reservation: party size, requirements and/or tables.
 *
 * - allocation (optional, [{ tableId, seats }]): final seating, must sum to the new party size
 * - party size increased without allocation: the new people take the free seats
 *   (NO_AVAILABILITY if there are not enough)
 * - party size decreased without allocation: automatic only if the party is at a single
 *   table, otherwise the employee chooses (ALLOCATION_REQUIRED)
 */
export const employeeUpdateReservation = async (reservationId, { partySize, requirements, allocation }) => {
    const operations = requirements === undefined ? null : validateRequirementOperations(requirements);

    return inTransaction(async connection => {
        const reservation = await loadEditableReservation(reservationId, connection);
        const slotTables = await loadSlotTables(reservation.slotId, connection);
        const newPartySize = partySize ?? reservation.partySize;

        await applyRequirements(reservationId, operations, newPartySize, connection);

        const current = await loadCurrentAllocation(reservationId, connection);
        let finalAllocation = null;

        if (allocation !== undefined) {
            finalAllocation = normalizeAllocation(allocation, slotTables);
            if (totalSeats(finalAllocation) !== newPartySize) {
                throw new BadRequestError('ALLOCATION_MISMATCH');
            }
        } else if (newPartySize > reservation.partySize) {
            finalAllocation = extendAllocation(current, slotTables, newPartySize - reservation.partySize);
        } else if (newPartySize < reservation.partySize) {
            if (current.length !== 1) {
                throw new BadRequestError('ALLOCATION_REQUIRED');
            }
            finalAllocation = [{ ...current[0], seats: newPartySize }];
        }

        if (newPartySize !== reservation.partySize) {
            await dbRun('UPDATE reservations SET party_size = ? WHERE reservation_id = ?',
                [newPartySize, reservationId], connection);
        }
        if (finalAllocation) {
            await replaceAllocation(reservationId, finalAllocation, connection);
        }

        const overbookedTables = await checkCapacity(reservation.slotId, connection);
        const detail = await getReservationDetail(reservationId, connection);

        return { ...detail, overbookedTables };
    });
};

/**
 * Rearranges people across the tables of a slot in one transaction.
 *
 * moves: [{ reservationId, tables: [{ tableId, seats }] }] is the FINAL seating of the
 * listed reservations (the others stay where they are). Capacity is checked only at the
 * end, so a group can take the seats another group frees in the same request.
 *
 * Returns the ids of the reservations whose seating actually changed.
 */
export const rearrangeSlotAllocations = (slotId, moves) => inTransaction(async connection => {
    const slot = await dbGet(`
        SELECT slot_id, strftime('%s', end_at) - strftime('%s', 'now') AS secondsUntilEnd
        FROM slots
        WHERE slot_id = ?
    `, [slotId], connection);

    if (!slot) {
        throw new NotFoundError('SLOT_NOT_FOUND');
    }
    if (slot.secondsUntilEnd <= 0) {
        throw new ConflictError('SLOT_ALREADY_ENDED');
    }

    const reservationIds = moves.map(move => move.reservationId);
    if (new Set(reservationIds).size !== reservationIds.length) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const slotTables = await loadSlotTables(slotId, connection);
    const changedReservationIds = [];

    for (const move of moves) {
        const reservation = await dbGet(`
            SELECT reservation_id, slot_id, party_size, status
            FROM reservations
            WHERE reservation_id = ?
        `, [move.reservationId], connection);

        if (!reservation) {
            throw new NotFoundError('RESERVATION_NOT_FOUND');
        }
        if (reservation.slot_id !== slotId) {
            throw new BadRequestError('RESERVATION_NOT_IN_SLOT');
        }
        if (reservation.status !== 'confirmed') {
            throw new ConflictError('RESERVATION_NOT_EDITABLE');
        }

        const allocation = normalizeAllocation(move.tables, slotTables);
        if (totalSeats(allocation) !== reservation.party_size) {
            throw new BadRequestError('ALLOCATION_MISMATCH');
        }

        const current = await loadCurrentAllocation(move.reservationId, connection);
        if (allocationKey(current) !== allocationKey(allocation)) {
            await replaceAllocation(move.reservationId, allocation, connection);
            changedReservationIds.push(move.reservationId);
        }
    }

    const overbookedTables = await checkCapacity(slotId, connection);

    return { slotId, changedReservationIds, overbookedTables };
});

/**
 * Cancels a confirmed reservation on behalf of the employee: releases its tables
 * and keeps the row with status 'cancelled' (same behaviour of cancelReservation).
 */
export const employeeCancelReservation = reservationId => inTransaction(async connection => {
    await loadEditableReservation(reservationId, connection);

    await dbRun('DELETE FROM reservation_table WHERE reservation_id = ?', [reservationId], connection);
    await dbRun("UPDATE reservations SET status = 'cancelled' WHERE reservation_id = ?",
        [reservationId], connection);

    return { reservationId, status: 'cancelled' };
});