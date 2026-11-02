
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database helpers to avoid using a real database.
vi.mock('../../../backend/utils/dbHelpers.js', () => ({
    dbAll: vi.fn(),
    dbGet: vi.fn(),
}));

vi.mock('../../../backend/models/dao/slotDAO.js', () => ({
    getSlotsByDate: vi.fn(),
    getSecondsUntilStart: vi.fn(),
}));

vi.mock('../../../backend/models/dao/reservationDAO.js', () => ({
    checkAvailability: vi.fn(),
}));


import { dbGet, dbAll } from '../../../backend/utils/dbHelpers.js';

import {
    getSlotsByDate as getSlotsByDateMock,
    getSecondsUntilStart as getSecondsUntilStartMock,
} from '../../../backend/models/dao/slotDAO.js';

import {
    checkAvailability as checkAvailabilityMock,
} from '../../../backend/models/dao/reservationDAO.js';

import router from '../../../backend/api/slotRoutes.js';
import BadRequestError from '../../../backend/models/errors/BadRequestError.js';
import NotFoundError from '../../../backend/models/errors/NotFoundError.js';


// Import the actual DAO implementation, keeping only its database dependency mocked.
const { getSecondsUntilStart, getSlotsByDate } = await vi.importActual(
    '../../../backend/models/dao/slotDAO.js'
);

function handler(method, path) {
    const layer = router.stack.find(
        (l) => l.route?.path === path && l.route.methods[method]
    );
    return layer.route.stack.at(-1).handle;
}

function fakeRes() {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    res.end = vi.fn(() => res);
    return res;
}


beforeEach(() => {
    vi.clearAllMocks();
});

describe('slotDAO', () => {
    describe('getSecondsUntilStart', () => {
        it('returns the seconds until the slot starts when the slot exists', async () => {
            dbGet.mockResolvedValue({ secondsUntilStart: 10800 });

            const result = await getSecondsUntilStart(1);

            expect(result).toBe(10800);
            expect(dbGet).toHaveBeenCalledWith(
                expect.stringContaining('WHERE slot_id = ?'),
                [1]
            );
        });

        it('returns null when the slot does not exist', async () => {
            dbGet.mockResolvedValue(undefined);

            await expect(getSecondsUntilStart(99)).resolves.toBeNull();
            expect(dbGet).toHaveBeenCalledWith(
                expect.any(String),
                [99]
            );
        });

        it('propagates database errors', async () => {
            dbGet.mockRejectedValue(new Error('Database error'));

            await expect(getSecondsUntilStart(1)).rejects.toThrow('Database error');
        });
    });


    describe('getSlotsByDate', () => {
        it('returns slots with the correct booking restrictions', async () => {
            dbAll.mockResolvedValue([
                {
                    slot_id: 1,
                    startTime: '12:00',
                    endTime: '14:00',
                    secondsUntilStart: 10800,
                },
                {
                    slot_id: 2,
                    startTime: '19:00',
                    endTime: '21:00',
                    secondsUntilStart: 3600,
                },
            ]);

            const result = await getSlotsByDate('2026-11-15');

            expect(dbAll).toHaveBeenCalledWith(
                expect.any(String),
                ['2026-11-15']
            );

            expect(result).toEqual([
                {
                    slotId: 1,
                    startTime: '12:00',
                    endTime: '14:00',
                    bookingAllowed: true,
                    restrictionReason: null,
                },
                {
                    slotId: 2,
                    startTime: '19:00',
                    endTime: '21:00',
                    bookingAllowed: false,
                    restrictionReason: 'Less than 2 hours',
                },
            ]);
        });

        it('allows booking exactly 2 hours before the slot starts', async () => {
            dbAll.mockResolvedValue([
                {
                    slot_id: 1,
                    startTime: '12:00',
                    endTime: '14:00',
                    secondsUntilStart: 7200,
                },
                {
                    slot_id: 2,
                    startTime: '13:00',
                    endTime: '15:00',
                    secondsUntilStart: 7199,
                },
            ]);

            const result = await getSlotsByDate('2026-11-15');

            expect(result[0].bookingAllowed).toBe(true);
            expect(result[0].restrictionReason).toBeNull();

            expect(result[1].bookingAllowed).toBe(false);
            expect(result[1].restrictionReason).toBe('Less than 2 hours');
        });

        it('returns an empty array when no slots exist for the date', async () => {
            dbAll.mockResolvedValue([]);

            const result = await getSlotsByDate('2026-11-15');

            expect(dbAll).toHaveBeenCalledWith(
                expect.any(String),
                ['2026-11-15']
            );

            expect(result).toEqual([]);
        });

        it('propagates database errors', async () => {
            dbAll.mockRejectedValue(new Error('Database error'));

            await expect(
                getSlotsByDate('2026-11-15')
            ).rejects.toThrow('Database error');

            expect(dbAll).toHaveBeenCalledWith(
                expect.any(String),
                ['2026-11-15']
            );
        });

    });

});


describe('slotRoutes', () => {
    describe('GET /api/slots/:slotId/availability', () => {
        const getAvailability = handler('get', '/:slotId/availability');

        it('rejects invalid slot IDs with BadRequestError', async () => {
            const invalidIds = ['0', '-1', 'abc', '1.5'];

            for (const slotId of invalidIds) {
                const req = {
                    params: { slotId },
                    query: { partySize: '2' },
                };

                await expect(
                    getAvailability(req, fakeRes())
                ).rejects.toMatchObject({
                    constructor: BadRequestError,
                    message: 'INVALID_INPUT',
                    status: 400,
                });
            }

            expect(getSecondsUntilStartMock).not.toHaveBeenCalled();
            expect(checkAvailabilityMock).not.toHaveBeenCalled();
        });

        it('rejects invalid party sizes with BadRequestError', async () => {
            const invalidSizes = [undefined, '0', '-2', 'abc', '2.5'];

            for (const partySize of invalidSizes) {
                const req = {
                    params: { slotId: '1' },
                    query: { partySize },
                };

                await expect(
                    getAvailability(req, fakeRes())
                ).rejects.toBeInstanceOf(BadRequestError);
            }

            expect(getSecondsUntilStartMock).not.toHaveBeenCalled();
            expect(checkAvailabilityMock).not.toHaveBeenCalled();
        });

        it('rejects with NotFoundError when the slot does not exist', async () => {
            getSecondsUntilStartMock.mockResolvedValue(null);

            const req = {
                params: { slotId: '99' },
                query: { partySize: '3' },
            };

            const res = fakeRes();

            await expect(
                getAvailability(req, res)
            ).rejects.toMatchObject({
                constructor: NotFoundError,
                message: 'SLOT_NOT_FOUND',
                status: 404,
            });

            expect(getSecondsUntilStartMock).toHaveBeenCalledWith(99);
            expect(checkAvailabilityMock).not.toHaveBeenCalled();
            expect(res.json).not.toHaveBeenCalled();
        });


        it('returns unavailable when the slot starts in less than 2 hours', async () => {
            getSecondsUntilStartMock.mockResolvedValue(7199);

            const req = {
                params: { slotId: '1' },
                query: { partySize: '3' },
            };

            const res = fakeRes();

            await getAvailability(req, res);

            expect(getSecondsUntilStartMock).toHaveBeenCalledWith(1);
            expect(checkAvailabilityMock).not.toHaveBeenCalled();

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                slotId: 1,
                partySize: 3,
                available: false,
                tableAllocation: [],
            });
        });


        it('checks availability when the slot starts in exactly 2 hours', async () => {
            getSecondsUntilStartMock.mockResolvedValue(7200);

            checkAvailabilityMock.mockResolvedValue({
                available: true,
                tableAllocation: [
                    {
                        tableId: 2,
                        tableCode: 'T2',
                        allocatedSeats: 3,
                    },
                ],
            });

            const req = {
                params: { slotId: '1' },
                query: { partySize: '3' },
            };

            const res = fakeRes();

            await getAvailability(req, res);

            expect(getSecondsUntilStartMock).toHaveBeenCalledWith(1);
            expect(checkAvailabilityMock).toHaveBeenCalledWith(1, 3);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                slotId: 1,
                partySize: 3,
                available: true,
                tableAllocation: [
                    {
                        tableId: 2,
                        tableCode: 'T2',
                        allocatedSeats: 3,
                    },
                ],
            });
        });


        it('returns availability with allocation across multiple tables', async () => {
            getSecondsUntilStartMock.mockResolvedValue(10800);

            checkAvailabilityMock.mockResolvedValue({
                available: true,
                tableAllocation: [
                    {
                        slotTableId: 10,
                        tableId: 1,
                        tableCode: 'T1',
                        allocatedSeats: 4,
                    },
                    {
                        slotTableId: 11,
                        tableId: 2,
                        tableCode: 'T2',
                        allocatedSeats: 2,
                    },
                ],
            });

            const req = {
                params: { slotId: '5' },
                query: { partySize: '6' },
            };

            const res = fakeRes();

            await getAvailability(req, res);

            expect(getSecondsUntilStartMock).toHaveBeenCalledWith(5);
            expect(checkAvailabilityMock).toHaveBeenCalledWith(5, 6);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                slotId: 5,
                partySize: 6,
                available: true,
                tableAllocation: [
                    {
                        tableId: 1,
                        tableCode: 'T1',
                        allocatedSeats: 4,
                    },
                    {
                        tableId: 2,
                        tableCode: 'T2',
                        allocatedSeats: 2,
                    },
                ],
            });
        });


        it('returns unavailable when there are not enough free seats', async () => {
            getSecondsUntilStartMock.mockResolvedValue(10800);

            checkAvailabilityMock.mockResolvedValue({
                available: false,
                tableAllocation: [],
            });

            const req = {
                params: { slotId: '5' },
                query: { partySize: '10' },
            };

            const res = fakeRes();

            await getAvailability(req, res);

            expect(getSecondsUntilStartMock).toHaveBeenCalledWith(5);
            expect(checkAvailabilityMock).toHaveBeenCalledWith(5, 10);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                slotId: 5,
                partySize: 10,
                available: false,
                tableAllocation: [],
            });
        });


        it('propagates errors from checkAvailability', async () => {
            getSecondsUntilStartMock.mockResolvedValue(10800);
            checkAvailabilityMock.mockRejectedValue(new Error('Database error'));

            const req = {
                params: { slotId: '5' },
                query: { partySize: '4' },
            };

            const res = fakeRes();

            await expect(
                getAvailability(req, res)
            ).rejects.toThrow('Database error');

            expect(getSecondsUntilStartMock).toHaveBeenCalledWith(5);
            expect(checkAvailabilityMock).toHaveBeenCalledWith(5, 4);
            expect(res.json).not.toHaveBeenCalled();
        });

    });


    describe('GET /api/slots', () => {
        const getSlots = handler('get', '/');

        it('returns slots for a valid date', async () => {
            const slots = [
                {
                    slotId: 1,
                    startTime: '12:00',
                    endTime: '14:00',
                    bookingAllowed: true,
                    restrictionReason: null,
                },
                {
                    slotId: 2,
                    startTime: '19:00',
                    endTime: '21:00',
                    bookingAllowed: false,
                    restrictionReason: 'Less than 2 hours',
                },
            ];

            getSlotsByDateMock.mockResolvedValue(slots);

            const req = {
                query: { date: '2026-11-15' },
            };

            const res = fakeRes();

            await getSlots(req, res);

            expect(getSlotsByDateMock).toHaveBeenCalledWith('2026-11-15');
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(slots);
        });


        it('rejects invalid dates with BadRequestError', async () => {
            const invalidDates = [
                undefined,
                '',
                '15-11-2026',
                '2026/11/15',
                '2026-02-30',
                'invalid-date',
            ];

            for (const date of invalidDates) {
                const req = {
                    query: { date },
                };

                const res = fakeRes();

                await expect(
                    getSlots(req, res)
                ).rejects.toBeInstanceOf(BadRequestError);

                expect(res.json).not.toHaveBeenCalled();
            }

            expect(getSlotsByDateMock).not.toHaveBeenCalled();
        });


        it('returns an empty array when no slots are found', async () => {
            getSlotsByDateMock.mockResolvedValue([]);

            const req = {
                query: { date: '2026-11-15' },
            };

            const res = fakeRes();

            await getSlots(req, res);

            expect(getSlotsByDateMock).toHaveBeenCalledWith('2026-11-15');
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith([]);
        });


        it('propagates errors from getSlotsByDate', async () => {
            getSlotsByDateMock.mockRejectedValue(new Error('Database error'));

            const req = {
                query: { date: '2026-11-15' },
            };

            const res = fakeRes();

            await expect(
                getSlots(req, res)
            ).rejects.toThrow('Database error');

            expect(getSlotsByDateMock).toHaveBeenCalledWith('2026-11-15');
            expect(res.json).not.toHaveBeenCalled();
        });

    });

});

