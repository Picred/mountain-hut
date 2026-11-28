import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../backend/db/db.js', () => ({
    DB_PATH: ':memory:',
    default: {
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn(),
        close: vi.fn((cb) => cb?.(null)),
    },
}));
// Mock the sqlite driver: createHike opens its own connection, no real database access.
vi.mock('sqlite3', () => ({
    default: {
        OPEN_READWRITE: 2,
        Database: class {
            run() {}
            close(callback) { callback?.(null); }
        },
    },
}));

// Mock database helpers: no real database access.
vi.mock('../../../backend/utils/dbHelpers.js', () => ({
    dbAll: vi.fn(),
    dbGet: vi.fn(),
    dbRun: vi.fn(),
}));

// Mock DAO for Service, Route and Job tests.
vi.mock('../../../backend/models/dao/hikeDAO.js', () => ({
    createHike: vi.fn(),
    getActiveHikes: vi.fn(),
    getHikersHikes: vi.fn(),
    getMissingHikes: vi.fn(),
    confirmSafeArrival: vi.fn(),
    getOverdueScheduledHikes: vi.fn(),
    createHikeAlert: vi.fn(),
    getHikesWithEmailToSend: vi.fn(),
    getWardenEmails: vi.fn(),
    markAlertEmailSent: vi.fn(),
}));

import { dbAll, dbGet, dbRun } from '../../../backend/utils/dbHelpers.js';
import { createHike as createHikeMock } from '../../../backend/models/dao/hikeDAO.js';
import { isValidMember } from '../../../backend/services/hikeService.js';
import { registerHike } from '../../../backend/services/hikeService.js';
import { buildAlertEmail } from '../../../backend/services/missingHikeJob.js';
import BadRequestError from '../../../backend/models/errors/BadRequestError.js';
import router from '../../../backend/api/hikeRoutes.js';

// Load the real DAO implementation for isolated DAO tests.
const { createHike, getActiveHikes, getHikersHikes } = await vi.importActual(
    '../../../backend/models/dao/hikeDAO.js'
);

const NOW = '2027-07-15T12:00:00.000Z';

const makeHikeInput = (overrides = {}) => ({
    destination: 'Monte Viso',
    route: 'Trail from Pian del Re',
    scheduledDeparture: '2027-07-16T08:00:00.000Z',
    expectedArrival: '2027-07-16T15:00:00.000Z',
    partySize: 4,
    ...overrides,
});

const MARCO = { name: 'Marco Rossi', phone: '+393331111111' };
const GIULIA = { name: 'Giulia Bianchi', phone: null };
const LUCA = { name: 'Luca Verdi', phone: '+393332222222' };

const makeHikeRow = (overrides = {}) => ({
    hikeId: 1,
    destination: 'Monte Viso',
    route: 'Trail from Pian del Re',
    scheduledDeparture: '2027-07-15T08:00:00.000Z',
    expectedArrival: '2027-07-15T15:00:00.000Z',
    partySize: 4,
    status: 'scheduled',
    createdAt: '2027-07-14T10:00:00.000Z',
    userId: 10,
    hikerName: 'Mario Rossi',
    hikerEmail: 'mario@example.com',
    hikerPhone: '123456789',
    hikerNotes: null,
    hikerEmergencyContact: null,
    ...overrides,
});

// The DAO reads hikes, passages and members with separate queries: answers by table, not by call order.
const mockQueries = ({ hikes = [], passages = [], members = [] } = {}) => {
    dbAll.mockImplementation(async (query) => {
        if (/FROM\s+hike_members/i.test(query)) return members;
        if (/FROM\s+hike_passages/i.test(query)) return passages;
        return hikes;
    });
};

const memberInserts = () =>
    dbRun.mock.calls.filter(([query]) => /INSERT INTO\s+hike_members/i.test(query));

// Calls the promise and checks that it fails with a BadRequestError carrying the given code.
const expectBadRequest = async (promise, code) => {
    const error = await promise.then(() => null, (err) => err);

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.message).toBe(code);
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    createHikeMock.mockImplementation(async (userId, hike) => ({
        hikeId: 1,
        userId,
        ...hike,
        status: 'scheduled',
    }));
});

afterEach(() => {
    vi.useRealTimers();
});

// ============================================================
// SERVICE
// ============================================================

describe('isValidMember', () => {
    it.each([
        ['a name only', { name: 'Marco Rossi' }],
        ['a name and a phone', { name: 'Marco Rossi', phone: '+393331111111' }],
        ['a name and a null phone', { name: 'Marco Rossi', phone: null }],
    ])('accepts a member with %s', (_label, member) => {
        expect(isValidMember(member)).toBe(true);
    });

    it.each([
        ['no name', { phone: '+393331111111' }],
        ['an empty name', { name: '' }],
        ['a name of only spaces', { name: '   ' }],
        ['a name that is not a string', { name: 42 }],
        ['an empty phone', { name: 'Marco Rossi', phone: '' }],
        ['a phone of only spaces', { name: 'Marco Rossi', phone: '   ' }],
        ['a phone that is not a string', { name: 'Marco Rossi', phone: 333 }],
    ])('rejects a member with %s', (_label, member) => {
        expect(isValidMember(member)).toBe(false);
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['an array', [{ name: 'Marco Rossi' }]],
        ['a string', 'Marco Rossi'],
        ['a number', 7],
    ])('rejects %s instead of a member object', (_label, value) => {
        expect(isValidMember(value)).toBe(false);
    });
});

describe('registerHike: party members', () => {
    it('registers a hike without any member information', async () => {
        await registerHike(10, makeHikeInput());

        expect(createHikeMock).toHaveBeenCalledOnce();
        expect(createHikeMock).toHaveBeenCalledWith(10, expect.objectContaining({ members: [] }));
    });

    it('registers a hike with an empty list of members', async () => {
        await registerHike(10, makeHikeInput({ members: [] }));

        expect(createHikeMock).toHaveBeenCalledWith(10, expect.objectContaining({ members: [] }));
    });

    it('registers only some of the members of the party (partial details)', async () => {
        await registerHike(10, makeHikeInput({ partySize: 4, members: [MARCO] }));

        expect(createHikeMock).toHaveBeenCalledWith(10, expect.objectContaining({
            partySize: 4,
            members: [MARCO],
        }));
    });

    it('registers all the members of the party', async () => {
        // the hiker who registers the hike is not repeated among the members
        await registerHike(10, makeHikeInput({ partySize: 3, members: [MARCO, LUCA] }));

        expect(createHikeMock).toHaveBeenCalledWith(10, expect.objectContaining({
            partySize: 3,
            members: [MARCO, LUCA],
        }));
    });

    it('accepts a member whose phone is not known', async () => {
        await registerHike(10, makeHikeInput({
            members: [{ name: 'Giulia Bianchi' }, { name: 'Luca Verdi', phone: null }],
        }));

        expect(createHikeMock).toHaveBeenCalledWith(10, expect.objectContaining({
            members: [
                { name: 'Giulia Bianchi', phone: null },
                { name: 'Luca Verdi', phone: null },
            ],
        }));
    });

    it('removes the spaces around the name and the phone of a member', async () => {
        await registerHike(10, makeHikeInput({
            members: [{ name: '  Marco Rossi ', phone: ' +393331111111  ' }],
        }));

        expect(createHikeMock).toHaveBeenCalledWith(10, expect.objectContaining({
            members: [MARCO],
        }));
    });

    it('keeps the members in the order they were given', async () => {
        await registerHike(10, makeHikeInput({ members: [LUCA, MARCO, GIULIA] }));

        const { members } = createHikeMock.mock.calls[0][1];

        expect(members.map(member => member.name)).toEqual([
            'Luca Verdi',
            'Marco Rossi',
            'Giulia Bianchi',
        ]);
    });

    it('returns the registered hike with its members', async () => {
        const result = await registerHike(10, makeHikeInput({ members: [MARCO] }));

        expect(result.members).toEqual([MARCO]);
    });

    it.each([
        ['a string', 'Marco Rossi'],
        ['an object', { name: 'Marco Rossi' }],
        ['a number', 2],
    ])('rejects members given as %s instead of a list', async (_label, members) => {
        await expectBadRequest(registerHike(10, makeHikeInput({ members })), 'INVALID_INPUT');

        expect(createHikeMock).not.toHaveBeenCalled();
    });

    it('rejects the whole hike if one member is not valid', async () => {
        await expectBadRequest(
            registerHike(10, makeHikeInput({ members: [MARCO, { name: '   ' }, LUCA] })),
            'INVALID_INPUT'
        );

        expect(createHikeMock).not.toHaveBeenCalled();
    });

    it('rejects more members than the other people of the party', async () => {
        await expectBadRequest(
            registerHike(10, makeHikeInput({ partySize: 3, members: [MARCO, LUCA, GIULIA] })),
            'PARTY_SIZE_MISMATCH'
        );

        expect(createHikeMock).not.toHaveBeenCalled();
    });

    it('rejects members for a party of one person', async () => {
        await expectBadRequest(
            registerHike(10, makeHikeInput({ partySize: 1, members: [MARCO] })),
            'PARTY_SIZE_MISMATCH'
        );

        expect(createHikeMock).not.toHaveBeenCalled();
    });

    it.each([
        ['zero', 0],
        ['negative', -2],
        ['not an integer', 2.5],
        ['a string', '3'],
    ])('rejects a party size that is %s', async (_label, partySize) => {
        await expectBadRequest(registerHike(10, makeHikeInput({ partySize })), 'INVALID_INPUT');

        expect(createHikeMock).not.toHaveBeenCalled();
    });

    it('propagates errors thrown by the DAO', async () => {
        const error = new Error('Database error');
        createHikeMock.mockRejectedValue(error);

        await expect(registerHike(10, makeHikeInput({ members: [MARCO] }))).rejects.toBe(error);
    });
});

// ============================================================
// DAO
// ============================================================

describe('createHike DAO: party members', () => {
    beforeEach(() => {
        dbGet.mockResolvedValue(undefined);
        dbRun.mockImplementation(async (query) =>
            /INSERT INTO\s+hikes\s*\(/i.test(query) ? { lastID: 7, changes: 1 } : { changes: 1 });
    });

    const hike = (overrides = {}) => ({
        destination: 'Monte Viso',
        route: 'Trail from Pian del Re',
        scheduledDeparture: '2027-07-16T08:00:00.000Z',
        expectedArrival: '2027-07-16T15:00:00.000Z',
        partySize: 4,
        passages: ['Lago Fiorenza'],
        members: [],
        ...overrides,
    });

    it('saves each member linked to the new hike, in the given order', async () => {
        await createHike(10, hike({ members: [MARCO, GIULIA] }));

        const inserts = memberInserts();

        expect(inserts).toHaveLength(2);
        // hike_id, position, name, phone
        expect(inserts[0][1]).toEqual([7, 1, 'Marco Rossi', '+393331111111']);
        expect(inserts[1][1]).toEqual([7, 2, 'Giulia Bianchi', null]);
    });

    it('does not save any member when there are none', async () => {
        await createHike(10, hike({ members: [] }));

        expect(memberInserts()).toHaveLength(0);
    });

    it('commits once everything is saved', async () => {
        await createHike(10, hike({ members: [MARCO] }));

        const statements = dbRun.mock.calls.map(([query]) => query.trim());

        expect(statements).toContain('COMMIT');
        expect(statements).not.toContain('ROLLBACK');
    });

    it('returns the created hike with its members', async () => {
        const result = await createHike(10, hike({ members: [MARCO, GIULIA] }));

        expect(result).toMatchObject({
            hikeId: 7,
            userId: 10,
            status: 'scheduled',
            members: [MARCO, GIULIA],
        });
    });

    it('saves nothing if a member cannot be saved (rollback)', async () => {
        const error = new Error('Member insert failed');

        dbRun.mockImplementation(async (query, params) => {
            if (/INSERT INTO\s+hike_members/i.test(query) && params[1] === 2) throw error;
            return /INSERT INTO\s+hikes\s*\(/i.test(query) ? { lastID: 7, changes: 1 } : { changes: 1 };
        });

        await expect(createHike(10, hike({ members: [MARCO, GIULIA] }))).rejects.toBe(error);

        const statements = dbRun.mock.calls.map(([query]) => query.trim());

        expect(statements).toContain('ROLLBACK');
        expect(statements).not.toContain('COMMIT');
    });
});

describe.each([
    ['getActiveHikes', getActiveHikes],
    ['getHikersHikes', getHikersHikes],
])('%s DAO: party members', (_name, readHikes) => {
    it('returns the members of a hike in the order they were given', async () => {
        mockQueries({
            hikes: [makeHikeRow()],
            members: [
                { hikeId: 1, name: 'Marco Rossi', phone: '+393331111111' },
                { hikeId: 1, name: 'Giulia Bianchi', phone: null },
            ],
        });

        const [result] = await readHikes(10);

        expect(result.members).toEqual([MARCO, GIULIA]);
    });

    it('returns a missing phone as null', async () => {
        mockQueries({
            hikes: [makeHikeRow()],
            members: [{ hikeId: 1, name: 'Giulia Bianchi' }],
        });

        const [result] = await readHikes(10);

        expect(result.members).toEqual([{ name: 'Giulia Bianchi', phone: null }]);
    });

    it('returns an empty list when a hike has no members', async () => {
        mockQueries({ hikes: [makeHikeRow()], members: [] });

        const [result] = await readHikes(10);

        expect(result.members).toEqual([]);
    });

    it('associates the members with the correct hike', async () => {
        mockQueries({
            hikes: [makeHikeRow({ hikeId: 1 }), makeHikeRow({ hikeId: 2 }), makeHikeRow({ hikeId: 3 })],
            members: [
                { hikeId: 1, name: 'Marco Rossi', phone: '+393331111111' },
                { hikeId: 1, name: 'Giulia Bianchi', phone: null },
                { hikeId: 3, name: 'Luca Verdi', phone: '+393332222222' },
            ],
        });

        const result = await readHikes(10);

        expect(result.map(hike => hike.members)).toEqual([[MARCO, GIULIA], [], [LUCA]]);
    });

    it('reads the members of the selected hikes only, in the order of the party', async () => {
        mockQueries({ hikes: [makeHikeRow({ hikeId: 1 }), makeHikeRow({ hikeId: 2 })] });

        await readHikes(10);

        const [query, params] = dbAll.mock.calls.find(([sql]) => /FROM\s+hike_members/i.test(sql));

        expect(query).toMatch(/WHERE\s+hike_id\s+IN\s*\(\?,\s*\?\)/i);
        expect(query).toMatch(/ORDER BY\s+hike_id\s+ASC,\s*position\s+ASC/i);
        expect(params).toEqual([1, 2]);
    });

    it('propagates database errors from the members query', async () => {
        const error = new Error('Members query failed');

        dbAll.mockImplementation(async (query) => {
            if (/FROM\s+hike_members/i.test(query)) throw error;
            return /FROM\s+hike_passages/i.test(query) ? [] : [makeHikeRow()];
        });

        await expect(readHikes(10)).rejects.toBe(error);
    });
});

// ============================================================
// ROUTE
// ============================================================

describe('POST /api/hikes: party members', () => {
    const postHike = handler('post', '/');

    it('returns HTTP 201 with the registered hike and its members', async () => {
        const res = fakeRes();
        const req = {
            user: { user_id: 10 },
            body: makeHikeInput({ partySize: 3, members: [MARCO, GIULIA] }),
        };

        await postHike(req, res);

        expect(createHikeMock).toHaveBeenCalledWith(10, expect.objectContaining({
            members: [MARCO, GIULIA],
        }));
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            hikeId: 1,
            members: [MARCO, GIULIA],
        }));
    });

    it('returns HTTP 201 for a hike without members', async () => {
        const res = fakeRes();

        await postHike({ user: { user_id: 10 }, body: makeHikeInput() }, res);

        expect(res.status).toHaveBeenCalledWith(201);
    });

    it('propagates the error when there are more members than the party size allows', async () => {
        const req = {
            user: { user_id: 10 },
            body: makeHikeInput({ partySize: 2, members: [MARCO, LUCA] }),
        };

        await expectBadRequest(postHike(req, fakeRes()), 'PARTY_SIZE_MISMATCH');

        expect(createHikeMock).not.toHaveBeenCalled();
    });

    it('registers authorization middleware before the handler', () => {
        const layer = router.stack.find(
            item => item.route?.path === '/' && item.route.methods.post
        );

        expect(layer).toBeDefined();

        const handlers = layer.route.stack.map(item => item.handle);

        expect(handlers).toContain(postHike);
        expect(handlers.indexOf(postHike)).toBeGreaterThan(0);
    });
});

// ============================================================
// MISSING HIKER ALERT EMAIL
// ============================================================

describe('buildAlertEmail: party members', () => {
    const makeMissingHike = (overrides = {}) => ({
        hikeId: 1,
        destination: 'Monte Viso',
        route: 'Trail from Pian del Re',
        partySize: 3,
        expectedArrival: '2027-07-15T15:00:00.000Z',
        members: [MARCO, GIULIA],
        hiker: {
            name: 'Mario Rossi',
            email: 'mario@example.com',
            phone: '123456789',
            emergencyContact: 'Anna: 987654321',
        },
        ...overrides,
    });

    it('lists the members of the party, with the phone when it is known', () => {
        const { text } = buildAlertEmail(makeMissingHike(), 1);

        expect(text).toContain('Marco Rossi (+393331111111)');
        expect(text).toContain('Giulia Bianchi');
        expect(text).not.toContain('Giulia Bianchi (');
    });

    it('says that there are no members when none were given', () => {
        const { text } = buildAlertEmail(makeMissingHike({ members: [] }), 1);

        expect(text).toMatch(/Party members:\s*N\/A/);
    });

    it('still works for a hike that carries no members information', () => {
        const hike = makeMissingHike();
        delete hike.members;

        const { text } = buildAlertEmail(hike, 1);

        expect(text).toMatch(/Party members:\s*N\/A/);
    });
});
