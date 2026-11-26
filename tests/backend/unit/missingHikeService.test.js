import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../backend/models/dao/hikeDAO.js', () => ({
    createHike: vi.fn(),
    getActiveHikes: vi.fn(),
    getMissingHikes: vi.fn(),
    confirmSafeArrival: vi.fn(),
    getHikersHikes: vi.fn(),
}));

import { getMissingHikes } from '../../../backend/models/dao/hikeDAO.js';
import { listMissingHikes } from '../../../backend/services/hikeService.js';
import { MAX_ALERTS } from '../../../backend/utils/missingHikeRules.js';
import hikeRouter from '../../../backend/api/hikeRoutes.js';
import ForbiddenError from '../../../backend/models/errors/ForbiddenError.js';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('listMissingHikes', () => {

    it('returns all missing hikes with the total number of alerts', async () => {
        const hikes = [
            {
                hikeId: 1,
                hiker: {
                    name: 'Mario Rossi',
                    email: 'mario@example.com',
                },
                destination: 'Monte Viso',
                alertNumber: 1,
            },
            {
                hikeId: 2,
                hiker: {
                    name: 'Anna Bianchi',
                    email: 'anna@example.com',
                },
                destination: 'Monte Rosa',
                alertNumber: 3,
            },
        ];

        getMissingHikes.mockResolvedValue(hikes);

        const result = await listMissingHikes();

        expect(result).toHaveLength(2);

        expect(result).toEqual([
            {
                ...hikes[0],
                totalAlerts: MAX_ALERTS,
            },
            {
                ...hikes[1],
                totalAlerts: MAX_ALERTS,
            },
        ]);

        expect(getMissingHikes).toHaveBeenCalledTimes(1);
    });

    it('preserves all original hike and hiker information', async () => {
        const hike = {
            hikeId: 10,
            hiker: {
                name: 'Mario Rossi',
                email: 'mario@example.com',
                phone: '3331234567',
                emergencyContact: '3339876543',
            },
            destination: 'Monte Viso',
            route: 'Pian del Re - Summit',
            partySize: 3,
            expectedArrival: '2028-06-10T09:00:00.000Z',
            alertNumber: 2,
            lastAlertAt: '2028-06-10T12:00:00.000Z',
        };

        getMissingHikes.mockResolvedValue([hike]);

        const result = await listMissingHikes();

        expect(result[0]).toMatchObject({
            hikeId: 10,
            hiker: hike.hiker,
            destination: hike.destination,
            route: hike.route,
            partySize: hike.partySize,
            expectedArrival: hike.expectedArrival,
            alertNumber: 2,
            lastAlertAt: hike.lastAlertAt,
            totalAlerts: MAX_ALERTS,
        });
    });

    it('returns an empty array when there are no missing hikers', async () => {
        getMissingHikes.mockResolvedValue([]);

        await expect(listMissingHikes()).resolves.toEqual([]);

        expect(getMissingHikes).toHaveBeenCalledTimes(1);
    });

    it('does not modify the original hike objects', async () => {
        const hike = {
            hikeId: 1,
            alertNumber: 1,
            destination: 'Monte Viso',
        };

        getMissingHikes.mockResolvedValue([hike]);

        const result = await listMissingHikes();

        expect(result[0]).not.toBe(hike);
        expect(hike).not.toHaveProperty('totalAlerts');
        expect(result[0].totalAlerts).toBe(MAX_ALERTS);
    });

    it('propagates DAO errors', async () => {
        getMissingHikes.mockRejectedValue(
            new Error('Database connection lost')
        );

        await expect(listMissingHikes()).rejects.toThrow(
            'Database connection lost'
        );

        expect(getMissingHikes).toHaveBeenCalledTimes(1);
    });
});

describe('GET /api/hikes/missing route', () => {

    const routeLayer = hikeRouter.stack.find(
        layer => layer.route?.path === '/missing' &&
            layer.route.methods.get
    );

    const routeStack = routeLayer.route.stack;
    const getMissingHikesHandler = routeStack.at(-1).handle;
    const checkEmployeeRole = routeStack[1].handle;

    function fakeRes() {
        const res = {};
        res.status = vi.fn(() => res);
        res.json = vi.fn(() => res);
        return res;
    }

    it('protects the route with authentication and employee role middleware', () => {
        // Authentication middleware, role middleware, route handler
        expect(routeStack).toHaveLength(3);
    });

    it('returns 200 with the missing hikers for an authorized employee', async () => {
        const hikes = [
            {
                hikeId: 1,
                hiker: { name: 'Mario Rossi' },
                alertNumber: 1,
                totalAlerts: MAX_ALERTS,
            },
        ];

        getMissingHikes.mockResolvedValue(hikes);

        const res = fakeRes();

        await getMissingHikesHandler({ user: { role: 'employee' } }, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(hikes);
        expect(getMissingHikes).toHaveBeenCalledTimes(1);
    });

    it('returns 200 with an empty array when there are no missing hikers', async () => {
        getMissingHikes.mockResolvedValue([]);

        const res = fakeRes();

        await getMissingHikesHandler({ user: { role: 'employee' } }, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith([]);
    });

    it('allows wardens to access the missing hikers route', () => {
        const next = vi.fn();

        checkEmployeeRole(
            { user: { role: 'warden' } },
            {},
            next
        );

        expect(next).toHaveBeenCalledWith();
    });

    it('rejects hikers with a ForbiddenError', () => {
        const next = vi.fn();

        checkEmployeeRole(
            { user: { role: 'hiker' } },
            {},
            next
        );

        expect(next).toHaveBeenCalledWith(
            expect.any(ForbiddenError)
        );
    });

});

