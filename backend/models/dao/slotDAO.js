import { dbAll, dbGet, dbRun } from '../../utils/dbHelpers.js';
import BadRequestError from '../errors/BadRequestError.js';
import NotFoundError from '../errors/NotFoundError.js';

/**
 * Returns the seconds until the slot starts, or null if the slot does not exist.
 */
export const getSecondsUntilStart = async (slotId) => {
    const row = await dbGet(`
        SELECT strftime('%s', start_at) - strftime('%s', 'now') AS secondsUntilStart
        FROM slots
        WHERE slot_id = ?
    `, [slotId]);
    return row ? row.secondsUntilStart : null;
};

/**
 * Retrieves all slots for a given date.
 *
 * Slot timestamps are stored in UTC (ISO 8601 format).
 * Local times are calculated using the server's timezone,
 * which must match the mountain hut's timezone.
 *
 * Hikers can book until 2 hours before the slot starts, an employee until it
 * starts (forEmployee = true).
 */
export const getSlotsByDate = async (date, forEmployee = false) => {
    const sql = `
        SELECT
            slot_id,
            strftime('%H:%M', start_at, 'localtime') AS startTime,
            strftime('%H:%M', end_at, 'localtime') AS endTime,
            MAX(
                0,
                COALESCE((
                    SELECT SUM(t.seats)
                    FROM slot_tables st
                    JOIN tables t ON t.table_id = st.table_id
                    WHERE st.slot_id = slots.slot_id
                ), 0) - COALESCE((
                    SELECT SUM(rt.allocated_seats)
                    FROM reservation_table rt
                    JOIN reservations r ON r.reservation_id = rt.reservation_id
                    JOIN slot_tables st ON st.slot_table_id = rt.slot_table_id
                    WHERE st.slot_id = slots.slot_id
                        AND r.status = 'confirmed'
                ), 0)
            ) AS availableSeats,
            strftime('%s', start_at) - strftime('%s', 'now') AS secondsUntilStart
        FROM slots
        WHERE DATE(start_at, 'localtime') = ?
            AND EXISTS (
                SELECT 1
                FROM slot_tables st
                WHERE st.slot_id = slots.slot_id
            )
        ORDER BY start_at
    `;

    const rows = await dbAll(sql, [date]);

    const slots = rows.map(row => {
        const bookingAllowed = forEmployee
            ? row.secondsUntilStart > 0
            : row.secondsUntilStart >= 7200;

        return {
            slotId: row.slot_id,
            startTime: row.startTime,
            endTime: row.endTime,
            availableSeats: row.availableSeats,
            bookingAllowed,
            restrictionReason: bookingAllowed ? null : (forEmployee ? 'Already started' : 'Less than 2 hours')
        };
    });

    return slots;
};

/**
 * Sets (menu = text) or removes (menu = null) the menu of a slot.
 * The menu of a slot that has already started cannot be changed.
 */
export const setSlotMenu = async (slotId, menu) => {
    const result = await dbRun(`
        UPDATE slots
        SET menu = ?
        WHERE slot_id = ? AND start_at > ?
    `, [menu, slotId, new Date().toISOString()]);

    if (result.changes === 0) {
        const slot = await dbGet('SELECT slot_id FROM slots WHERE slot_id = ?', [slotId]);
        throw slot ? new BadRequestError('SLOT_IN_THE_PAST') : new NotFoundError('SLOT_NOT_FOUND');
    }

    return { slotId, menu };
};

/**
 * Retrieves the menus already defined (distinct texts), from the most recently used,
 * so that the employee can reuse and change them.
 */
export const getPreviousMenus = (limit = 50) => dbAll(`
    SELECT menu, MAX(start_at) AS lastUsedAt
    FROM slots
    WHERE menu IS NOT NULL
    GROUP BY menu
    ORDER BY lastUsedAt DESC
    LIMIT ?
`, [limit]);
