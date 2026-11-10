import { describe, it, expect, vi, beforeEach } from 'vitest';

// The DAO only talks to the database through these helpers: replacing them is enough
vi.mock('../../../backend/utils/dbHelpers.js', () => ({
    dbGet: vi.fn(),
    dbAll: vi.fn(),
}));

import { getBookingConfirmationData } from '../../../backend/models/dao/confirmationDAO.js';
import { dbGet, dbAll } from '../../../backend/utils/dbHelpers.js';

// What the first query (reservation + slot + user) returns
const row = {
    reservation_id: 42,
    party_size: 3,
    start_at: '2030-01-15T18:30:00.000Z',
    end_at: '2030-01-15T20:00:00.000Z',
    name: 'Mario Rossi',
    email: 'mario@example.com',
};

beforeEach(() => {
    vi.resetAllMocks();
});

describe('getBookingConfirmationData', () => {
    it('returns null when the reservation does not exist and does not read the requirements', async () => {
        dbGet.mockResolvedValue(undefined);

        const data = await getBookingConfirmationData(42);

        expect(data).toBeNull();
        expect(dbAll).not.toHaveBeenCalled();
    });

    it('maps the database row to the booking data (no requirements)', async () => {
        dbGet.mockResolvedValue(row);
        dbAll.mockResolvedValue([]);

        const data = await getBookingConfirmationData(42);

        expect(data).toEqual({
            reservationId: 42,
            partySize: 3,
            startAt: '2030-01-15T18:30:00.000Z',
            endAt: '2030-01-15T20:00:00.000Z',
            hikerName: 'Mario Rossi',
            hikerEmail: 'mario@example.com',
            requirements: [],
        });
    });

    it('maps the requirements and converts is_allergy to a boolean', async () => {
        dbGet.mockResolvedValue(row);
        dbAll.mockResolvedValue([
            { people_count: 2, description: 'vegetarian', is_allergy: 0 },
            { people_count: 1, description: 'peanuts', is_allergy: 1 },
        ]);

        const data = await getBookingConfirmationData(42);

        expect(data.requirements).toEqual([
            { peopleCount: 2, description: 'vegetarian', isAllergy: false },
            { peopleCount: 1, description: 'peanuts', isAllergy: true },
        ]);
    });

    it('uses the reservation id in both queries', async () => {
        dbGet.mockResolvedValue(row);
        dbAll.mockResolvedValue([]);

        await getBookingConfirmationData(42);

        expect(dbGet.mock.calls[0][1]).toEqual([42]);
        expect(dbAll.mock.calls[0][1]).toEqual([42]);
    });

    it('propagates a database error on the reservation query', async () => {
        dbGet.mockRejectedValue(new Error('DB error'));

        await expect(getBookingConfirmationData(42)).rejects.toThrow('DB error');
    });

    it('propagates a database error on the requirements query', async () => {
        dbGet.mockResolvedValue(row);
        dbAll.mockRejectedValue(new Error('DB error'));

        await expect(getBookingConfirmationData(42)).rejects.toThrow('DB error');
    });
});