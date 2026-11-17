import { dbAll, dbGet } from '../../utils/dbHelpers.js';

/**
 * Retrieves meal times and menu for a selected slot, or null if not found.
 */
export const getMealBySlotId = async (slotId) => {
    const row = await dbGet(`
        SELECT
            slot_id AS slotId,
            DATE(start_at, 'localtime') AS date,
            start_at AS startAt,
            end_at AS endAt,
            strftime('%H:%M', start_at, 'localtime') AS startTime,
            strftime('%H:%M', end_at, 'localtime') AS endTime,
            menu
        FROM slots
        WHERE slot_id = ?
    `, [slotId]);

    if (!row) return null;

    return {
        ...row,
        menu: row.menu ?? null
    };
};

/**
 * Retrieves meal times and menus for all bookable slots on a given date.
 */
export const getMealsByDate = async (date) => {
    const rows = await dbAll(`
        SELECT
            slot_id AS slotId,
            DATE(start_at, 'localtime') AS date,
            start_at AS startAt,
            end_at AS endAt,
            strftime('%H:%M', start_at, 'localtime') AS startTime,
            strftime('%H:%M', end_at, 'localtime') AS endTime,
            menu
        FROM slots
        WHERE DATE(start_at, 'localtime') = ?
            AND EXISTS (
                SELECT 1
                FROM slot_tables st
                WHERE st.slot_id = slots.slot_id
            )
        ORDER BY start_at ASC
    `, [date]);

    return rows.map(row => ({
        ...row,
        menu: row.menu ?? null
    }));
};