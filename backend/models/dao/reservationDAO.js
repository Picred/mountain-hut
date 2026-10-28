import sqlite from 'sqlite3';

import db, { DB_PATH } from '../../db/db.js';
import { dbAll, dbGet, dbRun } from '../../utils/dbHelpers.js';

import BadRequestError from '../errors/BadRequestError.js';
import NotFoundError from '../errors/NotFoundError.js';
import ConflictError from '../errors/ConflictError.js';


/**
 * Checks table availability for a given slot and party size.
 * 
 * The connection parameter defaults to the main database connection.
 * A dedicated connection can be passed when this function is called
 * inside a transaction, ensuring that all database operations use
 * the same connection.
 */
export const checkAvailability = async (slotId, partySize, connection = db) => {
    const sql = `
        SELECT
            st.slot_table_id AS slotTableId,
            t.table_id AS tableId,
            t.seats AS totalSeats,
            (
                SELECT COALESCE(SUM(rt.allocated_seats), 0)
                FROM reservation_table rt
                JOIN reservations r
                    ON r.reservation_id = rt.reservation_id
                WHERE rt.slot_table_id = st.slot_table_id
                    AND r.status = 'confirmed'
            ) AS occupiedSeats
        FROM slot_tables st
        JOIN tables t ON t.table_id = st.table_id
        WHERE st.slot_id = ?
        ORDER BY t.table_id
    `;

    const rows = await dbAll(sql, [slotId], connection);

    const tables = rows
        .map(row => ({
            slotTableId: row.slotTableId,
            tableId: row.tableId,
            freeSeats: row.totalSeats - row.occupiedSeats
        }))
        .filter(table => table.freeSeats > 0);

    const allocation = findBestAllocation(tables, partySize);

    return {
        available: allocation !== null,
        tableAllocation: allocation ?? []
    };
};


/**
 * Finds the best table allocation for a given party size.
 *
 * Allocation priorities:
 * 1. Minimize the number of tables to keep the party together.
 * 2. Minimize unused seats in the selected tables.
 * 3. Break ties using the smallest table IDs.
 *
 * Returns the selected tables with their allocated seats,
 * or null if there are not enough available seats.
 */
const findBestAllocation = (tables, partySize) => {
    // Store the best valid combination found so far.
    let bestCombination = null;

    /**
     * Checks whether a candidate combination is better
     * than the current best combination.
     */
    const isBetter = (candidate, currentBest) => {
        // The first valid combination is always accepted.
        if (currentBest === null) return true;

        // Priority 1: use the fewest possible tables.
        if (candidate.length !== currentBest.length) {
            return candidate.length < currentBest.length;
        }

        // Calculate the total free seats in each combination.
        const candidateSeats = candidate.reduce(
            (sum, table) => sum + table.freeSeats, 0
        );

        const bestSeats = currentBest.reduce(
            (sum, table) => sum + table.freeSeats, 0
        );

        // Priority 2: minimize unused seats.
        if (candidateSeats !== bestSeats) {
            return candidateSeats < bestSeats;
        }

        // Priority 3: prefer smaller table IDs.
        // Tables are already sorted by ID.
        for (let i = 0; i < candidate.length; i++) {
            if (candidate[i].tableId !== currentBest[i].tableId) {
                return candidate[i].tableId < currentBest[i].tableId;
            }
        }

        // The candidate is not better than the current solution.
        return false;
    };

    /**
     * Recursively explores table combinations.
     *
     * index: index of the next table to consider.
     * selected: tables selected so far.
     * totalSeats: total free seats in the selected tables.
     */
    const search = (index, selected, totalSeats) => {
        // A valid combination has enough seats for the whole party.
        if (totalSeats >= partySize) {
            // Save it only if it improves the current best solution.
            if (isBetter(selected, bestCombination)) {
                bestCombination = [...selected];
            }
            // Adding more tables would not improve this combination.
            return;
        }

        // Stop if all tables have been considered.
        if (index === sortedTables.length) return;

        // Stop if this branch cannot use fewer tables
        // than the best solution already found.
        if (bestCombination !== null &&
            selected.length >= bestCombination.length) {
            return;
        }

        // Option 1: include the current table.
        search(
            index + 1,
            [...selected, sortedTables[index]],
            totalSeats + sortedTables[index].freeSeats
        );

        // Option 2: skip the current table.
        search(index + 1, selected, totalSeats);
    };

    // Sort tables by ID without modifying the original array.
    const sortedTables = [...tables].sort(
        (a, b) => a.tableId - b.tableId
    );

    // Start searching with no tables selected and zero seats.
    search(0, [], 0);

    // No combination can accommodate the entire party.
    if (bestCombination === null) return null;

    // Distribute guests across the selected tables.
    let remainingGuests = partySize;

    return bestCombination.map(table => {
        // Assign only as many guests as the table can accommodate.
        const allocatedSeats = Math.min(
            table.freeSeats,
            remainingGuests
        );

        // Update the number of guests still to be assigned.
        remainingGuests -= allocatedSeats;

        // Return the allocation for this table.
        return {
            slotTableId: table.slotTableId,
            tableId: table.tableId,
            allocatedSeats
        };
    });
};


/**
 * Creates a confirmed reservation for the specified user.
 *
 * The reservation and its table allocations are saved in a single
 * transaction to prevent partial writes and overbooking.
 *
 * SQLite transactions:
 * - BEGIN IMMEDIATE: reserves the database's write transaction before
 *   checking availability, preventing other connections from writing
 *   until this transaction finishes.
 * - COMMIT: permanently saves all changes if every operation succeeds.
 * - ROLLBACK: undoes all changes if any operation fails.
 *
 * All queries within the transaction must use the same connection.
 */
export const makeReservation = async (slotId, userId, partySize) => {
    if (!Number.isInteger(slotId) || slotId <= 0 ||
        !Number.isInteger(userId) || userId <= 0 ||
        !Number.isInteger(partySize) || partySize <= 0) {
        throw new BadRequestError('INVALID_INPUT');
    }

    // Create a dedicated connection for this reservation.
    // Using a separate connection prevents unrelated queries from
    // accidentally running inside this transaction.
    const connection = new sqlite.Database(DB_PATH, sqlite.OPEN_READWRITE);

    // Track whether a transaction is active so we know if a
    // ROLLBACK is needed when an error occurs.
    let transactionStarted = false;

    try {
        /**
         * BEGIN IMMEDIATE starts a write transaction immediately.
         *
         * If another connection is already writing, this operation
         * waits up to the configured busy timeout or fails with
         * SQLITE_BUSY.
         *
         * This prevents two concurrent reservations from both
         * checking the same available seats and then writing
         * conflicting allocations.
         *
         * Other connections may still read the database, depending
         * on SQLite's journal mode and locking configuration.
         */
        await dbRun('PRAGMA foreign_keys = ON', [], connection);

        // Acquire the write transaction before checking availability.
        await dbRun('BEGIN IMMEDIATE', [], connection);
        transactionStarted = true;

        // Check that the slot exists and starts in at least 2 hours.
        // This check is performed inside the transaction.
        const slot = await dbGet(`
            SELECT
                slot_id AS slotId,
                strftime('%s', start_at) - strftime('%s', 'now') AS secondsUntilStart
            FROM slots
            WHERE slot_id = ?
        `, [slotId], connection);

        if (!slot) {
            throw new NotFoundError('SLOT_NOT_FOUND');
        }

        if (slot.secondsUntilStart < 7200) {
            throw new ConflictError('BOOKING_TOO_LATE');
        }

        // Check availability using the SAME connection.
        // Since the write transaction has already started, another
        // connection cannot change the reserved seats before we
        // finish creating this reservation.
        const availability = await checkAvailability(
            slotId,
            partySize,
            connection
        );

        if (!availability.available) {
            throw new ConflictError('NO_AVAILABILITY');
        }

        // Insert the reservation inside the transaction.
        // The record will only be committed if all subsequent
        // table allocations are inserted successfully.
        const result = await dbRun(`
            INSERT INTO reservations (
                slot_id,
                user_id,
                guest_name,
                guest_phone,
                created_by,
                party_size,
                status,
                created_at
            )
            VALUES (?, ?, NULL, NULL, ?, ?, 'confirmed', ?)
        `, [
            slotId,
            userId,
            userId,
            partySize,
            new Date().toISOString()
        ], connection);

        const reservationId = result.lastID;

        // Insert each table allocation using the same transaction.
        // If any INSERT fails, the reservation and all previously
        // inserted allocations will be rolled back together.
        for (const table of availability.tableAllocation) {
            await dbRun(`
                INSERT INTO reservation_table (
                    reservation_id,
                    slot_table_id,
                    allocated_seats
                )
                VALUES (?, ?, ?)
            `, [
                reservationId,
                table.slotTableId,
                table.allocatedSeats
            ], connection);
        }

        /**
         * COMMIT makes all changes permanent.
         *
         * The reservation and its table allocations are saved
         * together as one atomic operation.
         *
         * After COMMIT, SQLite releases the write transaction,
         * allowing another waiting writer to proceed.
         */
        await dbRun('COMMIT', [], connection);
        transactionStarted = false;

        return {
            reservationId,
            slotId,
            partySize,
            status: 'confirmed',
            tableAllocation: availability.tableAllocation.map(table => ({
                tableId: table.tableId,
                allocatedSeats: table.allocatedSeats
            }))
        };

    } catch (err) {
        /**
         * ROLLBACK cancels all changes made during the transaction.
         *
         * For example, if the reservation INSERT succeeds but an
         * allocation INSERT fails, ROLLBACK removes both the
         * reservation and any allocations already inserted.
         *
         * This ensures that incomplete reservations are never saved.
         */
        if (transactionStarted) {
            try {
                await dbRun('ROLLBACK', [], connection);
            } catch (rollbackErr) {
                console.error('Rollback failed:', rollbackErr);
            }
        }

        // Propagate the original error to the API route.
        throw err;

    } finally {
        // Always close the dedicated connection.
        // Log a closing error without replacing the original operation error.
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
