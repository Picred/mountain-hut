import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The component uses mocked API functions, while API tests use the real ones.
vi.mock('../../../frontend/src/api/hike_api', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        default: {
            ...actual.default,
            getHikerHikes: vi.fn(),
            confirmHikeArrival: vi.fn(),
        },
    };
});

import hikeAPI from '../../../frontend/src/api/hike_api';
import { MyHikesPage } from '../../../frontend/src/pages/MyHikesPage';

const { default: realAPI } = await vi.importActual(
    '../../../frontend/src/api/hike_api'
);

const SERVER_URL = 'http://localhost:3001';

function mockResponse({
    ok = true,
    status = 200,
    body = {},
    invalidJson = false,
} = {}) {
    return {
        ok,
        status,
        json: invalidJson
            ? vi.fn().mockRejectedValue(new SyntaxError('Invalid JSON'))
            : vi.fn().mockResolvedValue(body),
    };
}

const PAST_DEPARTURE = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const FUTURE_DEPARTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const makeHike = (overrides = {}) => ({
    hikeId: 1,
    status: 'scheduled',
    destination: 'Monte Bianco',
    route: 'Via Normale',
    scheduledDeparture: PAST_DEPARTURE,
    expectedArrival: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    partySize: 2,
    passages: [],
    ...overrides,
});

let fetchMock;

beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

// ============================================================
// API
// ============================================================

describe('getHikerHikes API', () => {
    it('sends a GET request and returns the hiker hikes', async () => {
        const hikes = [
            makeHike(),
            makeHike({ hikeId: 2, status: 'returned' }),
        ];

        fetchMock.mockResolvedValue(mockResponse({ body: hikes }));

        await expect(realAPI.getHikerHikes()).resolves.toEqual(hikes);

        expect(fetchMock).toHaveBeenCalledWith(
            `${SERVER_URL}/api/hikes`,
            {
                method: 'GET',
                credentials: 'include',
            }
        );
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('returns an empty array when the hiker has no hikes', async () => {
        fetchMock.mockResolvedValue(mockResponse({ body: [] }));

        await expect(realAPI.getHikerHikes()).resolves.toEqual([]);
    });

    it.each([
        [401, 'Please log in to view your hikes.'],
        [403, 'Only hikers can view their hikes.'],
        [400, 'Unable to load your hikes. Please try again.'],
        [404, 'Unable to load your hikes. Please try again.'],
        [500, 'A server error occurred while loading your hikes. Please try again.'],
        [503, 'A server error occurred while loading your hikes. Please try again.'],
    ])('throws the correct error for HTTP %i', async (status, message) => {
        fetchMock.mockResolvedValue(
            mockResponse({ ok: false, status })
        );

        await expect(realAPI.getHikerHikes()).rejects.toThrow(message);
    });

    it('propagates network errors', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(realAPI.getHikerHikes()).rejects.toThrow(
            'Failed to fetch'
        );
    });

    it('propagates invalid JSON errors on successful responses', async () => {
        fetchMock.mockResolvedValue(mockResponse({ invalidJson: true }));

        await expect(realAPI.getHikerHikes()).rejects.toThrow(SyntaxError);
    });
});

describe('confirmHikeArrival API', () => {
    it('sends a PUT request and returns the confirmed hike', async () => {
        const confirmed = {
            hikeId: 1,
            userId: 10,
            status: 'returned',
        };

        fetchMock.mockResolvedValue(
            mockResponse({ body: confirmed })
        );

        await expect(
            realAPI.confirmHikeArrival(1)
        ).resolves.toEqual(confirmed);

        expect(fetchMock).toHaveBeenCalledWith(
            `${SERVER_URL}/api/hikes/1/confirm-arrival`,
            {
                method: 'PUT',
                credentials: 'include',
            }
        );
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('uses the provided hike ID in the URL', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({
                body: { hikeId: 42, status: 'returned' },
            })
        );

        await realAPI.confirmHikeArrival(42);

        expect(fetchMock).toHaveBeenCalledWith(
            `${SERVER_URL}/api/hikes/42/confirm-arrival`,
            expect.objectContaining({ method: 'PUT' })
        );
    });

    it('does not send a request body', async () => {
        fetchMock.mockResolvedValue(mockResponse());

        await realAPI.confirmHikeArrival(1);

        const [, options] = fetchMock.mock.calls[0];

        expect(options).not.toHaveProperty('body');
    });

    it.each([
        [401, 'Please log in to confirm your safe arrival.'],
        [403, 'Only hikers can confirm a hike arrival.'],
    ])('throws the correct authorization error for HTTP %i', async (status, message) => {
        fetchMock.mockResolvedValue(
            mockResponse({ ok: false, status })
        );

        await expect(
            realAPI.confirmHikeArrival(1)
        ).rejects.toThrow(message);
    });

    it('throws a specific error when the hike is not found', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({
                ok: false,
                status: 404,
                body: { error: 'HIKE_NOT_FOUND' },
            })
        );

        await expect(
            realAPI.confirmHikeArrival(99)
        ).rejects.toThrow('This hike could not be found.');
    });

    it('throws a specific error when the hike is already confirmed', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({
                ok: false,
                status: 409,
                body: { error: 'HIKE_ALREADY_CONFIRMED' },
            })
        );

        await expect(
            realAPI.confirmHikeArrival(1)
        ).rejects.toThrow(
            'This hike has already been marked as returned.'
        );
    });

    it.each([
        [400, 'Unable to confirm your safe arrival. Please try again.'],
        [404, 'Unable to confirm your safe arrival. Please try again.'],
        [409, 'Unable to confirm your safe arrival. Please try again.'],
        [500, 'A server error occurred while confirming your arrival. Please try again.'],
        [503, 'A server error occurred while confirming your arrival. Please try again.'],
    ])('throws a fallback error for HTTP %i', async (status, message) => {
        fetchMock.mockResolvedValue(
            mockResponse({
                ok: false,
                status,
                body: {},
            })
        );

        await expect(
            realAPI.confirmHikeArrival(1)
        ).rejects.toThrow(message);
    });

    it('uses the fallback error when the server returns invalid JSON', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({
                ok: false,
                status: 409,
                invalidJson: true,
            })
        );

        await expect(
            realAPI.confirmHikeArrival(1)
        ).rejects.toThrow(
            'Unable to confirm your safe arrival. Please try again.'
        );
    });

    it('propagates network errors', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(
            realAPI.confirmHikeArrival(1)
        ).rejects.toThrow('Failed to fetch');
    });

    it('propagates invalid JSON errors on successful responses', async () => {
        fetchMock.mockResolvedValue(mockResponse({ invalidJson: true }));

        await expect(
            realAPI.confirmHikeArrival(1)
        ).rejects.toThrow(SyntaxError);
    });
});