import { describe, it, expect, vi, beforeEach } from 'vitest';

// Replace external modules with mocks so tests run in memory without SQLite files
vi.mock('../../../backend/db/db.js', () => ({
  default: { get: vi.fn(), run: vi.fn(), all: vi.fn() },
  DB_PATH: ':memory:',
}));
vi.mock('../../../backend/utils/dbHelpers.js', () => ({
  dbAll: vi.fn(),
  dbGet: vi.fn(),
  dbRun: vi.fn(),
}));
vi.mock('../../../backend/models/dao/reservationDAO.js', () => ({
  makeReservation: vi.fn(),
  checkAvailability: vi.fn(),
}));

import { dbAll, dbGet, dbRun } from '../../../backend/utils/dbHelpers.js';
import { makeReservation as makeReservationMock } from '../../../backend/models/dao/reservationDAO.js';
import router from '../../../backend/api/reservationRoutes.js';
import BadRequestError from '../../../backend/models/errors/BadRequestError.js';
import ConflictError from '../../../backend/models/errors/ConflictError.js';
import NotFoundError from '../../../backend/models/errors/NotFoundError.js';
import UnauthorizedError from '../../../backend/models/errors/UnauthorizedError.js';

// Import actual DAO implementation to test algorithm and transaction handling
const { checkAvailability, makeReservation } = await vi.importActual(
  '../../../backend/models/dao/reservationDAO.js'
);

// Pull the handler out of express router stack to call it directly with mock req and res
function handler(method, path = '/') {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
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

describe('reservationDAO', () => {
  describe('checkAvailability', () => {
    it('finds the best single table that minimizes unused seats', async () => {
      // Table 1 has 4 seats, Table 2 has 6 seats. For a party of 3, Table 1 leaves fewer empty seats
      dbAll.mockResolvedValue([
        { slotTableId: 1, tableId: 1, tableCode: 'A1', totalSeats: 4, occupiedSeats: 0 },
        { slotTableId: 2, tableId: 2, tableCode: 'A2', totalSeats: 6, occupiedSeats: 0 },
      ]);

      const result = await checkAvailability(1, 3);

      expect(result).toEqual({
        available: true,
        tableAllocation: [{ slotTableId: 1, tableId: 1, tableCode: 'A1', allocatedSeats: 3 }],
      });
    });

    it('splits a party across multiple tables when no single table is big enough', async () => {
      // Party of 6 cannot fit on a single 4-seat table, so assign 4 on Table 1 and 2 on Table 2
      dbAll.mockResolvedValue([
        { slotTableId: 1, tableId: 1, tableCode: 'A1', totalSeats: 4, occupiedSeats: 0 },
        { slotTableId: 2, tableId: 2, tableCode: 'A2', totalSeats: 4, occupiedSeats: 0 },
      ]);

      const result = await checkAvailability(1, 6);

      expect(result).toEqual({
        available: true,
        tableAllocation: [
          { slotTableId: 1, tableId: 1, tableCode: 'A1', allocatedSeats: 4 },
          { slotTableId: 2, tableId: 2, tableCode: 'A2', allocatedSeats: 2 },
        ],
      });
    });

    it('returns available: false when there are not enough free seats', async () => {
      // Only 1 free seat on Table 1, party needs 4
      dbAll.mockResolvedValue([
        { slotTableId: 1, tableId: 1, totalSeats: 4, occupiedSeats: 3 },
        { slotTableId: 2, tableId: 2, totalSeats: 2, occupiedSeats: 2 },
      ]);

      const result = await checkAvailability(1, 4);

      expect(result).toEqual({
        available: false,
        tableAllocation: [],
      });
    });
  });

  describe('makeReservation', () => {
    it('rejects with BadRequestError when input parameters are invalid', async () => {
      // Input validation happens before opening any database transaction
      await expect(makeReservation(0, 1, 2)).rejects.toBeInstanceOf(BadRequestError);
      await expect(makeReservation(1, -1, 2)).rejects.toBeInstanceOf(BadRequestError);
      await expect(makeReservation(1, 1, 0)).rejects.toBeInstanceOf(BadRequestError);
      await expect(makeReservation('1', 1, 2)).rejects.toBeInstanceOf(BadRequestError);

      expect(dbRun).not.toHaveBeenCalled();
    });

    it('rejects with NotFoundError when the slot does not exist', async () => {
      dbRun.mockResolvedValue({ lastID: 1, changes: 1 });
      dbGet.mockResolvedValue(null);

      await expect(makeReservation(99, 1, 2)).rejects.toBeInstanceOf(NotFoundError);
      expect(dbRun).toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
    });

    it('rejects with ConflictError(BOOKING_TOO_LATE) when slot starts in less than 2 hours', async () => {
      // US1 rule: bookings must be made at least 2 hours (7200s) before start time
      dbRun.mockResolvedValue({ lastID: 1, changes: 1 });
      dbGet.mockResolvedValue({ slotId: 1, secondsUntilStart: 3600 });

      await expect(makeReservation(1, 1, 2)).rejects.toSatisfy(
        (err) => err instanceof ConflictError && err.message === 'BOOKING_TOO_LATE'
      );
      expect(dbRun).toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
    });

    it('rejects with ConflictError(ALREADY_BOOKED) when user already has a reservation for the slot', async () => {
      // Prevent duplicate bookings by the same user in the same slot
      dbRun.mockResolvedValue({ lastID: 1, changes: 1 });
      dbGet
        .mockResolvedValueOnce({ slotId: 1, secondsUntilStart: 10000 })
        .mockResolvedValueOnce({ reservation_id: 12 });

      await expect(makeReservation(1, 1, 2)).rejects.toSatisfy(
        (err) => err instanceof ConflictError && err.message === 'ALREADY_BOOKED'
      );
      expect(dbRun).toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
    });

    it('rejects with ConflictError(NO_AVAILABILITY) when tables cannot fit the party', async () => {
      dbRun.mockResolvedValue({ lastID: 1, changes: 1 });
      dbGet
        .mockResolvedValueOnce({ slotId: 1, secondsUntilStart: 10000 })
        .mockResolvedValueOnce(null);
      dbAll.mockResolvedValue([]);

      await expect(makeReservation(1, 1, 4)).rejects.toSatisfy(
        (err) => err instanceof ConflictError && err.message === 'NO_AVAILABILITY'
      );
      expect(dbRun).toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
    });

    it('creates and commits reservation atomically on success', async () => {
      // Sequence: PRAGMA foreign_keys -> BEGIN IMMEDIATE -> INSERT reservation -> INSERT allocation -> COMMIT
      dbRun
        .mockResolvedValueOnce({ lastID: 0, changes: 0 })
        .mockResolvedValueOnce({ lastID: 0, changes: 0 })
        .mockResolvedValueOnce({ lastID: 42, changes: 1 })
        .mockResolvedValueOnce({ lastID: 1, changes: 1 })
        .mockResolvedValueOnce({ lastID: 0, changes: 0 });

      dbGet
        .mockResolvedValueOnce({ slotId: 1, secondsUntilStart: 10000 })
        .mockResolvedValueOnce(null);

      dbAll.mockResolvedValue([
        { slotTableId: 10, tableId: 1, tableCode: 'A1', totalSeats: 4, occupiedSeats: 0 },
      ]);

      const reservation = await makeReservation(1, 5, 2);

      expect(reservation).toEqual({
        reservationId: 42,
        slotId: 1,
        partySize: 2,
        status: 'confirmed',
        tableAllocation: [{ tableId: 1, tableCode: 'A1', allocatedSeats: 2 }],
      });
      expect(dbRun).toHaveBeenCalledWith('BEGIN IMMEDIATE', [], expect.anything());
      expect(dbRun).toHaveBeenCalledWith('COMMIT', [], expect.anything());
    });

    it('rolls back the transaction when inserting table allocation fails', async () => {
      // Simulate database error during allocation insert: must trigger ROLLBACK so reservation is not orphaned
      dbRun
        .mockResolvedValueOnce({ lastID: 0, changes: 0 })
        .mockResolvedValueOnce({ lastID: 0, changes: 0 })
        .mockResolvedValueOnce({ lastID: 42, changes: 1 })
        .mockRejectedValueOnce(new Error('SQLITE_ERROR: disk I/O error'));

      dbGet
        .mockResolvedValueOnce({ slotId: 1, secondsUntilStart: 10000 })
        .mockResolvedValueOnce(null);

      dbAll.mockResolvedValue([
        { slotTableId: 10, tableId: 1, tableCode: 'A1', totalSeats: 4, occupiedSeats: 0 },
      ]);

      await expect(makeReservation(1, 5, 2)).rejects.toThrow('SQLITE_ERROR: disk I/O error');
      expect(dbRun).toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
    });
  });
});

describe('reservationRoutes', () => {
  describe('POST /api/reservations', () => {
    const postReservation = handler('post', '/');

    it('rejects with UnauthorizedError when the user is not authenticated', async () => {
      // Session user check happens before reading the body
      const req = { user: null, body: { slotId: 1, partySize: 2 } };
      const res = fakeRes();

      await expect(postReservation(req, res)).rejects.toBeInstanceOf(UnauthorizedError);
      expect(makeReservationMock).not.toHaveBeenCalled();
    });

    it('rejects with BadRequestError when slotId or partySize is missing or invalid', async () => {
      const res = fakeRes();

      await expect(
        postReservation({ user: { user_id: 1 }, body: { partySize: 2 } }, res)
      ).rejects.toBeInstanceOf(BadRequestError);

      await expect(
        postReservation({ user: { user_id: 1 }, body: { slotId: 1, partySize: 0 } }, res)
      ).rejects.toBeInstanceOf(BadRequestError);

      await expect(
        postReservation({ user: { user_id: 1 }, body: { slotId: -1, partySize: 2 } }, res)
      ).rejects.toBeInstanceOf(BadRequestError);

      expect(makeReservationMock).not.toHaveBeenCalled();
    });

    it('creates a reservation and responds 201 with the created reservation', async () => {
      const mockReservation = {
        reservationId: 42,
        slotId: 1,
        partySize: 3,
        status: 'confirmed',
        tableAllocation: [{ tableId: 2, tableCode: 'B1', allocatedSeats: 3 }],
      };
      makeReservationMock.mockResolvedValue(mockReservation);

      const req = {
        user: { user_id: 5 },
        body: { slotId: 1, partySize: 3 },
      };
      const res = fakeRes();

      await postReservation(req, res);

      expect(makeReservationMock).toHaveBeenCalledWith(1, 5, 3);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(mockReservation);
    });
  });
});
describe('makeReservation - Happy Paths for Employee', () => {
  
  it('creates a reservation for an existent hiker when booked by an employee', async () => {
    const byEmployee = { employeeId: 99 };
    const hikerUserId = 5;

    // 1. Mock DB reads (SELECTs)
    dbGet
      .mockResolvedValueOnce({ slotId: 1, secondsUntilStart: 10000 }) // Valid slot
      .mockResolvedValueOnce({ userId: hikerUserId, name: 'Mario Rossi', email: 'mario@test.com', phone: '111' }) // Hiker found
      .mockResolvedValueOnce(null); // No existing reservations for this user in this slot

    // 2. Mock table availability
    dbAll.mockResolvedValue([
      { slotTableId: 10, tableId: 1, tableCode: 'A1', totalSeats: 4, occupiedSeats: 0 }
    ]);

    // 3. Mock DB writes (INSERTs and Transaction commands)
    dbRun
      .mockResolvedValueOnce({ lastID: 0, changes: 0 })   // PRAGMA foreign_keys = ON
      .mockResolvedValueOnce({ lastID: 0, changes: 0 })   // BEGIN IMMEDIATE
      .mockResolvedValueOnce({ lastID: 42, changes: 1 })  // INSERT INTO reservations
      .mockResolvedValueOnce({ lastID: 1, changes: 1 })   // INSERT INTO reservation_table
      .mockResolvedValueOnce({ lastID: 0, changes: 0 });  // COMMIT

    const result = await makeReservation(1, hikerUserId, 2, undefined, byEmployee);

    // Verify the returned object structure
    expect(result).toEqual({
      reservationId: 42,
      slotId: 1,
      partySize: 2,
      status: 'confirmed',
      hiker: { userId: 5, name: 'Mario Rossi', email: 'mario@test.com', phone: '111' },
      tableAllocation: [{ tableId: 1, tableCode: 'A1', allocatedSeats: 2 }]
    });

    // Verify that the reservation was committed
    expect(dbRun).toHaveBeenCalledWith('COMMIT', [], expect.anything());
  });


  it('registers a new hiker and creates a reservation atomically when booked by an employee', async () => {
    const newHikerData = {
      name: 'Luigi Verdi',
      email: 'luigi@test.com',
      phone: '222',
      passwordHash: 'hash',
      salt: 'salt'
    };
    const byEmployee = { employeeId: 99, newHiker: newHikerData };

    // 1. Mock DB reads (SELECTs)
    // Note: 'existingReservation' check is skipped because userId is null initially
    dbGet
      .mockResolvedValueOnce({ slotId: 1, secondsUntilStart: 10000 }) // Valid slot
      .mockResolvedValueOnce(null); // Email check: no existing user found with this email

    // 2. Mock table availability
    dbAll.mockResolvedValue([
      { slotTableId: 10, tableId: 1, tableCode: 'A1', totalSeats: 4, occupiedSeats: 0 }
    ]);

    // 3. Mock DB writes (INSERTs and Transaction commands)
    dbRun
      .mockResolvedValueOnce({ lastID: 0, changes: 0 })   // PRAGMA foreign_keys = ON
      .mockResolvedValueOnce({ lastID: 0, changes: 0 })   // BEGIN IMMEDIATE
      .mockResolvedValueOnce({ lastID: 10, changes: 1 })  // INSERT INTO users (generates userId 10)
      .mockResolvedValueOnce({ lastID: 43, changes: 1 })  // INSERT INTO reservations
      .mockResolvedValueOnce({ lastID: 1, changes: 1 })   // INSERT INTO reservation_table
      .mockResolvedValueOnce({ lastID: 0, changes: 0 });  // COMMIT

    const result = await makeReservation(1, null, 2, undefined, byEmployee);

    // Verify the returned object includes the newly generated userId
    expect(result).toEqual({
      reservationId: 43,
      slotId: 1,
      partySize: 2,
      status: 'confirmed',
      hiker: { userId: 10, name: 'Luigi Verdi', email: 'luigi@test.com', phone: '222' },
      tableAllocation: [{ tableId: 1, tableCode: 'A1', allocatedSeats: 2 }]
    });
  });


  it('creates a reservation for a guest shortly before the slot starts (employee time override)', async () => {
    const guestData = { name: 'Anna Neri', phone: '333' };
    const byEmployee = { employeeId: 99, guest: guestData };

    // 1. Mock DB reads (SELECTs)
    // 1800 seconds = 30 minutes. An hiker would get 'BOOKING_TOO_LATE' (< 7200), 
    // but the employee is allowed until secondsUntilStart <= 0
    dbGet
      .mockResolvedValueOnce({ slotId: 1, secondsUntilStart: 1800 }); 

    // 2. Mock table availability
    dbAll.mockResolvedValue([
      { slotTableId: 10, tableId: 1, tableCode: 'A1', totalSeats: 4, occupiedSeats: 0 }
    ]);

    // 3. Mock DB writes (INSERTs and Transaction commands)
    dbRun
      .mockResolvedValueOnce({ lastID: 0, changes: 0 })   // PRAGMA foreign_keys = ON
      .mockResolvedValueOnce({ lastID: 0, changes: 0 })   // BEGIN IMMEDIATE
      .mockResolvedValueOnce({ lastID: 44, changes: 1 })  // INSERT INTO reservations
      .mockResolvedValueOnce({ lastID: 1, changes: 1 })   // INSERT INTO reservation_table
      .mockResolvedValueOnce({ lastID: 0, changes: 0 });  // COMMIT

    const result = await makeReservation(1, null, 2, undefined, byEmployee);

    // Verify the returned object structure for a guest (userId and email are null)
    expect(result).toEqual({
      reservationId: 44,
      slotId: 1,
      partySize: 2,
      status: 'confirmed',
      hiker: { userId: null, name: 'Anna Neri', email: null, phone: '333' },
      tableAllocation: [{ tableId: 1, tableCode: 'A1', allocatedSeats: 2 }]
    });
  });

  it("rejects with NotFoundError('HIKER_NOT_FOUND') when employee provides a non-existent userId", async () => {
    const byEmployee = { employeeId: 99 };
    const invalidUserId = 999;

    // 1. Mock DB writes for transaction setup and rollback
    dbRun
      .mockResolvedValueOnce({ lastID: 0, changes: 0 }) // PRAGMA foreign_keys = ON
      .mockResolvedValueOnce({ lastID: 0, changes: 0 }) // BEGIN IMMEDIATE
      .mockResolvedValueOnce({ lastID: 0, changes: 0 });// ROLLBACK (called in catch block)

    // 2. Mock DB reads
    dbGet
      .mockResolvedValueOnce({ slotId: 1, secondsUntilStart: 10000 }) // Valid slot
      .mockResolvedValueOnce(null); // The query for the hiker returns nothing

    // 3. Execute and verify the rejection
    await expect(makeReservation(1, invalidUserId, 2, undefined, byEmployee))
      .rejects.toBeInstanceOf(NotFoundError); // Checks for HIKER_NOT_FOUND

    // 4. Verify that the transaction was safely rolled back
    expect(dbRun).toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
  });


  it("rejects with ConflictError('EMAIL_ALREADY_USED') when registering a new hiker with an existing email", async () => {
    const newHikerData = {
      name: 'Luigi Verdi',
      email: 'existing@test.com', // This email is already in the DB
      phone: '222',
      passwordHash: 'hash',
      salt: 'salt'
    };
    const byEmployee = { employeeId: 99, newHiker: newHikerData };

    dbRun
      .mockResolvedValueOnce({ lastID: 0, changes: 0 }) // PRAGMA foreign_keys = ON
      .mockResolvedValueOnce({ lastID: 0, changes: 0 }) // BEGIN IMMEDIATE
      .mockResolvedValueOnce({ lastID: 0, changes: 0 });// ROLLBACK

    dbGet
      .mockResolvedValueOnce({ slotId: 1, secondsUntilStart: 10000 }) // Valid slot
      // Note: skip duplicated booking check because userId is null
      .mockResolvedValueOnce({ user_id: 88 }); // Email check finds an existing user

    dbAll.mockResolvedValue([
      { slotTableId: 10, tableId: 1, tableCode: 'A1', totalSeats: 4, occupiedSeats: 0 } // Tables are available
    ]);

    await expect(makeReservation(1, null, 2, undefined, byEmployee)).rejects.toSatisfy(
      (err) => err instanceof ConflictError && err.message === 'EMAIL_ALREADY_USED'
    );

    expect(dbRun).toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
  });


  it("rejects with ConflictError('BOOKING_TOO_LATE') when employee tries to book a slot that has already started", async () => {
    const guestData = { name: 'Late Guest', phone: '333' };
    const byEmployee = { employeeId: 99, guest: guestData };

    dbRun
      .mockResolvedValueOnce({ lastID: 0, changes: 0 }) // PRAGMA foreign_keys = ON
      .mockResolvedValueOnce({ lastID: 0, changes: 0 }) // BEGIN IMMEDIATE
      .mockResolvedValueOnce({ lastID: 0, changes: 0 });// ROLLBACK

    dbGet
      // secondsUntilStart is negative, meaning the slot started 60 seconds ago.
      // Even the employee override (which allows up to <= 0) fails here.
      .mockResolvedValueOnce({ slotId: 1, secondsUntilStart: -60 });

    await expect(makeReservation(1, null, 2, undefined, byEmployee)).rejects.toSatisfy(
      (err) => err instanceof ConflictError && err.message === 'BOOKING_TOO_LATE'
    );

    // Ensure we don't proceed with checking tables or hikers
    expect(dbGet).toHaveBeenCalledTimes(1); 
    expect(dbRun).toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
  });

});