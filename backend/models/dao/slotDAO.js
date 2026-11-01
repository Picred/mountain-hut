import { dbAll } from '../../utils/dbHelpers.js';

/**
 * Retrieves all slots for a given date.
 *
 * Slot timestamps are stored in UTC (ISO 8601 format).
 * Local times are calculated using the server's timezone,
 * which must match the mountain hut's timezone.
 */
export const getSlotsByDate = async (date) => {
    const sql = `
        SELECT
            slot_id,
            strftime('%H:%M', start_at, 'localtime') AS startTime,
            strftime('%H:%M', end_at, 'localtime') AS endTime,
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
        // Bookings must be made at least 2 hours before the slot starts.
        const bookingAllowed = row.secondsUntilStart >= 7200;

        return {
            slotId: row.slot_id,
            startTime: row.startTime,
            endTime: row.endTime,
            bookingAllowed,
            restrictionReason: bookingAllowed ? null : 'Less than 2 hours'
        };
    });

    return slots;
};
