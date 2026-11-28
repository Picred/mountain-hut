import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import hikeAPI from '../../../frontend/src/api/hike_api.js';

function mockResponse({ ok = true, status = 200, body = {} } = {}) {
    return {
        ok,
        status,
        json: vi.fn().mockResolvedValue(body),
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

describe('hikeAPI.registerHike: party members', () => {
    const hikePayload = {
        destination: 'Monte Viso',
        route: 'Pian del Re - Colle delle Traversette',
        scheduledDeparture: '2028-06-01T08:00:00.000Z',
        expectedArrival: '2028-06-01T17:00:00.000Z',
        partySize: 4,
        passages: [],
        members: [
            { name: 'Marco Rossi', phone: '+393331111111' },
            { name: 'Giulia Bianchi', phone: null },
        ],
    };

    it('sends the members in the body of the request', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ status: 201, body: { hikeId: 10, ...hikePayload } }));

        await hikeAPI.registerHike(hikePayload);

        const [, options] = fetchMock.mock.calls[0];

        expect(JSON.parse(options.body).members).toEqual(hikePayload.members);
    });

    it('returns the registered hike with its members', async () => {
        const created = { hikeId: 10, ...hikePayload, status: 'scheduled' };
        fetchMock.mockResolvedValueOnce(mockResponse({ status: 201, body: created }));

        const result = await hikeAPI.registerHike(hikePayload);

        expect(result.members).toEqual(hikePayload.members);
    });

    it('explains that there are too many members for the party size', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({
            ok: false,
            status: 400,
            body: { error: 'PARTY_SIZE_MISMATCH' },
        }));
        const mismatchError = await hikeAPI.registerHike(hikePayload).catch((error) => error);

        fetchMock.mockResolvedValueOnce(mockResponse({
            ok: false,
            status: 400,
            body: { error: 'UNKNOWN_ERROR_CODE' },
        }));
        const genericError = await hikeAPI.registerHike(hikePayload).catch((error) => error);

        expect(mismatchError).toBeInstanceOf(Error);
        // a specific message, not the generic one used for unknown errors
        expect(mismatchError.message).not.toBe(genericError.message);
        expect(mismatchError.message).toMatch(/member/i);
    });
});
