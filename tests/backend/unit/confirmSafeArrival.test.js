import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    confirmSafeArrival: vi.fn(),
    getHikersHikes: vi.fn(),
}));

import { dbAll, dbGet, dbRun } from '../../../backend/utils/dbHelpers.js';

import {
    confirmSafeArrival as confirmSafeArrivalMock,
    getHikersHikes as getHikersHikesMock,
} from '../../../backend/models/dao/hikeDAO.js';

import {
    confirmArrival,
    listHikersHikes,
} from '../../../backend/services/hikeService.js';

import router from '../../../backend/api/hikeRoutes.js';

import BadRequestError from '../../../backend/models/errors/BadRequestError.js';
import NotFoundError from '../../../backend/models/errors/NotFoundError.js';
import ConflictError from '../../../backend/models/errors/ConflictError.js';

// Load the real DAO implementation for isolated DAO tests.
const {
    confirmSafeArrival,
    getHikersHikes,
} = await vi.importActual(
    '../../../backend/models/dao/hikeDAO.js'
);

const makeHikeRow = (overrides = {}) => ({
    hikeId: 1,
    destination: 'Monte Viso',
    route: 'Trail from Pian del Re',
    scheduledDeparture: '2027-07-15T08:00:00.000Z',
    expectedArrival: '2027-07-15T15:00:00.000Z',
    partySize: 2,
    status: 'scheduled',
    createdAt: '2027-07-14T10:00:00.000Z',
    ...overrides,
});

const makeExpectedHike = (overrides = {}) => ({
    ...makeHikeRow(overrides),
    passages: [],
});

function handler(method, path) {
    const layer = router.stack.find(
        item => item.route?.path === path && item.route.methods[method]
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

// ============================================================
// SERVICE
// ============================================================

describe('confirmArrival', () => {
    it('confirms the safe arrival of a hike', async () => {
        const confirmed = {
            hikeId: 1,
            userId: 10,
            status: 'returned',
        };

        confirmSafeArrivalMock.mockResolvedValue(confirmed);

        const result = await confirmArrival(10, 1);

        expect(result).toEqual(confirmed);
        expect(confirmSafeArrivalMock).toHaveBeenCalledWith(10, 1);
        expect(confirmSafeArrivalMock).toHaveBeenCalledOnce();
    });

    it('converts string identifiers to numbers', async () => {
        confirmSafeArrivalMock.mockResolvedValue({
            hikeId: 1,
            userId: 10,
            status: 'returned',
        });

        await confirmArrival('10', '1');

        expect(confirmSafeArrivalMock).toHaveBeenCalledWith(10, 1);
    });

    it.each([
        ['zero user ID', 0, 1],
        ['negative user ID', -1, 1],
        ['decimal user ID', 1.5, 1],
        ['non-numeric user ID', 'abc', 1],
        ['missing user ID', undefined, 1],
        ['zero hike ID', 10, 0],
        ['negative hike ID', 10, -1],
        ['decimal hike ID', 10, 1.5],
        ['non-numeric hike ID', 10, 'abc'],
        ['missing hike ID', 10, undefined],
    ])('rejects a %s', async (_, userId, hikeId) => {
        await expect(
            confirmArrival(userId, hikeId)
        ).rejects.toThrow(BadRequestError);

        expect(confirmSafeArrivalMock).not.toHaveBeenCalled();
    });

    it('propagates a not found error from the DAO', async () => {
        const error = new NotFoundError('HIKE_NOT_FOUND');

        confirmSafeArrivalMock.mockRejectedValue(error);

        await expect(confirmArrival(10, 99)).rejects.toBe(error);
    });

    it('propagates a conflict error from the DAO', async () => {
        const error = new ConflictError('HIKE_ALREADY_CONFIRMED');

        confirmSafeArrivalMock.mockRejectedValue(error);

        await expect(confirmArrival(10, 1)).rejects.toBe(error);
    });

    it('propagates unexpected DAO errors', async () => {
        const error = new Error('Database unavailable');

        confirmSafeArrivalMock.mockRejectedValue(error);

        await expect(confirmArrival(10, 1)).rejects.toBe(error);
    });
});

describe('listHikersHikes', () => {
    it('returns the hikes belonging to the hiker', async () => {
        const hikes = [
            makeExpectedHike(),
            makeExpectedHike({ hikeId: 2, status: 'returned' }),
        ];

        getHikersHikesMock.mockResolvedValue(hikes);

        const result = await listHikersHikes(10);

        expect(result).toEqual(hikes);
        expect(getHikersHikesMock).toHaveBeenCalledWith(10);
        expect(getHikersHikesMock).toHaveBeenCalledOnce();
    });

    it('returns an empty array when the hiker has no hikes', async () => {
        getHikersHikesMock.mockResolvedValue([]);

        await expect(listHikersHikes(10)).resolves.toEqual([]);
    });

    it('converts a string user ID to a number', async () => {
        getHikersHikesMock.mockResolvedValue([]);

        await listHikersHikes('10');

        expect(getHikersHikesMock).toHaveBeenCalledWith(10);
    });

    it.each([
        ['zero', 0],
        ['negative number', -1],
        ['decimal number', 1.5],
        ['non-numeric string', 'abc'],
        ['undefined', undefined],
    ])('rejects an invalid user ID: %s', async (_, userId) => {
        await expect(
            listHikersHikes(userId)
        ).rejects.toThrow(BadRequestError);

        expect(getHikersHikesMock).not.toHaveBeenCalled();
    });

    it('propagates DAO errors', async () => {
        const error = new Error('Database query failed');

        getHikersHikesMock.mockRejectedValue(error);

        await expect(listHikersHikes(10)).rejects.toBe(error);
    });
});

// ============================================================
// DAO
// ============================================================

describe('confirmSafeArrival', () => {
    it('updates a scheduled hike to returned', async () => {
        dbGet.mockResolvedValue({ status: 'scheduled' });
        dbRun.mockResolvedValue({ changes: 1 });

        const result = await confirmSafeArrival(10, 1);

        expect(result).toEqual({
            hikeId: 1,
            userId: 10,
            status: 'returned',
        });

        expect(dbGet).toHaveBeenCalledWith(
            expect.stringMatching(/WHERE\s+hike_id\s*=\s*\?\s+AND\s+user_id\s*=\s*\?/i),
            [1, 10]
        );

        expect(dbRun).toHaveBeenCalledWith(
            expect.stringContaining("SET status = 'returned'"),
            [1, 10]
        );
    });

    it('updates only scheduled hikes belonging to the user', async () => {
        dbGet.mockResolvedValue({ status: 'scheduled' });
        dbRun.mockResolvedValue({ changes: 1 });

        await confirmSafeArrival(10, 1);

        const [query, params] = dbRun.mock.calls[0];

        expect(query).toMatch(/UPDATE\s+hikes/i);
        expect(query).toMatch(/WHERE\s+hike_id\s*=\s*\?/i);
        expect(query).toMatch(/AND\s+user_id\s*=\s*\?/i);
        expect(query).toMatch(/AND\s+status\s*=\s*'scheduled'/i);
        expect(params).toEqual([1, 10]);
    });

    it('throws NotFoundError when the hike does not exist', async () => {
        dbGet.mockResolvedValue(undefined);

        await expect(
            confirmSafeArrival(10, 99)
        ).rejects.toThrow(NotFoundError);

        expect(dbRun).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the hike belongs to another user', async () => {
        dbGet.mockResolvedValue(undefined);

        await expect(
            confirmSafeArrival(20, 1)
        ).rejects.toThrow('HIKE_NOT_FOUND');

        expect(dbGet).toHaveBeenCalledWith(
            expect.any(String),
            [1, 20]
        );

        expect(dbRun).not.toHaveBeenCalled();
    });

    it('throws ConflictError when the hike is already returned', async () => {
        dbGet.mockResolvedValue({ status: 'returned' });
        dbRun.mockResolvedValue({ changes: 0 });

        await expect(
            confirmSafeArrival(10, 1)
        ).rejects.toThrow(ConflictError);

        expect(dbRun).toHaveBeenCalledOnce();
    });

    it('throws ConflictError when the hike cannot be updated', async () => {
        dbGet.mockResolvedValue({ status: 'cancelled' });
        dbRun.mockResolvedValue({ changes: 0 });

        await expect(
            confirmSafeArrival(10, 1)
        ).rejects.toThrow('HIKE_ALREADY_CONFIRMED');
    });

    it('throws ConflictError when no rows are updated', async () => {
        dbGet.mockResolvedValue({ status: 'scheduled' });
        dbRun.mockResolvedValue({ changes: 0 });

        await expect(
            confirmSafeArrival(10, 1)
        ).rejects.toThrow(ConflictError);
    });

    it('does not perform an update if the initial query fails', async () => {
        const error = new Error('SELECT failed');

        dbGet.mockRejectedValue(error);

        await expect(
            confirmSafeArrival(10, 1)
        ).rejects.toBe(error);

        expect(dbRun).not.toHaveBeenCalled();
    });

    it('propagates errors from the update query', async () => {
        const error = new Error('UPDATE failed');

        dbGet.mockResolvedValue({ status: 'scheduled' });
        dbRun.mockRejectedValue(error);

        await expect(
            confirmSafeArrival(10, 1)
        ).rejects.toBe(error);
    });
});

describe('getHikersHikes', () => {
    it('returns all hikes belonging to the user', async () => {
        const rows = [
            makeHikeRow(),
            makeHikeRow({ hikeId: 2, status: 'returned' }),
        ];

        dbAll
            .mockResolvedValueOnce(rows)
            .mockResolvedValueOnce([]);

        const result = await getHikersHikes(10);

        expect(result).toEqual([
            makeExpectedHike(),
            makeExpectedHike({ hikeId: 2, status: 'returned' }),
        ]);

        expect(dbAll).toHaveBeenCalledTimes(2);
        expect(dbAll.mock.calls[0][1]).toEqual([10]);
    });

    it('returns an empty array when the user has no hikes', async () => {
        dbAll.mockResolvedValueOnce([]);

        const result = await getHikersHikes(10);

        expect(result).toEqual([]);
        expect(dbAll).toHaveBeenCalledOnce();
    });

    it('filters hikes by user ID', async () => {
        dbAll.mockResolvedValueOnce([]);

        await getHikersHikes(10);

        const [query, params] = dbAll.mock.calls[0];

        expect(query).toMatch(/FROM\s+hikes/i);
        expect(query).toMatch(/WHERE\s+user_id\s*=\s*\?/i);
        expect(params).toEqual([10]);
    });

    it('orders hikes by scheduled departure', async () => {
        dbAll.mockResolvedValueOnce([]);

        await getHikersHikes(10);

        const [query] = dbAll.mock.calls[0];

        expect(query).toMatch(
            /ORDER BY\s+scheduled_departure\s+ASC/i
        );
    });

    it('retrieves intermediate passage points', async () => {
        dbAll
            .mockResolvedValueOnce([makeHikeRow()])
            .mockResolvedValueOnce([
                { hikeId: 1, name: 'Pian del Re' },
                { hikeId: 1, name: 'Lago Fiorenza' },
            ]);

        const result = await getHikersHikes(10);

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
        dbAll
            .mockResolvedValueOnce([
                makeHikeRow({ hikeId: 1 }),
                makeHikeRow({ hikeId: 2 }),
            ])
            .mockResolvedValueOnce([
                { hikeId: 1, name: 'Passage A' },
                { hikeId: 2, name: 'Passage B' },
                { hikeId: 1, name: 'Passage C' },
            ]);

        const result = await getHikersHikes(10);

        expect(result[0].passages).toEqual([
            'Passage A',
            'Passage C',
        ]);

        expect(result[1].passages).toEqual([
            'Passage B',
        ]);

        expect(dbAll.mock.calls[1][1]).toEqual([1, 2]);
    });

    it('returns an empty passage list when a hike has no passages', async () => {
        dbAll
            .mockResolvedValueOnce([makeHikeRow()])
            .mockResolvedValueOnce([]);

        const result = await getHikersHikes(10);

        expect(result[0].passages).toEqual([]);
    });

    it('preserves the status of returned hikes', async () => {
        dbAll
            .mockResolvedValueOnce([
                makeHikeRow({ status: 'returned' }),
            ])
            .mockResolvedValueOnce([]);

        const result = await getHikersHikes(10);

        expect(result[0].status).toBe('returned');
    });

    it('preserves the order returned by the database', async () => {
        dbAll
            .mockResolvedValueOnce([
                makeHikeRow({ hikeId: 2 }),
                makeHikeRow({ hikeId: 1 }),
            ])
            .mockResolvedValueOnce([]);

        const result = await getHikersHikes(10);

        expect(result.map(hike => hike.hikeId)).toEqual([2, 1]);
    });

    it('propagates errors from the hike query', async () => {
        const error = new Error('Hike query failed');

        dbAll.mockRejectedValueOnce(error);

        await expect(getHikersHikes(10)).rejects.toBe(error);
        expect(dbAll).toHaveBeenCalledOnce();
    });

    it('propagates errors from the passage query', async () => {
        const error = new Error('Passage query failed');

        dbAll
            .mockResolvedValueOnce([makeHikeRow()])
            .mockRejectedValueOnce(error);

        await expect(getHikersHikes(10)).rejects.toBe(error);
        expect(dbAll).toHaveBeenCalledTimes(2);
    });
});

// ============================================================
// ROUTE
// ============================================================

describe('PUT /api/hikes/:hikeId/confirm-arrival', () => {
    const confirm = handler('put', '/:hikeId/confirm-arrival');

    it('returns HTTP 200 with the confirmed hike', async () => {
        const confirmed = {
            hikeId: 1,
            userId: 10,
            status: 'returned',
        };

        confirmSafeArrivalMock.mockResolvedValue(confirmed);

        const req = {
            user: { user_id: 10 },
            params: { hikeId: '1' },
        };

        const res = fakeRes();

        await confirm(req, res);

        expect(confirmSafeArrivalMock).toHaveBeenCalledWith(10, 1);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(confirmed);
    });

    it('uses the authenticated user ID', async () => {
        confirmSafeArrivalMock.mockResolvedValue({
            hikeId: 5,
            userId: 20,
            status: 'returned',
        });

        const req = {
            user: { user_id: 20 },
            params: { hikeId: '5' },
        };

        await confirm(req, fakeRes());

        expect(confirmSafeArrivalMock).toHaveBeenCalledWith(20, 5);
    });

    it('propagates invalid hike ID errors', async () => {
        const req = {
            user: { user_id: 10 },
            params: { hikeId: 'invalid' },
        };

        await expect(
            confirm(req, fakeRes())
        ).rejects.toThrow(BadRequestError);

        expect(confirmSafeArrivalMock).not.toHaveBeenCalled();
    });

    it('propagates not found errors', async () => {
        const error = new NotFoundError('HIKE_NOT_FOUND');

        confirmSafeArrivalMock.mockRejectedValue(error);

        const req = {
            user: { user_id: 10 },
            params: { hikeId: '99' },
        };

        await expect(
            confirm(req, fakeRes())
        ).rejects.toBe(error);
    });

    it('propagates conflict errors', async () => {
        const error = new ConflictError('HIKE_ALREADY_CONFIRMED');

        confirmSafeArrivalMock.mockRejectedValue(error);

        const req = {
            user: { user_id: 10 },
            params: { hikeId: '1' },
        };

        await expect(
            confirm(req, fakeRes())
        ).rejects.toBe(error);
    });

    it('registers authorization middleware before the handler', () => {
        const layer = router.stack.find(
            item =>
                item.route?.path === '/:hikeId/confirm-arrival' &&
                item.route.methods.put
        );

        expect(layer).toBeDefined();

        const handlers = layer.route.stack.map(item => item.handle);

        expect(handlers).toContain(confirm);
        expect(handlers.indexOf(confirm)).toBeGreaterThan(0);

        const middlewareBeforeHandler = handlers.slice(
            0,
            handlers.indexOf(confirm)
        );

        expect(middlewareBeforeHandler.length).toBeGreaterThan(0);
        expect(
            middlewareBeforeHandler.every(fn => typeof fn === 'function')
        ).toBe(true);
    });
});

describe('GET /api/hikes', () => {
    const listHikes = handler('get', '/');

    it('returns HTTP 200 with the hiker hikes', async () => {
        const hikes = [
            makeExpectedHike(),
            makeExpectedHike({ hikeId: 2, status: 'returned' }),
        ];

        getHikersHikesMock.mockResolvedValue(hikes);

        const req = {
            user: { user_id: 10 },
        };

        const res = fakeRes();

        await listHikes(req, res);

        expect(getHikersHikesMock).toHaveBeenCalledWith(10);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(hikes);
    });

    it('returns HTTP 200 with an empty array', async () => {
        getHikersHikesMock.mockResolvedValue([]);

        const req = {
            user: { user_id: 10 },
        };

        const res = fakeRes();

        await listHikes(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith([]);
    });

    it('propagates errors from the service', async () => {
        const error = new Error('Service unavailable');

        getHikersHikesMock.mockRejectedValue(error);

        const req = {
            user: { user_id: 10 },
        };

        await expect(
            listHikes(req, fakeRes())
        ).rejects.toBe(error);
    });

    it('registers authorization middleware before the handler', () => {
        const layer = router.stack.find(
            item => item.route?.path === '/' && item.route.methods.get
        );

        expect(layer).toBeDefined();

        const handlers = layer.route.stack.map(item => item.handle);

        expect(handlers).toContain(listHikes);
        expect(handlers.indexOf(listHikes)).toBeGreaterThan(0);
    });
});
