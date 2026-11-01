import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../backend/utils/dbHelpers.js', () => ({
  dbAll: vi.fn(),
  dbGet: vi.fn(),
  dbRun: vi.fn(),
}));

import { dbAll, dbGet, dbRun } from '../../../backend/utils/dbHelpers.js';
import BadRequestError from '../../../backend/models/errors/BadRequestError.js';
import ConflictError from '../../../backend/models/errors/ConflictError.js';
import NotFoundError from '../../../backend/models/errors/NotFoundError.js';

const { listTables, createTable } = await vi.importActual(
  '../../../backend/models/dao/tableDAO.js'
);
const {
  listSlots,
  getSlot,
  createSlot,
  addTablesToSlot,
  copyTablesToSlot,
} = await vi.importActual('../../../backend/models/dao/capacityDAO.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tableDAO', () => {
  it('returns tables in the expected shape', async () => {
    dbAll.mockResolvedValue([
      { table_id: 1, table_code: 'A', seats: 4 },
      { table_id: 2, table_code: 'B', seats: 6 },
    ]);

    await expect(listTables()).resolves.toEqual([
      { tableId: 1, code: 'A', seats: 4 },
      { tableId: 2, code: 'B', seats: 6 },
    ]);
  });

  it('creates a table type', async () => {
    dbRun.mockResolvedValue({ lastID: 3 });

    await expect(createTable('C', 4)).resolves.toEqual({
      tableId: 3,
      code: 'C',
      seats: 4,
    });
    expect(dbRun).toHaveBeenCalledWith(
      'INSERT INTO tables (table_code, seats) VALUES (?, ?)',
      ['C', 4]
    );
  });

  it('returns a conflict when the table type already exists', async () => {
    dbRun.mockRejectedValue(new Error('UNIQUE constraint failed: tables.table_code, tables.seats'));

    await expect(createTable('A', 4)).rejects.toMatchObject({
      constructor: ConflictError,
      message: 'TABLE_ALREADY_EXISTS',
      status: 409,
    });
  });

  it('passes other database errors through', async () => {
    dbRun.mockRejectedValue(new Error('database is locked'));

    await expect(createTable('A', 4)).rejects.toThrow('database is locked');
  });
});

describe('capacityDAO', () => {
  describe('listSlots', () => {
    it('filters slots by dates and groups tables into each slot', async () => {
      dbAll.mockResolvedValue([
        {
          slot_id: 1,
          start_at: '2027-01-10T10:00:00.000Z',
          end_at: '2027-01-10T11:00:00.000Z',
          table_id: 2,
          table_code: 'B',
          seats: 4,
        },
        {
          slot_id: 1,
          start_at: '2027-01-10T10:00:00.000Z',
          end_at: '2027-01-10T11:00:00.000Z',
          table_id: 3,
          table_code: 'C',
          seats: 6,
        },
        {
          slot_id: 2,
          start_at: '2027-01-11T10:00:00.000Z',
          end_at: '2027-01-11T11:00:00.000Z',
          table_id: null,
          table_code: null,
          seats: null,
        },
      ]);

      await expect(listSlots({ from: '2027-01-10', to: '2027-01-11' })).resolves.toEqual([
        {
          slotId: 1,
          startAt: '2027-01-10T10:00:00.000Z',
          endAt: '2027-01-10T11:00:00.000Z',
          hasTables: true,
          totalSeats: 10,
          tables: [
            { tableId: 2, code: 'B', seats: 4 },
            { tableId: 3, code: 'C', seats: 6 },
          ],
        },
        {
          slotId: 2,
          startAt: '2027-01-11T10:00:00.000Z',
          endAt: '2027-01-11T11:00:00.000Z',
          hasTables: false,
          totalSeats: 0,
          tables: [],
        },
      ]);

      expect(dbAll.mock.calls[0][0]).toContain("DATE(s.start_at, 'localtime') >= ?");
      expect(dbAll.mock.calls[0][0]).toContain("DATE(s.start_at, 'localtime') <= ?");
      expect(dbAll.mock.calls[0][1]).toEqual(['2027-01-10', '2027-01-11']);
    });

    it('lists slots without date filters', async () => {
      dbAll.mockResolvedValue([]);

      await expect(listSlots()).resolves.toEqual([]);

      expect(dbAll.mock.calls[0][0]).not.toContain('WHERE');
      expect(dbAll.mock.calls[0][1]).toEqual([]);
    });
  });

  describe('getSlot', () => {
    it('returns one slot with its tables', async () => {
      dbAll.mockResolvedValue([
        {
          slot_id: 4,
          start_at: '2027-01-10T10:00:00.000Z',
          end_at: '2027-01-10T11:00:00.000Z',
          table_id: 7,
          table_code: 'A',
          seats: 4,
        },
      ]);

      await expect(getSlot(4)).resolves.toMatchObject({
        slotId: 4,
        hasTables: true,
        totalSeats: 4,
        tables: [{ tableId: 7, code: 'A', seats: 4 }],
      });
      expect(dbAll.mock.calls[0][1]).toEqual([4]);
    });

    it('returns undefined when the slot does not exist', async () => {
      dbAll.mockResolvedValue([]);

      await expect(getSlot(99)).resolves.toBeUndefined();
    });
  });

  describe('createSlot', () => {
    it('rejects when the end time is not after the start time', async () => {
      const start = new Date(Date.now() + 60_000);

      await expect(createSlot(start, start)).rejects.toBeInstanceOf(BadRequestError);
      expect(dbRun).not.toHaveBeenCalled();
    });

    it('rejects a slot in the past', async () => {
      const start = new Date(Date.now() - 60_000);
      const end = new Date(Date.now() + 60_000);

      await expect(createSlot(start, end)).rejects.toMatchObject({
        message: 'SLOT_IN_THE_PAST',
        status: 400,
      });
      expect(dbRun).not.toHaveBeenCalled();
    });

    it('returns a conflict when the new slot overlaps an existing one', async () => {
      const start = new Date(Date.now() + 60 * 60_000);
      const end = new Date(start.getTime() + 60 * 60_000);
      dbRun.mockResolvedValue({ changes: 0 });

      await expect(createSlot(start, end)).rejects.toMatchObject({
        message: 'SLOT_OVERLAP',
        status: 409,
      });
    });

    it('creates a future slot and returns it', async () => {
      const start = new Date(Date.now() + 60 * 60_000);
      const end = new Date(start.getTime() + 60 * 60_000);
      dbRun.mockResolvedValue({ changes: 1, lastID: 8 });
      dbAll.mockResolvedValue([
        {
          slot_id: 8,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          table_id: null,
          table_code: null,
          seats: null,
        },
      ]);

      await expect(createSlot(start, end)).resolves.toMatchObject({
        slotId: 8,
        hasTables: false,
        totalSeats: 0,
      });
      expect(dbRun.mock.calls[0][1]).toEqual([
        start.toISOString(),
        end.toISOString(),
        end.toISOString(),
        start.toISOString(),
      ]);
    });
  });

  describe('addTablesToSlot', () => {
    it('rejects an empty table list', async () => {
      await expect(addTablesToSlot(1, [])).rejects.toMatchObject({
        message: 'INVALID_INPUT',
        status: 400,
      });
      expect(dbGet).not.toHaveBeenCalled();
    });

    it('returns not found when the slot does not exist', async () => {
      dbGet.mockResolvedValue(undefined);

      await expect(addTablesToSlot(1, [2])).rejects.toMatchObject({
        message: 'SLOT_NOT_FOUND',
        status: 404,
      });
    });

    it('returns not found when a table does not exist', async () => {
      dbGet.mockResolvedValue({ slot_id: 1 });
      dbAll.mockResolvedValue([]);

      await expect(addTablesToSlot(1, [2])).rejects.toMatchObject({
        message: 'TABLE_NOT_FOUND',
        status: 404,
      });
    });

    it('rejects tables with duplicate codes', async () => {
      dbGet.mockResolvedValue({ slot_id: 1 });
      dbAll.mockResolvedValue([
        { table_id: 2, table_code: 'A' },
        { table_id: 3, table_code: 'A' },
      ]);

      await expect(addTablesToSlot(1, [2, 3])).rejects.toMatchObject({
        message: 'DUPLICATE_TABLE_CODE',
        status: 400,
      });
      expect(dbRun).not.toHaveBeenCalled();
    });

    it('returns a conflict when the slot already has reservations', async () => {
      dbGet
        .mockResolvedValueOnce({ slot_id: 1 })
        .mockResolvedValueOnce({ reservation_id: 5 });
      dbAll.mockResolvedValue([{ table_id: 2, table_code: 'A' }]);
      dbRun.mockResolvedValue({ changes: 0 });

      await expect(addTablesToSlot(1, [2])).rejects.toMatchObject({
        message: 'SLOT_HAS_RESERVATIONS',
        status: 409,
      });
    });

    it('returns a conflict when the slot already contains the same table code', async () => {
      dbGet
        .mockResolvedValueOnce({ slot_id: 1 })
        .mockResolvedValueOnce(undefined);
      dbAll.mockResolvedValue([{ table_id: 2, table_code: 'A' }]);
      dbRun.mockResolvedValue({ changes: 0 });

      await expect(addTablesToSlot(1, [2])).rejects.toMatchObject({
        message: 'TABLE_CODE_ALREADY_IN_SLOT',
        status: 409,
      });
    });

    it('adds tables to a slot and returns the updated slot', async () => {
      dbGet.mockResolvedValue({ slot_id: 1 });
      dbAll
        .mockResolvedValueOnce([{ table_id: 2, table_code: 'A' }])
        .mockResolvedValueOnce([
          {
            slot_id: 1,
            start_at: '2027-01-10T10:00:00.000Z',
            end_at: '2027-01-10T11:00:00.000Z',
            table_id: 2,
            table_code: 'A',
            seats: 4,
          },
        ]);
      dbRun.mockResolvedValue({ changes: 1 });

      await expect(addTablesToSlot(1, [2])).resolves.toMatchObject({
        slotId: 1,
        hasTables: true,
        totalSeats: 4,
      });
      expect(dbRun.mock.calls[0][1]).toEqual([1, 2, 1, 1, 'A']);
    });
  });

  describe('copyTablesToSlot', () => {
    it('rejects copying a slot to itself', async () => {
      await expect(copyTablesToSlot(1, 1)).rejects.toMatchObject({
        message: 'SAME_SLOT',
        status: 400,
      });
      expect(dbGet).not.toHaveBeenCalled();
    });

    it('returns not found when the source slot does not exist', async () => {
      dbGet.mockResolvedValue(undefined);

      await expect(copyTablesToSlot(1, 2)).rejects.toMatchObject({
        message: 'SOURCE_SLOT_NOT_FOUND',
        status: 404,
      });
    });

    it('rejects when the source slot has no tables', async () => {
      dbGet.mockResolvedValue({ slot_id: 2 });
      dbAll.mockResolvedValue([]);

      await expect(copyTablesToSlot(1, 2)).rejects.toMatchObject({
        message: 'NO_TABLES_TO_COPY',
        status: 400,
      });
    });

    it('copies the source tables to the target slot', async () => {
      dbGet.mockResolvedValue({ slot_id: 2 });
      dbAll
        .mockResolvedValueOnce([{ table_id: 5 }])
        .mockResolvedValueOnce([{ table_id: 5, table_code: 'B' }])
        .mockResolvedValueOnce([
          {
            slot_id: 1,
            start_at: '2027-01-10T10:00:00.000Z',
            end_at: '2027-01-10T11:00:00.000Z',
            table_id: 5,
            table_code: 'B',
            seats: 6,
          },
        ]);
      dbRun.mockResolvedValue({ changes: 1 });

      await expect(copyTablesToSlot(1, 2)).resolves.toMatchObject({
        slotId: 1,
        hasTables: true,
        totalSeats: 6,
      });
    });
  });
});
