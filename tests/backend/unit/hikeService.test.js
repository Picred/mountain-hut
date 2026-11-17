import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../backend/models/dao/hikeDAO.js', () => ({
    createHike: vi.fn(),
}));

import { createHike } from '../../../backend/models/dao/hikeDAO.js';
import { registerHike } from '../../../backend/services/hikeService.js';
import BadRequestError from '../../../backend/models/errors/BadRequestError.js';

describe('hikeService - registerHike', () => {
    const userId = 10;

    const validHikeData = {
        destination: 'Monte Viso',
        route: 'Pian del Re - Colle delle Traversette',
        scheduledDeparture: '2028-06-01T08:00:00Z',
        expectedArrival: '2028-06-01T17:00:00Z',
        partySize: 3,
        passages: ['Pian del Re', 'Colle delle Traversette']
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('successfully registers a hike with valid data and normalized fields', async () => {
        const fakeCreatedHike = {
            hikeId: 1,
            userId,
            ...validHikeData,
            status: 'scheduled'
        };
        createHike.mockResolvedValueOnce(fakeCreatedHike);

        const result = await registerHike(userId, {
            ...validHikeData,
            destination: '   Monte Viso   ',
            route: '   Pian del Re - Colle delle Traversette   ',
            passages: ['  Pian del Re  ', '  Colle delle Traversette  ']
        });

        expect(createHike).toHaveBeenCalledTimes(1);
        expect(createHike).toHaveBeenCalledWith(userId, {
            destination: 'Monte Viso',
            route: 'Pian del Re - Colle delle Traversette',
            scheduledDeparture: new Date('2028-06-01T08:00:00Z').toISOString(),
            expectedArrival: new Date('2028-06-01T17:00:00Z').toISOString(),
            partySize: 3,
            passages: ['Pian del Re', 'Colle delle Traversette']
        });
        expect(result).toEqual(fakeCreatedHike);
    });

    it('defaults passages to an empty array when not provided', async () => {
        const { passages, ...dataWithoutPassages } = validHikeData;
        createHike.mockResolvedValueOnce({ hikeId: 2 });

        await registerHike(userId, dataWithoutPassages);

        expect(createHike).toHaveBeenCalledWith(userId, expect.objectContaining({
            passages: []
        }));
    });

    it('normalizes offset timezones (e.g. +02:00) to UTC ISO string', async () => {
        createHike.mockResolvedValueOnce({ hikeId: 3 });

        await registerHike(userId, {
            ...validHikeData,
            scheduledDeparture: '2028-06-01T10:00:00+02:00',
            expectedArrival: '2028-06-01T19:00:00+02:00'
        });

        expect(createHike).toHaveBeenCalledWith(userId, expect.objectContaining({
            scheduledDeparture: '2028-06-01T08:00:00.000Z',
            expectedArrival: '2028-06-01T17:00:00.000Z'
        }));
    });

    describe('validation - INVALID_INPUT', () => {
        it.each([
            ['null', null],
            ['undefined', undefined],
            ['a number', 123],
            ['a string', 'not-an-object'],
            ['an array', []],
        ])('throws BadRequestError(INVALID_INPUT) when data is %s', async (_, invalidData) => {
            await expect(registerHike(userId, invalidData)).rejects.toThrow(BadRequestError);
            await expect(registerHike(userId, invalidData)).rejects.toMatchObject({ message: 'INVALID_INPUT' });
            expect(createHike).not.toHaveBeenCalled();
        });

        it.each([
            ['destination is missing', { ...validHikeData, destination: undefined }],
            ['destination is not a string', { ...validHikeData, destination: 123 }],
            ['destination is empty', { ...validHikeData, destination: '' }],
            ['destination is only whitespace', { ...validHikeData, destination: '   ' }],
            ['route is missing', { ...validHikeData, route: undefined }],
            ['route is empty', { ...validHikeData, route: '' }],
            ['route is only whitespace', { ...validHikeData, route: '   ' }],
            ['scheduledDeparture is missing', { ...validHikeData, scheduledDeparture: undefined }],
            ['scheduledDeparture is empty', { ...validHikeData, scheduledDeparture: ' ' }],
            ['expectedArrival is missing', { ...validHikeData, expectedArrival: undefined }],
            ['expectedArrival is empty', { ...validHikeData, expectedArrival: ' ' }],
            ['partySize is missing', { ...validHikeData, partySize: undefined }],
            ['partySize is not a number', { ...validHikeData, partySize: '3' }],
            ['partySize is float', { ...validHikeData, partySize: 3.5 }],
            ['partySize is zero', { ...validHikeData, partySize: 0 }],
            ['partySize is negative', { ...validHikeData, partySize: -2 }],
        ])('throws BadRequestError(INVALID_INPUT) when %s', async (_, badData) => {
            await expect(registerHike(userId, badData)).rejects.toThrow(BadRequestError);
            await expect(registerHike(userId, badData)).rejects.toMatchObject({ message: 'INVALID_INPUT' });
            expect(createHike).not.toHaveBeenCalled();
        });

        it.each([
            ['passages is not an array', { ...validHikeData, passages: 'Pian del Re' }],
            ['passages contains non-string element', { ...validHikeData, passages: ['Passage 1', 123] }],
            ['passages contains empty string', { ...validHikeData, passages: ['Passage 1', ''] }],
            ['passages contains whitespace-only string', { ...validHikeData, passages: ['   '] }],
        ])('throws BadRequestError(INVALID_INPUT) when %s', async (_, badData) => {
            await expect(registerHike(userId, badData)).rejects.toThrow(BadRequestError);
            await expect(registerHike(userId, badData)).rejects.toMatchObject({ message: 'INVALID_INPUT' });
            expect(createHike).not.toHaveBeenCalled();
        });
    });

    describe('validation - INVALID_DATE', () => {
        it.each([
            ['malformed date string', 'not-a-date'],
            ['missing time', '2028-06-01'],
            ['missing timezone', '2028-06-01T10:00:00'],
            ['invalid month', '2028-13-01T10:00:00Z'],
            ['invalid day in calendar (Feb 30)', '2028-02-30T10:00:00Z'],
            ['invalid day in non-leap year (Feb 29)', '2027-02-29T10:00:00Z'],
            ['invalid hour (24)', '2028-06-01T24:00:00Z'],
            ['invalid minute (60)', '2028-06-01T10:60:00Z'],
            ['invalid second (60)', '2028-06-01T10:00:60Z'],
            ['timezone offset hours out of range (+15:00)', '2028-06-01T10:00:00+15:00'],
            ['timezone offset +14:01 out of range', '2028-06-01T10:00:00+14:01'],
            ['timezone offset minutes out of range (+02:60)', '2028-06-01T10:00:00+02:60'],
        ])('throws BadRequestError(INVALID_DATE) when scheduledDeparture has %s', async (_, badDate) => {
            await expect(registerHike(userId, {
                ...validHikeData,
                scheduledDeparture: badDate
            })).rejects.toThrow(BadRequestError);

            await expect(registerHike(userId, {
                ...validHikeData,
                scheduledDeparture: badDate
            })).rejects.toMatchObject({ message: 'INVALID_DATE' });

            expect(createHike).not.toHaveBeenCalled();
        });

        it('throws BadRequestError(INVALID_DATE) when expectedArrival has invalid date format', async () => {
            await expect(registerHike(userId, {
                ...validHikeData,
                expectedArrival: '2028-06-01T17:00:00'
            })).rejects.toThrow(BadRequestError);

            await expect(registerHike(userId, {
                ...validHikeData,
                expectedArrival: '2028-06-01T17:00:00'
            })).rejects.toMatchObject({ message: 'INVALID_DATE' });

            expect(createHike).not.toHaveBeenCalled();
        });
    });

    describe('validation - INVALID_TIME_RANGE and DEPARTURE_IN_THE_PAST', () => {
        it('throws BadRequestError(INVALID_TIME_RANGE) when arrival is before departure', async () => {
            await expect(registerHike(userId, {
                ...validHikeData,
                scheduledDeparture: '2028-06-01T12:00:00Z',
                expectedArrival: '2028-06-01T10:00:00Z'
            })).rejects.toThrow(BadRequestError);

            await expect(registerHike(userId, {
                ...validHikeData,
                scheduledDeparture: '2028-06-01T12:00:00Z',
                expectedArrival: '2028-06-01T10:00:00Z'
            })).rejects.toMatchObject({ message: 'INVALID_TIME_RANGE' });

            expect(createHike).not.toHaveBeenCalled();
        });

        it('throws BadRequestError(INVALID_TIME_RANGE) when arrival is equal to departure', async () => {
            await expect(registerHike(userId, {
                ...validHikeData,
                scheduledDeparture: '2028-06-01T12:00:00Z',
                expectedArrival: '2028-06-01T12:00:00Z'
            })).rejects.toThrow(BadRequestError);

            await expect(registerHike(userId, {
                ...validHikeData,
                scheduledDeparture: '2028-06-01T12:00:00Z',
                expectedArrival: '2028-06-01T12:00:00Z'
            })).rejects.toMatchObject({ message: 'INVALID_TIME_RANGE' });

            expect(createHike).not.toHaveBeenCalled();
        });

        it('throws BadRequestError(DEPARTURE_IN_THE_PAST) when scheduledDeparture is in the past', async () => {
            const pastDeparture = '2020-01-01T08:00:00Z';
            const pastArrival = '2020-01-01T17:00:00Z';

            await expect(registerHike(userId, {
                ...validHikeData,
                scheduledDeparture: pastDeparture,
                expectedArrival: pastArrival
            })).rejects.toThrow(BadRequestError);

            await expect(registerHike(userId, {
                ...validHikeData,
                scheduledDeparture: pastDeparture,
                expectedArrival: pastArrival
            })).rejects.toMatchObject({ message: 'DEPARTURE_IN_THE_PAST' });

            expect(createHike).not.toHaveBeenCalled();
        });
    });
});
