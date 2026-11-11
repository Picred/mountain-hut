import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock per i database helpers (eseguirà le query intercettando le stringhe SQL)
vi.mock('../../../backend/utils/dbHelpers.js', () => ({
    dbAll: vi.fn(),
    dbGet: vi.fn(),
    dbRun: vi.fn(),
}));

// Mock di sqlite3 per la transazione
vi.mock('sqlite3', () => ({
    default: {
        OPEN_READWRITE: 2,
        Database: class { close(callback) { callback(null); } },
    },
}));

import { updateReservation } from '../../../backend/models/dao/reservationDAO.js';
import { getReservationsByUser } from '../../../backend/models/dao/hikerReservationsDAO.js';
import { dbAll, dbGet, dbRun } from '../../../backend/utils/dbHelpers.js';

beforeEach(() => {
    vi.resetAllMocks();
});

describe("Get reservation by user", () => {
    it("returns a list of reservations made by a certain hiker", async () => {
        dbAll.mockResolvedValueOnce([{
            reservationId: 1, slotId: 1, startAt: '2026-11-05 12:00',
            endAt: '2026-11-05 14:00', partySize: 5, status: 'confirmed',
            createdAt: '2026-11-01 10:00'
        }]);
        dbAll.mockResolvedValueOnce([{
            reservationId: 1, id: 2, peopleCount: 2, description: 'vegetarian', isAllergy: 0
        }]);
        dbAll.mockResolvedValueOnce([{
            reservationId: 1, tableId: 5, tableCode: 'T1', allocatedSeats: 5
        }]);

        const list = await getReservationsByUser(3);

        expect(list).toEqual([{
            reservationId: 1, slotId: 1, startAt: '2026-11-05 12:00', endAt: '2026-11-05 14:00',
            partySize: 5, status: 'confirmed', createdAt: '2026-11-01 10:00',
            requirements: [{ id: 2, peopleCount: 2, description: 'vegetarian', isAllergy: false }],
            tableAllocation: [{ tableId: 5, tableCode: 'T1', allocatedSeats: 5 }]
        }]);
    });

    it("returns an empty array if user has no reservations", async () => {
        dbAll.mockResolvedValueOnce([]);
        const result = await getReservationsByUser(1);
        expect(result).toEqual([]);
    });

    it("returns a reservation with empty tables and requirements if none of them exist", async () => {
        dbAll
            .mockResolvedValueOnce([{ reservationId: 1, slotId: 1 }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);

        const result = await getReservationsByUser(3);
        expect(result).toEqual([{ reservationId: 1, slotId: 1, requirements: [], tableAllocation: [] }]);
    });

    it("throws an error if the database query fails", async () => {
        dbAll.mockRejectedValueOnce(new Error("DB Connection Error"));
        await expect(getReservationsByUser(3)).rejects.toThrow("DB Connection Error");
    });
});

describe("Update reservation", () => {


    it("Updates an existing reservation successfully", async () => {
        let isUpdated = false;

        dbGet.mockImplementation(async (query) => {
            const q = query.toUpperCase();

            // Controllo prenotazioni duplicate
            if (q.includes('RESERVATION_ID <>')) {
                return null;
            }

            // Recupero prenotazione
            if (q.includes('FROM RESERVATIONS')) {
                return isUpdated
                    ? {
                        reservationId: 1,
                        slotId: 2,
                        startAt: '2026-11-05 12:00',
                        endAt: '2026-11-05 14:00',
                        partySize: 7,
                        status: 'confirmed',
                        createdAt: '2026-11-01 10:00'
                    }
                    : {
                        reservationId: 1,
                        slotId: 1,
                        userId: 3,
                        partySize: 5,
                        status: 'confirmed',
                        secondsUntilStart: 72 * 60 * 60
                    };
            }

            // Recupero slot
            if (q.includes('FROM SLOTS')) {
                return {
                    slotId: 2,
                    secondsUntilStart: 10000
                };
            }

            return null;
        });

        dbAll.mockImplementation(async (query) => {
            const q = query.toUpperCase();

            // Requisiti prenotazione
            if (q.includes('FROM RESERVATION_REQUIREMENTS')) {
                return [{
                    id: 2,
                    peopleCount: 2,
                    description: 'lactose intollerance',
                    isAllergy: 1
                }];
            }

            // Disponibilità tavoli: checkAvailability()
            if (q.includes('FROM SLOT_TABLES')) {
                return [{
                    slotTableId: 10,
                    tableId: 5,
                    tableCode: 'T1',
                    totalSeats: 100,
                    occupiedSeats: 0
                }];
            }

            // Tavoli associati alla prenotazione
            if (q.includes('FROM RESERVATION_TABLE')) {
                return [{
                    reservationId: 1,
                    tableId: 5,
                    tableCode: 'T1',
                    allocatedSeats: 7
                }];
            }

            return [];
        });

        dbRun.mockImplementation(async (query) => {
            const q = query.toUpperCase();

            if (q.includes('UPDATE RESERVATIONS')) {
                isUpdated = true;
            }

            return { changes: 1 };
        });

        const update = await updateReservation(1, 3, {
            slotId: 2,
            partySize: 7,
            requirements: {
                update: [{
                    id: 2,
                    peopleCount: 2,
                    description: 'lactose intollerance',
                    isAllergy: true
                }],
                remove: [],
                add: []
            }
        });

        expect(update).toEqual({
            reservationId: 1,
            slotId: 2,
            startAt: '2026-11-05 12:00',
            endAt: '2026-11-05 14:00',
            partySize: 7,
            status: 'confirmed',
            createdAt: '2026-11-01 10:00',
            requirements: [{
                id: 2,
                peopleCount: 2,
                description: 'lactose intollerance',
                isAllergy: true
            }],
            tableAllocation: [{
                reservationId: 1,
                tableId: 5,
                tableCode: 'T1',
                allocatedSeats: 7
            }]
        });
    });

    it("Throws an error if there are no available tables (ConflictError)", async () => {
        dbGet.mockImplementation(async (query) => {
            const q = query.toUpperCase();
            if (q.includes('LIMIT 1')) return null;
            if (q.includes('FROM RESERVATIONS')) return { reservationId: 1, userId: 3, partySize: 5, status: 'confirmed', secondsUntilStart: 72 * 60 * 60 };
            if (q.includes('FROM SLOTS')) return { slotId: 2, secondsUntilStart: 10000 };
            return null;
        });

        dbAll.mockResolvedValue([]);

        await expect(updateReservation(1, 3, { slotId: 2, partySize: 7 }))
            .rejects.toThrow('NO_AVAILABILITY');
    });

    it("Throws an error if the reservation does not exist (NotFoundError)", async () => {
        dbGet.mockResolvedValueOnce(null);
        await expect(updateReservation(99, 3, { partySize: 2 })).rejects.toThrow('RESERVATION_NOT_FOUND');
    });

    it("Throws an error if the booked slot starts in less than 48 hours (ConflictError)", async () => {
        dbGet.mockResolvedValueOnce({
            reservationId: 1, userId: 3, status: 'confirmed', secondsUntilStart: 47 * 60 * 60
        });

        await expect(updateReservation(1, 3, { partySize: 2 })).rejects.toThrow('EDIT_WINDOW_EXPIRED');
    });

    it("Still admits changes exactly 48 hours before the booked slot", async () => {
        dbGet.mockImplementation(async (query) => {
            const q = query.toUpperCase();
            if (q.includes('LIMIT 1')) return null;
            if (q.includes('FROM RESERVATIONS')) return { reservationId: 1, userId: 3, partySize: 5, status: 'confirmed', secondsUntilStart: 48 * 60 * 60 };
            if (q.includes('FROM SLOTS')) return { slotId: 2, secondsUntilStart: 10000 };
            return null;
        });
        dbAll.mockResolvedValue([]);

        // The edit window is passed, so the change fails later, on the availability check
        await expect(updateReservation(1, 3, { slotId: 2, partySize: 7 })).rejects.toThrow('NO_AVAILABILITY');
    });

});

describe("Get reservation by user", () => {
    it("returns a list of reservations made by a certain hiker", async () => {

        dbAll.mockResolvedValueOnce([{
            reservationId: 1,
            slotId: 1,
            startAt: '2026-11-05 12:00',
            endAt: '2026-11-05 14:00',
            partySize: 5,
            status: 'confirmed',
            createdAt: '2026-11-01 10:00'
        }]);

        dbAll.mockResolvedValueOnce([{
            reservationId: 1,
            id: 2,
            peopleCount: 2,
            description: 'vegetarian',
            isAllergy: 0
        }]);

        dbAll.mockResolvedValueOnce([{
            reservationId: 1,
            tableId: 5,
            tableCode: 'T1',
            allocatedSeats: 5
        }]);

        const list = await getReservationsByUser(3);

        expect(list).toEqual([{
            reservationId: 1,
            slotId: 1,
            startAt: '2026-11-05 12:00',
            endAt: '2026-11-05 14:00',
            partySize: 5,
            status: 'confirmed',
            createdAt: '2026-11-01 10:00',
            requirements: [{
                id: 2,
                peopleCount: 2,
                description: 'vegetarian',
                isAllergy: false
            }],
            tableAllocation: [{
                tableId: 5,
                tableCode: 'T1',
                allocatedSeats: 5
            }]
        }]);
    });


    it("returns an empty array if user has no reservations", async () => {
        dbAll.mockResolvedValueOnce([]);

        const result = await getReservationsByUser(1);

        expect(result).toEqual([]);
    });

    it("returns a reservation with empty tables and requirements if none of them exist", async () => {
        dbAll
            .mockResolvedValueOnce([{ reservationId: 1, slotId: 1 }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);

        const result = await getReservationsByUser(3);

        expect(result).toEqual([{
            reservationId: 1,
            slotId: 1,
            requirements: [],
            tableAllocation: []
        }]);
    })
    it("throws an error if the database query fails", async () => {
        dbAll.mockRejectedValueOnce(new Error("DB Connection Error"));

        await expect(getReservationsByUser(3)).rejects.toThrow("DB Connection Error");
    });
});
