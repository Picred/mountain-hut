import sqlite from 'sqlite3';

import db, { DB_PATH } from '../../db/db.js';
import { dbAll, dbGet, dbRun } from '../../utils/dbHelpers.js';
import { runExclusive } from '../../utils/transactionQueue.js';

import BadRequestError from '../errors/BadRequestError.js';
import NotFoundError from '../errors/NotFoundError.js';
import ConflictError from '../errors/ConflictError.js';
import ForbiddenError from '../errors/ForbiddenError.js';


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
            t.table_code AS tableCode,
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
            tableCode: row.tableCode,
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
            tableCode: table.tableCode,
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
 *
 * byEmployee is set when an employee books for a hiker: { employeeId } with the
 * userId of a registered hiker, or with userId null and either newHiker
 * ({ name, email, phone, salt, passwordHash }: the hiker is registered in the
 * same transaction) or guest ({ name, phone }: a temporary hiker who cannot log in).
 */
export const makeReservation = (slotId, userId, partySize, requirements, byEmployee) =>
    runExclusive(() => createReservation(slotId, userId, partySize, requirements, byEmployee));

const createReservation = async (slotId, userId, partySize, requirements, byEmployee) => {
    const hikerCount = [userId, byEmployee?.newHiker, byEmployee?.guest]
        .filter(hiker => hiker != null).length;

    if (!Number.isInteger(slotId) || slotId <= 0 ||
        (userId != null && (!Number.isInteger(userId) || userId <= 0)) ||
        (byEmployee ? !Number.isInteger(byEmployee.employeeId) || hikerCount !== 1 : userId == null) ||
        !Number.isInteger(partySize) || partySize <= 0) {
        throw new BadRequestError('INVALID_INPUT');
    }

    if (requirements !== undefined) {
        if (!Array.isArray(requirements)) {
            throw new BadRequestError('INVALID_INPUT');
        }

        const totalPeopleWithRequirements = requirements.reduce((total, requirement) => {
            if (
                !requirement ||
                !Number.isInteger(requirement.peopleCount) ||
                requirement.peopleCount <= 0 ||
                typeof requirement.description !== 'string' ||
                requirement.description.trim().length === 0 ||
                typeof requirement.isAllergy !== 'boolean'
            ) {
                throw new BadRequestError('INVALID_INPUT');
            }

            return total + requirement.peopleCount;
        }, 0);

        if (totalPeopleWithRequirements > partySize) {
            throw new BadRequestError('INVALID_INPUT');
        }
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

        // Hikers book at least 2 hours before the slot, an employee until it starts
        // (e.g. a party arriving at the hut shortly before the meal).
        if (byEmployee ? slot.secondsUntilStart <= 0 : slot.secondsUntilStart < 7200) {
            throw new ConflictError('BOOKING_TOO_LATE');
        }

        let hiker = null;
        if (byEmployee && userId) {
            hiker = await dbGet(`
                SELECT user_id AS userId, name, email, phone
                FROM users
                WHERE user_id = ? AND role = 'hiker'
            `, [userId], connection);

            if (!hiker) {
                throw new NotFoundError('HIKER_NOT_FOUND');
            }
        }

        // An hiker cannot have more than one active booking for the same slot.
        const existingReservation = userId && await dbGet(`
            SELECT reservation_id
            FROM reservations
            WHERE user_id = ?
                AND slot_id = ?
                AND status IN ('confirmed', 'waiting')
            LIMIT 1
        `, [userId, slotId], connection);

        if (existingReservation) {
            throw new ConflictError('ALREADY_BOOKED');
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

        // The hiker registered by the employee is created in the same transaction:
        // if the reservation fails, no account is left behind.
        const newHiker = byEmployee?.newHiker;
        if (newHiker) {
            const existingUser = await dbGet(
                'SELECT user_id FROM users WHERE email = ?',
                [newHiker.email],
                connection
            );

            if (existingUser) {
                throw new ConflictError('EMAIL_ALREADY_USED');
            }

            const { lastID } = await dbRun(`
                INSERT INTO users (name, email, phone, password_hash, salt, role, password_to_change)
                VALUES (?, ?, ?, ?, ?, 'hiker', 1)
            `, [newHiker.name, newHiker.email, newHiker.phone, newHiker.passwordHash, newHiker.salt], connection);

            hiker = { userId: lastID, name: newHiker.name, email: newHiker.email, phone: newHiker.phone };
        }

        const guest = byEmployee?.guest;
        if (guest) {
            hiker = { userId: null, name: guest.name, email: null, phone: guest.phone };
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
            VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)
        `, [
            slotId,
            hiker ? hiker.userId : userId,
            guest?.name ?? null,
            guest?.phone ?? null,
            byEmployee?.employeeId ?? userId,
            partySize,
            new Date().toISOString()
        ], connection);

        const reservationId = result.lastID;

        for (const requirement of requirements ?? []) {
            await dbRun(`
                INSERT INTO reservation_requirements (
                    reservation_id,
                    people_count,
                    description,
                    is_allergy
                )
                VALUES (?, ?, ?, ?)
            `, [
                reservationId,
                requirement.peopleCount,
                requirement.description.trim(),
                requirement.isAllergy ? 1 : 0
            ], connection);
        }

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
            ...(byEmployee ? { hiker } : {}),
            ...(requirements === undefined ? {} : {
                requirements: requirements.map(requirement => ({
                    peopleCount: requirement.peopleCount,
                    description: requirement.description.trim(),
                    isAllergy: requirement.isAllergy
                }))
            }),
            tableAllocation: availability.tableAllocation.map(table => ({
                tableId: table.tableId,
                tableCode: table.tableCode,
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

const validateRequirement = requirement => {
    if (
        !requirement ||
        !Number.isInteger(requirement.peopleCount) ||
        requirement.peopleCount <= 0 ||
        typeof requirement.description !== 'string' ||
        requirement.description.trim().length === 0 ||
        typeof requirement.isAllergy !== 'boolean'
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }
};

const validateRequirementOperations = operations => {
    if (!operations || typeof operations !== 'object' || Array.isArray(operations)) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const add = operations.add ?? [];
    const update = operations.update ?? [];
    const remove = operations.remove ?? [];

    if (!Array.isArray(add) || !Array.isArray(update) || !Array.isArray(remove)) {
        throw new BadRequestError('INVALID_INPUT');
    }

    add.forEach(validateRequirement);

    const updateIds = update.map(requirement => {
        if (!Number.isInteger(requirement?.id) || requirement.id <= 0) {
            throw new BadRequestError('INVALID_INPUT');
        }
        validateRequirement(requirement);
        return requirement.id;
    });

    if (
        new Set(updateIds).size !== updateIds.length ||
        remove.some(id => !Number.isInteger(id) || id <= 0) ||
        new Set(remove).size !== remove.length ||
        updateIds.some(id => remove.includes(id))
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    return { add, update, remove };
};

const getUpdatedReservation = async (reservationId, connection) => {
    const reservation = await dbGet(`
        SELECT
            reservation_id AS reservationId,
            slot_id AS slotId,
            party_size AS partySize,
            status
        FROM reservations
        WHERE reservation_id = ?
    `, [reservationId], connection);

    const requirements = await dbAll(`
        SELECT
            id,
            people_count AS peopleCount,
            description,
            is_allergy AS isAllergy
        FROM reservation_requirements
        WHERE reservation_id = ?
        ORDER BY id
    `, [reservationId], connection);

    const allocation = await dbAll(`
        SELECT
            t.table_id AS tableId,
            t.table_code AS tableCode,
            rt.allocated_seats AS allocatedSeats
        FROM reservation_table rt
        JOIN slot_tables st ON st.slot_table_id = rt.slot_table_id
        JOIN tables t ON t.table_id = st.table_id
        WHERE rt.reservation_id = ?
        ORDER BY t.table_id
    `, [reservationId], connection);

    return {
        ...reservation,
        requirements: requirements.map(requirement => ({
            id: requirement.id,
            peopleCount: requirement.peopleCount,
            description: requirement.description,
            isAllergy: requirement.isAllergy === 1
        })),
        tableAllocation: allocation
    };
};

/**
 * Updates an owned reservation atomically.
 *
 * Slot and party-size changes release the previous allocation and calculate a
 * new one inside the same write transaction, preventing overbooking.
 */
export const updateReservation = async (reservationId, userId, changes) => {
    if (
        !Number.isInteger(reservationId) ||
        reservationId <= 0 ||
        !Number.isInteger(userId) ||
        userId <= 0 ||
        !changes ||
        typeof changes !== 'object'
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const { slotId, partySize, requirements } = changes;
    const requirementOperations = requirements === undefined
        ? null
        : validateRequirementOperations(requirements);

    const connection = new sqlite.Database(DB_PATH, sqlite.OPEN_READWRITE);
    let transactionStarted = false;

    try {
        await dbRun('PRAGMA foreign_keys = ON', [], connection);
        await dbRun('BEGIN IMMEDIATE', [], connection);
        transactionStarted = true;

        const reservation = await dbGet(`
                    SELECT
                        reservation_id AS reservationId,
                        reservations.slot_id AS slotId,
                        party_size AS partySize,
                        status,
                        user_id AS userId,
                        strftime('%s', start_at) - strftime('%s', 'now') AS secondsUntilStart
                    FROM reservations
                    JOIN slots ON slots.slot_id = reservations.slot_id
                    WHERE reservation_id = ?
                `, [reservationId], connection);

        if (!reservation) {
            throw new NotFoundError('RESERVATION_NOT_FOUND');
        }

        if (reservation.userId !== userId) {
            throw new ForbiddenError('FORBIDDEN');
        }

        if (!['confirmed', 'waiting'].includes(reservation.status)) {
            throw new ConflictError('RESERVATION_NOT_EDITABLE');
        }

        // Changes are admitted until 48 hours before the booked slot starts.
        if (reservation.secondsUntilStart < 48 * 60 * 60) {
            throw new ConflictError('EDIT_WINDOW_EXPIRED');
        }

        const newSlotId = slotId ?? reservation.slotId;
        const newPartySize = partySize ?? reservation.partySize;

        const targetSlot = await dbGet(`
                    SELECT
                        slot_id AS slotId,
                        strftime('%s', start_at) - strftime('%s', 'now') AS secondsUntilStart
                    FROM slots
                    WHERE slot_id = ?
                `, [newSlotId], connection);

        if (!targetSlot) {
            throw new NotFoundError('SLOT_NOT_FOUND');
        }

        if (targetSlot.secondsUntilStart < 7200) {
            throw new ConflictError('BOOKING_TOO_LATE');
        }

        const duplicate = await dbGet(`
                    SELECT reservation_id
                    FROM reservations
                    WHERE user_id = ?
                        AND slot_id = ?
                        AND reservation_id <> ?
                        AND status IN ('confirmed', 'waiting')
                    LIMIT 1
                `, [userId, newSlotId, reservationId], connection);

        if (duplicate) {
            throw new ConflictError('ALREADY_BOOKED');
        }

        // Without requirement changes, the saved requirements must still fit in the new party.
        if (!requirementOperations && newPartySize < reservation.partySize) {
            const covered = await dbGet(`
                        SELECT COALESCE(SUM(people_count), 0) AS people
                        FROM reservation_requirements
                        WHERE reservation_id = ?
                    `, [reservationId], connection);

            if (covered.people > newPartySize) {
                throw new BadRequestError('INVALID_INPUT');
            }
        }

        if (requirementOperations) {
            const existingRequirements = await dbAll(`
                        SELECT id, people_count AS peopleCount, description, is_allergy AS isAllergy
                        FROM reservation_requirements
                        WHERE reservation_id = ?
                    `, [reservationId], connection);
            const existingIds = new Set(existingRequirements.map(requirement => requirement.id));

            if (
                requirementOperations.update.some(requirement => !existingIds.has(requirement.id)) ||
                requirementOperations.remove.some(id => !existingIds.has(id))
            ) {
                throw new NotFoundError('REQUIREMENT_NOT_FOUND');
            }

            const resultingRequirements = existingRequirements
                .filter(requirement => !requirementOperations.remove.includes(requirement.id))
                .map(requirement => {
                    const update = requirementOperations.update.find(
                        candidate => candidate.id === requirement.id
                    );
                    return update ?? {
                        ...requirement,
                        isAllergy: requirement.isAllergy === 1
                    };
                })
                .concat(requirementOperations.add);

            if (
                resultingRequirements.reduce(
                    (total, requirement) => total + requirement.peopleCount,
                    0
                ) > newPartySize
            ) {
                throw new BadRequestError('INVALID_INPUT');
            }

            for (const requirement of requirementOperations.update) {
                await dbRun(`
                            UPDATE reservation_requirements
                            SET people_count = ?, description = ?, is_allergy = ?
                            WHERE id = ? AND reservation_id = ?
                        `, [
                    requirement.peopleCount,
                    requirement.description.trim(),
                    requirement.isAllergy ? 1 : 0,
                    requirement.id,
                    reservationId
                ], connection);
            }

            for (const id of requirementOperations.remove) {
                await dbRun(`
                            DELETE FROM reservation_requirements
                            WHERE id = ? AND reservation_id = ?
                        `, [id, reservationId], connection);
            }

            for (const requirement of requirementOperations.add) {
                await dbRun(`
                            INSERT INTO reservation_requirements (
                                reservation_id,
                                people_count,
                                description,
                                is_allergy
                            )
                            VALUES (?, ?, ?, ?)
                        `, [
                    reservationId,
                    requirement.peopleCount,
                    requirement.description.trim(),
                    requirement.isAllergy ? 1 : 0
                ], connection);
            }
        }

        const allocationMustChange =
            newSlotId !== reservation.slotId ||
            newPartySize !== reservation.partySize;

        let allocation;
        if (allocationMustChange) {
            await dbRun(
                'DELETE FROM reservation_table WHERE reservation_id = ?',
                [reservationId],
                connection
            );

            allocation = await checkAvailability(
                newSlotId,
                newPartySize,
                connection
            );

            if (!allocation.available) {
                throw new ConflictError('NO_AVAILABILITY');
            }

            for (const table of allocation.tableAllocation) {
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
        }

        await dbRun(`
                    UPDATE reservations
                    SET slot_id = ?, party_size = ?
                    WHERE reservation_id = ?
                `, [newSlotId, newPartySize, reservationId], connection);

        await dbRun('COMMIT', [], connection);
        transactionStarted = false;

        return await getUpdatedReservation(reservationId, connection);
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

/**
 * Cancels an owned reservation and releases its allocated tables.
 *
 * The reservation is not deleted from the database: its status is
 * changed to 'cancelled', while its table allocations are removed.
 *
 * All operations are performed in a single transaction.
 */
export const cancelReservation = async (reservationId, userId) => {
    if (
        !Number.isInteger(reservationId) ||
        reservationId <= 0 ||
        !Number.isInteger(userId) ||
        userId <= 0
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const connection = new sqlite.Database(DB_PATH, sqlite.OPEN_READWRITE);
    let transactionStarted = false;

    try {
        await dbRun('PRAGMA foreign_keys = ON', [], connection);
        await dbRun('BEGIN IMMEDIATE', [], connection);
        transactionStarted = true;

        // Find the reservation.
        const reservation = await dbGet(`
            SELECT
                r.reservation_id AS reservationId,
                r.user_id AS userId,
                r.status
                -- , s.start_at AS startAt
            FROM reservations r
            -- JOIN slots s ON s.slot_id = r.slot_id
            WHERE r.reservation_id = ?
        `, [reservationId], connection);

        if (!reservation) {
            throw new NotFoundError('RESERVATION_NOT_FOUND');
        }

        // Only the owner can cancel the reservation.
        if (reservation.userId !== userId) {
            throw new ForbiddenError('FORBIDDEN');
        }

        // Only active reservations can be cancelled.
        if (!['confirmed', 'waiting'].includes(reservation.status)) {
            throw new ConflictError('RESERVATION_NOT_CANCELLABLE');
        }

        /*
        *
        * MH-08 allows cancellation at any time.
        * If requirements change, uncomment the startAt field,
        * the JOIN with slots, and the following validation.
        *
        * Cancellation is forbidden from the exact start time
        * of the reservation onwards.
        */
        /*
        const reservationStart = new Date(reservation.startAt);
        if (Date.now() >= reservationStart.getTime()) {
            throw new ConflictError('RESERVATION_ALREADY_STARTED');
        }
        */

        // Release all tables allocated to the reservation.
        await dbRun(`
            DELETE FROM reservation_table
            WHERE reservation_id = ?
        `, [reservationId], connection);

        // Keep the reservation in the database as cancelled.
        await dbRun(`
            UPDATE reservations
            SET status = 'cancelled'
            WHERE reservation_id = ?
        `, [reservationId], connection);

        // Save both changes atomically.
        await dbRun('COMMIT', [], connection);
        transactionStarted = false;

        return {
            reservationId,
            status: 'cancelled'
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