import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll } from 'vitest';

const BACKEND_URL = 'http://localhost:3002'; // PORT, see backend/vitest.config.js

// Demo tables (backend/db/init-db.js)
const T1 = 1; // 4 seats
const T2 = 2; // 4 seats
const T3 = 3; // 6 seats
const T4 = 4; // 2 seats
const T5 = 5; // 2 seats

// ISO timestamp for future test slots avoiding conflict with demo slots
function at(dayOffset, hours, minutes = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

// Relative ISO timestamp in hours from now
function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

async function loginAs(email) {
  const agent = request.agent(BACKEND_URL);
  const res = await agent.post('/api/sessions').send({ email, password: 'password' });
  expect(res.status).toBe(201);
  return agent;
}

const loginEmployee = () => loginAs('employee@mountainhut.test');
const loginHiker = () => loginAs('anna@mountainhut.test');

async function waitForServer(url = BACKEND_URL, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

// Recreate the e2e database from demo data and ensure backend is running
beforeAll(async () => {
  execFileSync('node', ['db/init-db.js', '--reset'], { cwd: new URL('../../../backend', import.meta.url) });
  try {
    await import('../../../backend/index.js');
  } catch (err) {
    // If backend was already imported/started in another test file
  }
  await waitForServer();
});

describe('Availability e2e', () => {
  describe('Public check (no login required)', () => {
    it('allows an unauthenticated user to check availability and returns table allocation', async () => {
      // Unauthenticated request without any session cookie or authentication
      const anonymous = request(BACKEND_URL);
      const res = await anonymous.get('/api/slots/4/availability?partySize=2');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        slotId: 4,
        partySize: 2,
        available: true,
        tableAllocation: [
          { tableId: T1, tableCode: 'T1', allocatedSeats: 2 },
        ],
      });
    });
  });

  describe('Capacity and table layout allocation', () => {
    it('calculates availability taking existing reservations into account', async () => {
      // Slot 1 (tomorrow 11:00-12:00) has tables T1(4), T2(4), T3(6), T4(2), T5(2) = 18 seats.
      // Demo reservations occupy: T3(5), T1(4), T4(2).
      // Free seats remaining: T2(4) + T3(1) + T5(2) = 7 seats.
      const anonymous = request(BACKEND_URL);

      // Party of 7 fits the remaining free seats
      const fits = await anonymous.get('/api/slots/1/availability?partySize=7');
      expect(fits.status).toBe(200);
      expect(fits.body.available).toBe(true);
      expect(fits.body.partySize).toBe(7);
      expect(fits.body.tableAllocation).toEqual([
        { tableId: T2, tableCode: 'T2', allocatedSeats: 4 },
        { tableId: T3, tableCode: 'T3', allocatedSeats: 1 },
        { tableId: T5, tableCode: 'T5', allocatedSeats: 2 },
      ]);

      // Party of 8 exceeds the remaining free seats (7 available)
      const tooMany = await anonymous.get('/api/slots/1/availability?partySize=8');
      expect(tooMany.status).toBe(200);
      expect(tooMany.body).toEqual({
        slotId: 1,
        partySize: 8,
        available: false,
        tableAllocation: [],
      });
    });

    it('splits a party across multiple tables when needed (e.g., 6 seats over 3 tables of 2)', async () => {
      const employee = await loginEmployee();

      // Create a new table T6 with 2 seats
      const tableRes = await employee.post('/api/tables').send({ code: 'T6_US4', seats: 2 });
      expect(tableRes.status).toBe(201);
      const t6Id = tableRes.body.table_id || tableRes.body.tableId;

      // Create a new slot in 50 days to avoid overlap with demo data
      const slotRes = await employee.post('/api/slots').send({
        startAt: at(50, 12),
        endAt: at(50, 13),
      });
      expect(slotRes.status).toBe(201);
      const { slotId } = slotRes.body;

      // Assign 3 tables of 2 seats (T4: 2, T5: 2, T6: 2) -> total 6 seats
      const tablesRes = await employee.post(`/api/slots/${slotId}/tables`).send({
        tableIds: [T4, T5, t6Id],
      });
      expect(tablesRes.status).toBe(201);
      expect(tablesRes.body.totalSeats).toBe(6);

      // Anonymous check: party of 6 is available and split across the 3 tables (2 + 2 + 2)
      const anonymous = request(BACKEND_URL);
      const res = await anonymous.get(`/api/slots/${slotId}/availability?partySize=6`);

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(true);
      expect(res.body.partySize).toBe(6);
      expect(res.body.tableAllocation).toEqual([
        { tableId: T4, tableCode: 'T4', allocatedSeats: 2 },
        { tableId: T5, tableCode: 'T5', allocatedSeats: 2 },
        { tableId: t6Id, tableCode: 'T6_US4', allocatedSeats: 2 },
      ]);

      const sumAllocated = res.body.tableAllocation.reduce((sum, t) => sum + t.allocatedSeats, 0);
      expect(sumAllocated).toBe(6);
    });
  });

  describe('No alternative slots suggested', () => {
    it('does not include alternative slots in response when availability is negative', async () => {
      const anonymous = request(BACKEND_URL);
      const res = await anonymous.get('/api/slots/1/availability?partySize=20');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        slotId: 1,
        partySize: 20,
        available: false,
        tableAllocation: [],
      });
      // Verify no alternative slots or recommendations are returned
      expect(res.body).not.toHaveProperty('alternativeSlots');
      expect(res.body).not.toHaveProperty('alternatives');
      expect(res.body).not.toHaveProperty('suggestedSlots');
    });

    it('allows user to manually check another slot when one is full', async () => {
      const anonymous = request(BACKEND_URL);

      // Slot 1 only has 7 seats left -> 10 seats is unavailable
      const slot1Res = await anonymous.get('/api/slots/1/availability?partySize=10');
      expect(slot1Res.status).toBe(200);
      expect(slot1Res.body.available).toBe(false);

      // User manually checks Slot 4 (which has 10 seats free: T1 4 + T3 6) -> available!
      const slot4Res = await anonymous.get('/api/slots/4/availability?partySize=10');
      expect(slot4Res.status).toBe(200);
      expect(slot4Res.body.available).toBe(true);
      expect(slot4Res.body.tableAllocation).toEqual([
        { tableId: T1, tableCode: 'T1', allocatedSeats: 4 },
        { tableId: T3, tableCode: 'T3', allocatedSeats: 6 },
      ]);
    });
  });

  describe('Booking cutoff time constraint', () => {
    it('reports unavailable if the slot starts in less than 2 hours even with free seats', async () => {
      const employee = await loginEmployee();

      // Slot starting in 1 hour and ending in 2 hours
      const slotRes = await employee.post('/api/slots').send({
        startAt: hoursFromNow(1),
        endAt: hoursFromNow(2),
      });
      expect(slotRes.status).toBe(201);
      const { slotId } = slotRes.body;

      // Assign table T1 (4 seats)
      await employee.post(`/api/slots/${slotId}/tables`).send({ tableIds: [T1] });

      const anonymous = request(BACKEND_URL);
      const res = await anonymous.get(`/api/slots/${slotId}/availability?partySize=2`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        slotId,
        partySize: 2,
        available: false,
        tableAllocation: [],
      });
    });
  });

  describe('Availability update lifecycle (Check -> Reserve -> Check again)', () => {
    it('updates available seats immediately after a reservation is confirmed', async () => {
      const anonymous = request(BACKEND_URL);
      const hiker = await loginHiker();

      // Slot 4 has 10 seats free initially
      const initial = await anonymous.get('/api/slots/4/availability?partySize=3');
      expect(initial.status).toBe(200);
      expect(initial.body.available).toBe(true);

      // Hiker books 3 seats in slot 4
      const bookRes = await hiker.post('/api/reservations').send({
        slotId: 4,
        partySize: 3,
      });
      expect(bookRes.status).toBe(201);
      expect(bookRes.body.tableAllocation).toEqual(initial.body.tableAllocation);

      // Now 7 seats are still available (10 - 3 = 7)
      const fits7 = await anonymous.get('/api/slots/4/availability?partySize=7');
      expect(fits7.status).toBe(200);
      expect(fits7.body.available).toBe(true);

      // But 8 seats no longer fit
      const tooMany8 = await anonymous.get('/api/slots/4/availability?partySize=8');
      expect(tooMany8.status).toBe(200);
      expect(tooMany8.body.available).toBe(false);
      expect(tooMany8.body.tableAllocation).toEqual([]);
    });
  });

  describe('Input validation and error handling', () => {
    it('returns 400 INVALID_INPUT when partySize is missing or invalid', async () => {
      const anonymous = request(BACKEND_URL);

      const missingParty = await anonymous.get('/api/slots/4/availability');
      expect(missingParty.status).toBe(400);
      expect(missingParty.body.error).toBe('INVALID_INPUT');

      const zeroParty = await anonymous.get('/api/slots/4/availability?partySize=0');
      expect(zeroParty.status).toBe(400);
      expect(zeroParty.body.error).toBe('INVALID_INPUT');

      const negativeParty = await anonymous.get('/api/slots/4/availability?partySize=-2');
      expect(negativeParty.status).toBe(400);
      expect(negativeParty.body.error).toBe('INVALID_INPUT');

      const decimalParty = await anonymous.get('/api/slots/4/availability?partySize=2.5');
      expect(decimalParty.status).toBe(400);
      expect(decimalParty.body.error).toBe('INVALID_INPUT');

      const stringParty = await anonymous.get('/api/slots/4/availability?partySize=two');
      expect(stringParty.status).toBe(400);
      expect(stringParty.body.error).toBe('INVALID_INPUT');
    });

    it('returns 400 INVALID_INPUT when slotId is invalid', async () => {
      const anonymous = request(BACKEND_URL);

      const nonNumericSlot = await anonymous.get('/api/slots/notanumber/availability?partySize=2');
      expect(nonNumericSlot.status).toBe(400);
      expect(nonNumericSlot.body.error).toBe('INVALID_INPUT');

      const zeroSlot = await anonymous.get('/api/slots/0/availability?partySize=2');
      expect(zeroSlot.status).toBe(400);
      expect(zeroSlot.body.error).toBe('INVALID_INPUT');

      const negativeSlot = await anonymous.get('/api/slots/-5/availability?partySize=2');
      expect(negativeSlot.status).toBe(400);
      expect(negativeSlot.body.error).toBe('INVALID_INPUT');
    });

    it('returns 404 SLOT_NOT_FOUND when slot does not exist', async () => {
      const anonymous = request(BACKEND_URL);
      const res = await anonymous.get('/api/slots/99999/availability?partySize=2');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('SLOT_NOT_FOUND');
    });
  });
});
