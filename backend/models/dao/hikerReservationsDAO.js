import { dbAll } from '../../utils/dbHelpers.js';

// Returns all the reservations made by a hiker, most recent time slot first.
export const getReservationsByUser = async (userId) => {
    const reservations = await dbAll(`
        SELECT
            r.reservation_id AS reservationId,
            r.slot_id AS slotId,
            s.start_at AS startAt,
            s.end_at AS endAt,
            r.party_size AS partySize,
            r.status AS status,
            r.created_at AS createdAt
        FROM reservations r
        JOIN slots s ON s.slot_id = r.slot_id
        WHERE r.user_id = ?
        ORDER BY s.start_at DESC, r.reservation_id DESC
    `, [userId]);

    if (reservations.length === 0) {
        return [];
    }

    // The requirements and the tables of all the reservations are read with
    // one query each (instead of two queries per reservation).
    const marks = reservations.map(() => '?').join(', ');
    const ids = reservations.map(reservation => reservation.reservationId);

    const requirementRows = await dbAll(`
        SELECT
            reservation_id AS reservationId,
            id,
            people_count AS peopleCount,
            description,
            is_allergy AS isAllergy
        FROM reservation_requirements
        WHERE reservation_id IN (${marks})
        ORDER BY id
    `, ids);

    const tableRows = await dbAll(`
        SELECT
            rt.reservation_id AS reservationId,
            t.table_id AS tableId,
            t.table_code AS tableCode,
            rt.allocated_seats AS allocatedSeats
        FROM reservation_table rt
        JOIN slot_tables st ON st.slot_table_id = rt.slot_table_id
        JOIN tables t ON t.table_id = st.table_id
        WHERE rt.reservation_id IN (${marks})
        ORDER BY t.table_id
    `, ids);

    return reservations.map(reservation => ({
        ...reservation,
        requirements: requirementRows
            .filter(row => row.reservationId === reservation.reservationId)
            .map(row => ({
                id: row.id,
                peopleCount: row.peopleCount,
                description: row.description,
                isAllergy: row.isAllergy === 1
            })),
        tableAllocation: tableRows
            .filter(row => row.reservationId === reservation.reservationId)
            .map(row => ({
                tableId: row.tableId,
                tableCode: row.tableCode,
                allocatedSeats: row.allocatedSeats
            }))
    }));
};
