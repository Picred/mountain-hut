import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// sqlite3 is installed in backend/node_modules: mock the module the DAO imports
vi.mock('../../../backend/node_modules/sqlite3/lib/sqlite3.js', () => ({
  default: {
    OPEN_READWRITE: 2,
    Database: vi.fn(function () {
      this.close = vi.fn(callback => callback(null));
    }),
  },
}));

vi.mock('../../../backend/db/db.js', () => ({ DB_PATH: 'test.sqlite', default: {} }));

vi.mock('../../../backend/utils/dbHelpers.js', () => ({
  dbAll: vi.fn(),
  dbGet: vi.fn(),
  dbRun: vi.fn(),
}));

// the route uses a mocked copyWeek, the DAO tests use the real one
vi.mock('../../../backend/models/dao/capacityDAO.js', async importOriginal => ({
  ...(await importOriginal()),
  copyWeek: vi.fn(),
}));

import sqlite from '../../../backend/node_modules/sqlite3/lib/sqlite3.js';
import { dbAll, dbGet, dbRun } from '../../../backend/utils/dbHelpers.js';
import { copyWeek as copyWeekMock } from '../../../backend/models/dao/capacityDAO.js';
import capacityRouter from '../../../backend/api/capacityRoutes.js';
import BadRequestError from '../../../backend/models/errors/BadRequestError.js';
import ConflictError from '../../../backend/models/errors/ConflictError.js';

const { copyWeek } = await vi.importActual('../../../backend/models/dao/capacityDAO.js');

const DAY_MS = 24 * 60 * 60 * 1000;

// source week: Monday 2027-01-04 to Sunday 2027-01-10, slots with different durations
const LUNCH = {
  slotId: 1,
  startAt: '2027-01-04T11:00:00.000Z',
  endAt: '2027-01-04T13:00:00.000Z',
  menu: '**Lunch menu**\n- Soup',
};
const DINNER = {
  slotId: 2,
  startAt: '2027-01-06T18:00:00.000Z',
  endAt: '2027-01-06T21:30:00.000Z',
  menu: '**Dinner menu**\n- Pasta',
};

/**
 * Fake database:
 * - the source week (and the target week) contain the given slots
 * - `reserved` are the target slots with active reservations
 * - timestamps are shifted by the requested number of days, unless `shift` is given
 * - inserted slots get the ids 100, 101, ...
 */
function mockDatabase({ source = [], target = [], reserved = [], shift } = {}) {
  const inserted = new Map();
  let nextId = 100;

  dbAll.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM reservations r')) return reserved;
    if (sql.includes('AS slotId')) return params[0] === '2027-01-04' ? source : target;
    // created slots, read after the commit
    return params.map(id => ({ slot_id: id, ...inserted.get(id), table_id: null }));
  });

  dbGet.mockImplementation(async (sql, [startAt, endAt, days]) => {
    if (shift) return shift(startAt, endAt);
    const move = value => new Date(Date.parse(value) + parseInt(days) * DAY_MS).toISOString();
    return { startAt: move(startAt), endAt: move(endAt) };
  });

  dbRun.mockImplementation(async (sql, params) => {
    if (sql.includes('INSERT INTO slots (')) {
      const slotId = nextId++;
      inserted.set(slotId, { start_at: params[0], end_at: params[1], menu: params[2] });
      return { lastID: slotId, changes: 1 };
    }
    return { changes: 1 };
  });
}

const ran = text => dbRun.mock.calls.filter(([sql]) => sql.includes(text));
const connection = () => sqlite.Database.mock.instances[0];

const expectRolledBack = () => {
  expect(ran('ROLLBACK')).toHaveLength(1);
  expect(ran('COMMIT')).toHaveLength(0);
  expect(connection().close).toHaveBeenCalledTimes(1);
};

beforeEach(() => {
  vi.clearAllMocks();
  // fixed "now", so the 2026/2027 dates stay in the future
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-01T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('copyWeek (DAO)', () => {
  it.each([
    ['an invalid source date', ['not-a-date', '2027-01-11']],
    ['an invalid target date', ['2027-01-04', '2027-13-01']],
    ['a non boolean copyTables', ['2027-01-04', '2027-01-11', { copyTables: 'yes' }]],
    ['a non boolean copyMenu', ['2027-01-04', '2027-01-11', { copyMenu: 1 }]],
  ])('rejects %s without opening a transaction', async (_, args) => {
    await expect(copyWeek(...args)).rejects.toMatchObject({
      constructor: BadRequestError,
      message: 'INVALID_INPUT',
    });
    expect(sqlite.Database).not.toHaveBeenCalled();
  });

  it('rejects copying a week onto itself, given any two of its days', async () => {
    await expect(copyWeek('2027-01-04', '2027-01-10')).rejects.toMatchObject({
      constructor: BadRequestError,
      message: 'SOURCE_WEEK_IN_TARGET_WEEKS',
    });
    expect(sqlite.Database).not.toHaveBeenCalled();
  });

  it('rejects an empty source week and rolls back', async () => {
    mockDatabase();

    await expect(copyWeek('2027-01-04', '2027-01-11')).rejects.toMatchObject({
      constructor: BadRequestError,
      message: 'NO_SLOTS_TO_COPY',
    });
    expectRolledBack();
  });

  it('changes nothing when a slot of the target week has active reservations', async () => {
    const reservedSlot = { slotId: 8, startAt: '2027-01-12T11:00:00.000Z', endAt: '2027-01-12T13:00:00.000Z' };
    mockDatabase({ source: [LUNCH], target: [{ slotId: 7 }, reservedSlot], reserved: [reservedSlot] });

    await expect(copyWeek('2027-01-04', '2027-01-11')).rejects.toMatchObject({
      constructor: ConflictError,
      message: expect.stringMatching(/^SLOT_HAS_RESERVATIONS: slotId: 8 /),
    });
    // cancelled reservations do not count
    const [reservationsSql, targetIds] = dbAll.mock.calls.find(([sql]) => sql.includes('FROM reservations r'));
    expect(reservationsSql).toContain("r.status <> 'cancelled'");
    expect(targetIds).toEqual([7, 8]);
    expect(ran('DELETE')).toHaveLength(0);
    expect(ran('INSERT')).toHaveLength(0);
    expectRolledBack();
  });

  it('replaces the whole target week with the copied slots, tables and menu', async () => {
    mockDatabase({ source: [LUNCH, DINNER], target: [{ slotId: 7 }, { slotId: 8 }] });

    // any day of the two weeks can be given
    const result = await copyWeek('2027-01-06', '2027-01-14');

    // weeks run from Monday to Sunday
    const weeks = dbAll.mock.calls
      .filter(([sql]) => sql.includes('AS slotId') && !sql.includes('FROM reservations r'))
      .map(([, params]) => params);
    expect(weeks).toEqual([['2027-01-04', '2027-01-10'], ['2027-01-11', '2027-01-17']]);

    // the target slots (and their cancelled reservations) are deleted before the copy
    expect(ran('DELETE FROM reservations')[0][1]).toEqual([7, 8]);
    expect(ran('DELETE FROM slots')[0][1]).toEqual([7, 8]);
    expect(dbGet.mock.calls.map(([, params]) => params[2])).toEqual(['+7 days', '+7 days']);
    expect(ran('INSERT INTO slots (').map(([, params]) => params)).toEqual([
      ['2027-01-11T11:00:00.000Z', '2027-01-11T13:00:00.000Z', LUNCH.menu],
      ['2027-01-13T18:00:00.000Z', '2027-01-13T21:30:00.000Z', DINNER.menu],
    ]);
    expect(ran('INSERT INTO slot_tables').map(([, params]) => params)).toEqual([[100, 1], [101, 2]]);

    // everything runs in one transaction on its own connection
    expect(ran('BEGIN IMMEDIATE')).toHaveLength(1);
    expect(ran('COMMIT')).toHaveLength(1);
    expect(ran('ROLLBACK')).toHaveLength(0);
    // only the created slots are read after the commit
    const inTransaction = [...dbAll.mock.calls.slice(0, -1), ...dbGet.mock.calls, ...dbRun.mock.calls];
    expect(inTransaction.every(([, , conn]) => conn === connection())).toBe(true);
    expect(connection().close).toHaveBeenCalledTimes(1);

    expect(result).toEqual({
      fromWeek: '2027-01-04',
      toWeek: '2027-01-11',
      copyTables: true,
      copyMenu: true,
      created: [
        { slotId: 100, startAt: '2027-01-11T11:00:00.000Z', endAt: '2027-01-11T13:00:00.000Z', menu: LUNCH.menu, hasTables: false, totalSeats: 0, tables: [] },
        { slotId: 101, startAt: '2027-01-13T18:00:00.000Z', endAt: '2027-01-13T21:30:00.000Z', menu: DINNER.menu, hasTables: false, totalSeats: 0, tables: [] },
      ],
      skipped: [],
    });
  });

  it('copies into an earlier empty week without deleting anything', async () => {
    mockDatabase({ source: [LUNCH] });

    const result = await copyWeek('2027-01-04', '2026-12-21');

    expect(dbGet.mock.calls[0][1][2]).toBe('-14 days');
    expect(ran('DELETE')).toHaveLength(0);
    expect(result.toWeek).toBe('2026-12-21');
    expect(result.created.map(slot => slot.startAt)).toEqual(['2026-12-21T11:00:00.000Z']);
  });

  it('copies only the slots when tables and menu are not requested', async () => {
    mockDatabase({ source: [LUNCH] });

    const result = await copyWeek('2027-01-04', '2027-01-11', { copyTables: false, copyMenu: false });

    expect(ran('INSERT INTO slots (')).toHaveLength(1);
    expect(ran('INSERT INTO slots (')[0][1][2]).toBeNull();
    expect(ran('INSERT INTO slot_tables')).toHaveLength(0);
    expect(result).toMatchObject({ copyTables: false, copyMenu: false });
  });

  it('skips the copies that would be in the past or have an invalid time range', async () => {
    const past = { startAt: '2020-01-06T11:00:00.000Z', endAt: '2020-01-06T13:00:00.000Z' };
    const invalid = { startAt: '2027-01-13T20:00:00.000Z', endAt: '2027-01-13T20:00:00.000Z' };
    mockDatabase({
      source: [LUNCH, DINNER],
      shift: startAt => (startAt === LUNCH.startAt ? past : invalid),
    });

    const result = await copyWeek('2027-01-04', '2027-01-11');

    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([
      { ...past, reason: 'SLOT_IN_THE_PAST' },
      { ...invalid, reason: 'INVALID_TIME_RANGE' },
    ]);
    expect(ran('INSERT')).toHaveLength(0);
    expect(ran('COMMIT')).toHaveLength(1);
  });

  it('rolls back when a copied date is out of range', async () => {
    mockDatabase({ source: [LUNCH], shift: () => ({ startAt: null, endAt: null }) });

    await expect(copyWeek('2027-01-04', '2027-01-11')).rejects.toMatchObject({
      constructor: BadRequestError,
      message: 'INVALID_INPUT',
    });
    expectRolledBack();
  });
});

describe('POST /api/slots/copy-week (route)', () => {
  const layer = capacityRouter.stack.find(l => l.route?.path === '/api/slots/copy-week' && l.route.methods.post);
  const postCopyWeek = layer.route.stack.at(-1).handle;

  function fakeRes() {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
  }

  it('is reserved to employees: the role check runs before the handler', () => {
    // ensureAuthenticated, role check, handler
    expect(layer.route.stack).toHaveLength(3);
  });

  it.each([
    ['a missing body', undefined],
    ['a missing fromDate', { toDate: '2027-01-11' }],
    ['a fromDate in the wrong format', { fromDate: '2027-1-4', toDate: '2027-01-11' }],
    ['a non-existent toDate', { fromDate: '2027-01-04', toDate: '2027-02-30' }],
    ['a non boolean copyTables', { fromDate: '2027-01-04', toDate: '2027-01-11', copyTables: 'true' }],
    ['a non boolean copyMenu', { fromDate: '2027-01-04', toDate: '2027-01-11', copyMenu: null }],
  ])('rejects %s', async (_, body) => {
    await expect(postCopyWeek({ body }, fakeRes())).rejects.toMatchObject({
      constructor: BadRequestError,
      message: 'INVALID_INPUT',
    });
    expect(copyWeekMock).not.toHaveBeenCalled();
  });

  it('copies tables and menu by default and responds 201 when slots are created', async () => {
    const result = { created: [{ slotId: 100 }], skipped: [] };
    copyWeekMock.mockResolvedValueOnce(result);
    const res = fakeRes();

    await postCopyWeek({ body: { fromDate: '2027-01-04', toDate: '2027-01-11' } }, res);

    expect(copyWeekMock).toHaveBeenCalledWith('2027-01-04', '2027-01-11', { copyTables: true, copyMenu: true });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(result);
  });

  it('passes the given options and responds 200 when every slot is skipped', async () => {
    const result = { created: [], skipped: [{ reason: 'SLOT_IN_THE_PAST' }] };
    copyWeekMock.mockResolvedValueOnce(result);
    const res = fakeRes();

    await postCopyWeek({ body: { fromDate: '2027-01-04', toDate: '2027-01-11', copyTables: false, copyMenu: false } }, res);

    expect(copyWeekMock).toHaveBeenCalledWith('2027-01-04', '2027-01-11', { copyTables: false, copyMenu: false });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(result);
  });
});
