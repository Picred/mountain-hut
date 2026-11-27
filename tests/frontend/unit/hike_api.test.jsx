import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import hikeAPI from '../../../frontend/src/api/hike_api.js';

const SERVER_URL = 'http://localhost:3001';

function mockResponse({ ok = true, status = 200, body = {}, invalidJson = false } = {}) {
    return {
        ok,
        status,
        json: invalidJson
            ? vi.fn().mockRejectedValue(new SyntaxError('Invalid JSON'))
            : vi.fn().mockResolvedValue(body),
    };
}

let fetchMock;

beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('hikeAPI.registerHike', () => {
    const hikePayload = {
        destination: 'Monte Viso',
        route: 'Pian del Re - Colle delle Traversette',
        scheduledDeparture: '2028-06-01T08:00:00.000Z',
        expectedArrival: '2028-06-01T17:00:00.000Z',
        partySize: 3,
        passages: ['Pian del Re', 'Colle delle Traversette']
    };

    it('sends POST /api/hikes with JSON payload and credentials: include', async () => {
        const fakeCreatedHike = {
            hikeId: 10,
            userId: 3,
            ...hikePayload,
            status: 'scheduled'
        };
        fetchMock.mockResolvedValueOnce(mockResponse({ status: 201, body: fakeCreatedHike }));

        const result = await hikeAPI.registerHike(hikePayload);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(`${SERVER_URL}/api/hikes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify(hikePayload)
        });
        expect(result).toEqual(fakeCreatedHike);
    });

    it('throws error with message when status is 401 Unauthorized', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 401, body: { error: 'UNAUTHORIZED' } }));

        await expect(hikeAPI.registerHike(hikePayload)).rejects.toThrow(
            'Please log in before registering a hike.'
        );
    });

    it('throws error with message when status is 403 Forbidden', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 403, body: { error: 'FORBIDDEN' } }));

        await expect(hikeAPI.registerHike(hikePayload)).rejects.toThrow(
            'Only hikers can register a hike.'
        );
    });

    it.each([
        ['INVALID_INPUT', 'Check the hike details and try again.'],
        ['INVALID_DATE', 'Enter valid departure and arrival dates.'],
        ['INVALID_TIME_RANGE', 'Expected arrival must be after departure.'],
        ['DEPARTURE_IN_THE_PAST', 'Departure must be in the future.'],
        ['HIKE_TIME_CONFLICT', 'You already have another scheduled hike during this period. Choose a different time.'],
    ])('maps error code %s to expected user message', async (errorCode, expectedMessage) => {
        fetchMock.mockResolvedValueOnce(mockResponse({
            ok: false,
            status: errorCode === 'HIKE_TIME_CONFLICT' ? 409 : 400,
            body: { error: errorCode }
        }));

        await expect(hikeAPI.registerHike(hikePayload)).rejects.toThrow(expectedMessage);
    });

    it('falls back to generic 500 error message when response status is >= 500 and no mapped code', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({
            ok: false,
            status: 500,
            body: { error: 'SOMETHING_BROKE' }
        }));

        await expect(hikeAPI.registerHike(hikePayload)).rejects.toThrow(
            'The hike could not be registered because of a server error. Please try again.'
        );
    });

    it('falls back to generic 4xx error message when error code is unknown and status < 500', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({
            ok: false,
            status: 400,
            body: { error: 'UNKNOWN_ERROR_CODE' }
        }));

        await expect(hikeAPI.registerHike(hikePayload)).rejects.toThrow(
            'The hike could not be registered. Check the details and try again.'
        );
    });

    it('handles response where response.json() fails', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({
            ok: false,
            status: 502,
            invalidJson: true
        }));

        await expect(hikeAPI.registerHike(hikePayload)).rejects.toThrow(
            'The hike could not be registered because of a server error. Please try again.'
        );
    });

    describe('hikeAPI.getOverdueHikes', () => {

        it('sends GET /api/hikes/missing with credentials: include and returns missing hikers', async () => {
            const hikes = [
                {
                    hikeId: 1,
                    hiker: {
                        name: 'Mario Rossi',
                        email: 'mario@example.com',
                        phone: '3331234567',
                    },
                    destination: 'Monte Viso',
                    expectedArrival: '2028-06-10T09:00:00.000Z',
                    alertNumber: 1,
                    totalAlerts: 5,
                },
            ];

            fetchMock.mockResolvedValueOnce(
                mockResponse({ body: hikes })
            );

            const result = await hikeAPI.getOverdueHikes();

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock).toHaveBeenCalledWith(
                `${SERVER_URL}/api/hikes/missing`,
                {
                    method: 'GET',
                    credentials: 'include',
                }
            );
            expect(result).toEqual(hikes);
        });

        it('returns an empty array when there are no missing hikers', async () => {
            fetchMock.mockResolvedValueOnce(
                mockResponse({ body: [] })
            );

            await expect(hikeAPI.getOverdueHikes()).resolves.toEqual([]);
        });

        it('returns multiple missing hikers with their alert information', async () => {
            const hikes = [
                {
                    hikeId: 1,
                    hiker: { name: 'Mario Rossi' },
                    alertNumber: 1,
                    totalAlerts: 5,
                },
                {
                    hikeId: 2,
                    hiker: { name: 'Anna Bianchi' },
                    alertNumber: 3,
                    totalAlerts: 5,
                },
            ];

            fetchMock.mockResolvedValueOnce(
                mockResponse({ body: hikes })
            );

            await expect(hikeAPI.getOverdueHikes()).resolves.toEqual(hikes);
        });

        it.each([
            [401, 'Please log in to see the missing hikers'],
            [403, 'Only employees see overdue hikes.'],
        ])('throws the correct authorization error for HTTP %i', async (status, message) => {
            fetchMock.mockResolvedValueOnce(
                mockResponse({ ok: false, status })
            );

            await expect(
                hikeAPI.getOverdueHikes()
            ).rejects.toThrow(message);
        });

        it.each([
            [400, 'Unable to load missing hikers. Please try again.'],
            [404, 'Unable to load missing hikers. Please try again.'],
            [500, 'A server error occurred while loading missing hikers. Please try again.'],
            [503, 'A server error occurred while loading missing hikers. Please try again.'],
        ])('throws the correct fallback error for HTTP %i', async (status, message) => {
            fetchMock.mockResolvedValueOnce(
                mockResponse({ ok: false, status })
            );

            await expect(
                hikeAPI.getOverdueHikes()
            ).rejects.toThrow(message);
        });

        it('propagates network errors', async () => {
            fetchMock.mockRejectedValueOnce(
                new TypeError('Failed to fetch')
            );

            await expect(
                hikeAPI.getOverdueHikes()
            ).rejects.toThrow('Failed to fetch');
        });

        it('uses a fallback error when the server returns invalid JSON for an unsuccessful response', async () => {
            fetchMock.mockResolvedValueOnce(
                mockResponse({
                    ok: false,
                    status: 500,
                    invalidJson: true,
                })
            );

            await expect(
                hikeAPI.getOverdueHikes()
            ).rejects.toThrow(
                'A server error occurred while loading missing hikers. Please try again.'
            );
        });

        it('propagates invalid JSON errors on successful responses', async () => {
            fetchMock.mockResolvedValueOnce(
                mockResponse({ invalidJson: true })
            );

            await expect(
                hikeAPI.getOverdueHikes()
            ).rejects.toThrow(SyntaxError);
        });
    });

});
