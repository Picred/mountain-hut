import { dbAll, dbGet } from '../../utils/dbHelpers.js';

/**
 * Retrieves everything needed for the confirmation email of a reservation.
 *
 * Returns null if the reservation does not exist or it has no registered hiker
 */
export const getBookingConfirmationData = async (reservationId) => {
    const row = await dbGet(`
        SELECT
            r.reservation_id,
            r.party_size,
            s.start_at,
            s.end_at,
            u.name,
            u.email
        FROM reservations r
        JOIN slots s ON s.slot_id = r.slot_id
        JOIN users u ON u.user_id = r.user_id
        WHERE r.reservation_id = ?
    `, [reservationId]);

    if (!row) return null;

    // Party requirements (allergies, diets). Empty until user story 5 saves them
    const requirements = await dbAll(`
        SELECT people_count, description, is_allergy
        FROM reservation_requirements
        WHERE reservation_id = ?
        ORDER BY id
    `, [reservationId]);

    return {
        reservationId: row.reservation_id,
        partySize: row.party_size,
        startAt: row.start_at,
        endAt: row.end_at,
        hikerName: row.name,
        hikerEmail: row.email,
        requirements: requirements.map(req => ({
            peopleCount: req.people_count,
            description: req.description,
            isAllergy: req.is_allergy === 1
        }))
    };
};