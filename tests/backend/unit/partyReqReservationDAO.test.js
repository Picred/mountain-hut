import { describe, it, expect, vi, beforeEach } from 'vitest';

// Modules replaced BEFORE the DAO loads them (vi.mock is hoisted above the imports)
vi.mock('../../../backend/db/db.js', () => ({
    default: { get: vi.fn(), all: vi.fn(), run: vi.fn() },
    DB_PATH: ':memory:',
}));

vi.mock('../../../backend/utils/dbHelpers.js', () => ({
    dbAll: vi.fn(),
    dbGet: vi.fn(),
    dbRun: vi.fn(),
}));

import { makeReservation } from '../../../backend/models/dao/reservationDAO.js';
import { getBookingConfirmationData } from '../../../backend/models/dao/confirmationDAO.js';
import { dbAll, dbGet, dbRun } from '../../../backend/utils/dbHelpers.js';
import BadRequestError from '../../../backend/models/errors/BadRequestError.js';

const requirement = { peopleCount: 2, description: 'vegetarian', isAllergy: false };

beforeEach(() => {
    // Resets calls AND the queued answers: a test that fails early (validation error)
    // must not leave unused mockResolvedValueOnce values for the next test
    vi.resetAllMocks();

    // Happy path shared by every test: the slot exists and starts in about 3 hours,
    // the user has no reservation in it yet and there is one free table
    dbGet
        .mockResolvedValueOnce({ slotId: 1, secondsUntilStart: 10000 })
        .mockResolvedValueOnce(null);

    dbAll.mockResolvedValue([
        { slotTableId: 10, tableId: 1, tableCode: 'A1', totalSeats: 4, occupiedSeats: 0 },
    ]);

    dbRun
        .mockResolvedValueOnce({ lastID: 0, changes: 0 })
        .mockResolvedValueOnce({ lastID: 0, changes: 0 })
        .mockResolvedValueOnce({ lastID: 42, changes: 1 })
        .mockResolvedValueOnce({ lastID: 1, changes: 1 })
        .mockResolvedValueOnce({ lastID: 0, changes: 0 });
});

describe('makeReservation', () => {
    it('creates a reservation with valid requirements', async () => {
        const reservation = await makeReservation(1, 5, 2, [requirement]);

        expect(reservation.requirements).toEqual([requirement]);
    });

    it.each([
        ['they are not an array', requirement],
        ['peopleCount is negative', [{ ...requirement, peopleCount: -1 }]],
        ['peopleCount exceeds the party size', [{ ...requirement, peopleCount: 200 }]],
        ['description is not a string', [{ ...requirement, description: 10 }]],
        ['description is empty', [{ ...requirement, description: '' }]],
        ['isAllergy is not a boolean', [{ ...requirement, isAllergy: 20 }]],
    ])('rejects the requirements when %s', async (_label, requirements) => {
        await expect(makeReservation(1, 5, 2, requirements)).rejects.toBeInstanceOf(BadRequestError);
    });
});
