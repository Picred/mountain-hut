import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock database helpers: no real database access.
vi.mock('../../../backend/utils/dbHelpers.js', () => ({
    dbAll: vi.fn(),
    dbGet: vi.fn(),
    dbRun: vi.fn(),
}));

// Mock DAO for Service and Route tests.
vi.mock('../../../backend/models/dao/hikeDAO.js', () => ({
    createHike: vi.fn(),
    getActiveHikes: vi.fn(),
}));

import { dbAll } from '../../../backend/utils/dbHelpers.js';
import { getActiveHikes as getActiveHikesMock } from '../../../backend/models/dao/hikeDAO.js';
import { listActiveHikes } from '../../../backend/services/hikeService.js';
import router from '../../../backend/api/hikeRoutes.js';

// Load the real DAO implementation for isolated DAO tests.
const { getActiveHikes } = await vi.importActual(
    '../../../backend/models/dao/hikeDAO.js'
);

const NOW = '2027-07-15T12:00:00.000Z';

const makeHikeRow = (overrides = {}) => ({
    hikeId: 1,
    destination: 'Monte Viso',
    route: 'Trail from Pian del Re',
    scheduledDeparture: '2027-07-15T08:00:00.000Z',
    expectedArrival: '2027-07-15T15:00:00.000Z',
    partySize: 2,
    status: 'scheduled',
    createdAt: '2027-07-14T10:00:00.000Z',
    userId: 10,
    hikerName: 'Mario Rossi',
    hikerEmail: 'mario@example.com',
    hikerPhone: '123456789',
    hikerNotes: 'Experienced hiker',
    hikerEmergencyContact: 'Anna: 987654321',
    ...overrides,
});

const makeExpectedHike = (overrides = {}) => {
    const row = makeHikeRow(overrides);

    return {
        hikeId: row.hikeId,
        destination: row.destination,
        route: row.route,
        passages: [],
        scheduledDeparture: row.scheduledDeparture,
        expectedArrival: row.expectedArrival,
        partySize: row.partySize,
        status: row.status,
        createdAt: row.createdAt,
        isOverdue: Date.parse(row.expectedArrival) < Date.parse(NOW),
        hiker: {
            userId: row.userId,
            name: row.hikerName,
            email: row.hikerEmail,
            phone: row.hikerPhone,
            notes: row.hikerNotes ?? null,
            emergencyContact: row.hikerEmergencyContact ?? null,
        },
    };
};

function handler(method, path) {
    const layer = router.stack.find(
        (item) => item.route?.path === path && item.route.methods[method]
    );

    if (!layer) {
        throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
    }

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

afterEach(() => {
    vi.useRealTimers();
});

// ============================================================
// SERVICE
// ============================================================

describe('listActiveHikes', () => {
    it('returns the active hikes retrieved from the DAO', async () => {
        const hikes = [
            makeExpectedHike(),
            makeExpectedHike({
                hikeId: 2,
                expectedArrival: '2027-07-15T11:00:00.000Z',
            }),
        ];

        getActiveHikesMock.mockResolvedValue(hikes);

        const result = await listActiveHikes();

        expect(getActiveHikesMock).toHaveBeenCalledOnce();
        expect(getActiveHikesMock).toHaveBeenCalledWith();
        expect(result).toEqual(hikes);
    });

    it('returns an empty array when there are no active hikes', async () => {
        getActiveHikesMock.mockResolvedValue([]);

        const result = await listActiveHikes();

        expect(getActiveHikesMock).toHaveBeenCalledOnce();
        expect(result).toEqual([]);
    });

    it('propagates errors thrown by the DAO', async () => {
        const error = new Error('Database error');
        getActiveHikesMock.mockRejectedValue(error);

        await expect(listActiveHikes()).rejects.toBe(error);

        expect(getActiveHikesMock).toHaveBeenCalledOnce();
    });
});

// ============================================================
// DAO
// ============================================================

describe('getActiveHikes DAO', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(NOW));
    });

    it('returns an empty array when no active hikes exist', async () => {
        dbAll.mockResolvedValueOnce([]);

        const result = await getActiveHikes();

        expect(result).toEqual([]);
        expect(dbAll).toHaveBeenCalledOnce();
    });

    it('selects only scheduled hikes that have already started', async () => {
        dbAll.mockResolvedValueOnce([]);

        await getActiveHikes();

        const [query, params] = dbAll.mock.calls[0];

        expect(query).toMatch(/h\.status\s*=\s*'scheduled'/);
        expect(query).toMatch(/h\.scheduled_departure\s*<=\s*\?/);
        expect(params).toEqual([NOW]);
    });

    it('orders hikes by expected return time ascending', async () => {
        dbAll.mockResolvedValueOnce([]);

        await getActiveHikes();

        const [query] = dbAll.mock.calls[0];

        expect(query).toMatch(
            /ORDER BY\s+h\.expected_arrival\s+ASC/i
        );
    });

    it('joins hikes with their registered hikers', async () => {
        dbAll.mockResolvedValueOnce([]);

        await getActiveHikes();

        const [query] = dbAll.mock.calls[0];

        expect(query).toMatch(
            /JOIN\s+users\s+u\s+ON\s+u\.user_id\s*=\s*h\.user_id/i
        );
    });

    it('returns the complete hike and hiker information', async () => {
        const row = makeHikeRow();

        dbAll
            .mockResolvedValueOnce([row])
            .mockResolvedValueOnce([]);

        const result = await getActiveHikes();

        expect(result).toEqual([makeExpectedHike()]);
        expect(dbAll).toHaveBeenCalledTimes(2);
    });

    it('marks overdue hikes correctly', async () => {
        const overdue = makeHikeRow({
            hikeId: 1,
            expectedArrival: '2027-07-15T11:00:00.000Z',
        });

        const onTime = makeHikeRow({
            hikeId: 2,
            expectedArrival: '2027-07-15T15:00:00.000Z',
        });

        dbAll
            .mockResolvedValueOnce([overdue, onTime])
            .mockResolvedValueOnce([]);

        const result = await getActiveHikes();

        expect(result[0].isOverdue).toBe(true);
        expect(result[1].isOverdue).toBe(false);
    });

    it('does not mark a hike overdue at its exact expected arrival time', async () => {
        const row = makeHikeRow({
            expectedArrival: NOW,
        });

        dbAll
            .mockResolvedValueOnce([row])
            .mockResolvedValueOnce([]);

        const result = await getActiveHikes();

        expect(result[0].isOverdue).toBe(false);
    });

    it('keeps overdue hikes in the returned list', async () => {
        const row = makeHikeRow({
            expectedArrival: '2027-07-15T10:00:00.000Z',
        });

        dbAll
            .mockResolvedValueOnce([row])
            .mockResolvedValueOnce([]);

        const result = await getActiveHikes();

        expect(result).toHaveLength(1);
        expect(result[0].hikeId).toBe(1);
        expect(result[0].isOverdue).toBe(true);
    });

    it('retrieves intermediate passage points for the selected hikes', async () => {
        const row = makeHikeRow();

        dbAll
            .mockResolvedValueOnce([row])
            .mockResolvedValueOnce([
                { hikeId: 1, name: 'Pian del Re' },
                { hikeId: 1, name: 'Lago Fiorenza' },
            ]);

        const result = await getActiveHikes();

        expect(result[0].passages).toEqual([
            'Pian del Re',
            'Lago Fiorenza',
        ]);

        const [query, params] = dbAll.mock.calls[1];

        expect(query).toMatch(/FROM\s+hike_passages/i);
        expect(query).toMatch(/WHERE\s+hike_id\s+IN\s*\(\?\)/i);
        expect(query).toMatch(
            /ORDER BY\s+hike_id\s+ASC,\s*position\s+ASC/i
        );
        expect(params).toEqual([1]);
    });

    it('associates passage points with the correct hike', async () => {
        const rows = [
            makeHikeRow({ hikeId: 1 }),
            makeHikeRow({ hikeId: 2 }),
        ];

        dbAll
            .mockResolvedValueOnce(rows)
            .mockResolvedValueOnce([
                { hikeId: 1, name: 'Passage A' },
                { hikeId: 1, name: 'Passage B' },
                { hikeId: 2, name: 'Passage C' },
            ]);

        const result = await getActiveHikes();

        expect(result[0].passages).toEqual([
            'Passage A',
            'Passage B',
        ]);

        expect(result[1].passages).toEqual([
            'Passage C',
        ]);

        const [, params] = dbAll.mock.calls[1];

        expect(params).toEqual([1, 2]);
    });

    it('returns an empty passage list when a hike has no passage points', async () => {
        dbAll
            .mockResolvedValueOnce([makeHikeRow()])
            .mockResolvedValueOnce([]);

        const result = await getActiveHikes();

        expect(result[0].passages).toEqual([]);
    });

    it('converts missing optional hiker information to null', async () => {
        const row = makeHikeRow({
            hikerNotes: null,
            hikerEmergencyContact: undefined,
        });

        dbAll
            .mockResolvedValueOnce([row])
            .mockResolvedValueOnce([]);

        const result = await getActiveHikes();

        expect(result[0].hiker.notes).toBeNull();
        expect(result[0].hiker.emergencyContact).toBeNull();
    });

    it('preserves the order of hikes returned by the database', async () => {
        const rows = [
            makeHikeRow({
                hikeId: 2,
                expectedArrival: '2027-07-15T11:00:00.000Z',
            }),
            makeHikeRow({
                hikeId: 1,
                expectedArrival: '2027-07-15T15:00:00.000Z',
            }),
        ];

        dbAll
            .mockResolvedValueOnce(rows)
            .mockResolvedValueOnce([]);

        const result = await getActiveHikes();

        expect(result.map(hike => hike.hikeId)).toEqual([2, 1]);
    });

    it('propagates database errors from the hike query', async () => {
        const error = new Error('Database query failed');

        dbAll.mockRejectedValueOnce(error);

        await expect(getActiveHikes()).rejects.toBe(error);
        expect(dbAll).toHaveBeenCalledOnce();
    });

    it('propagates database errors from the passage query', async () => {
        const error = new Error('Passage query failed');

        dbAll
            .mockResolvedValueOnce([makeHikeRow()])
            .mockRejectedValueOnce(error);

        await expect(getActiveHikes()).rejects.toBe(error);
        expect(dbAll).toHaveBeenCalledTimes(2);
    });
});

// ============================================================
// ROUTE
// ============================================================

describe('GET /api/hikes/active', () => {
    const getActive = handler('get', '/active');

    it('returns HTTP 200 with the active hikes', async () => {
        const hikes = [
            makeExpectedHike(),
            makeExpectedHike({
                hikeId: 2,
                expectedArrival: '2027-07-15T11:00:00.000Z',
            }),
        ];

        getActiveHikesMock.mockResolvedValue(hikes);

        const res = fakeRes();

        await getActive({}, res);

        expect(getActiveHikesMock).toHaveBeenCalledOnce();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(hikes);
    });

    it('returns HTTP 200 with an empty array when no hikes exist', async () => {
        getActiveHikesMock.mockResolvedValue([]);

        const res = fakeRes();

        await getActive({}, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith([]);
    });

    it('propagates errors from the service', async () => {
        const error = new Error('Service unavailable');

        getActiveHikesMock.mockRejectedValue(error);

        await expect(
            getActive({}, fakeRes())
        ).rejects.toBe(error);
    });


    it('registers authorization middleware before the handler', () => {
        const layer = router.stack.find(
            item => item.route?.path === '/active' && item.route.methods.get
        );

        expect(layer).toBeDefined();

        const handlers = layer.route.stack.map(item => item.handle);

        expect(handlers).toContain(getActive);
        expect(handlers.indexOf(getActive)).toBeGreaterThan(0);

        const middlewareBeforeHandler = handlers.slice(
            0,
            handlers.indexOf(getActive)
        );

        expect(middlewareBeforeHandler.length).toBeGreaterThan(0);
        expect(
            middlewareBeforeHandler.every(fn => typeof fn === 'function')
        ).toBe(true);
    });

});
