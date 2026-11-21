import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';

const BACKEND_URL = 'http://localhost:3002';
const BACKEND_DIR = new URL('../../../backend', import.meta.url);

beforeAll(async () => {
  execFileSync('node', ['db/init-db.js', '--reset'], { cwd: BACKEND_DIR });
  await import('../../../backend/index.js');
});

const at = (dayOffset, hours, minutes = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
};

const localDate = (iso) => iso.slice(0, 10);

async function loginAs(email) {
  const agent = request.agent(BACKEND_URL);
  const res = await agent.post('/api/sessions').send({ email, password: 'password' });
  expect(res.status).toBe(201);
  return agent;
}

const loginEmployee = () => loginAs('employee@mountainhut.test');
const loginHiker = () => loginAs('anna@mountainhut.test');

describe('Monitor Occupancy (Backend E2E)', () => {
  describe('Authentication and role authorization', () => {
    it('requires employee authentication for accessing capacity and occupancy data', async () => {
      const anonymous = request(BACKEND_URL);
      const unauthRes = await anonymous.get('/api/slots/capacity');
      expect(unauthRes.status).toBe(401);

      const hiker = await loginHiker();
      const forbiddenRes = await hiker.get('/api/slots/capacity');
      expect(forbiddenRes.status).toBe(403);
    });
  });

  describe('Capacity and occupancy calculation on slots and tables', () => {
    it('reports correct booked, remaining, and percentage occupancy after booking and releasing seats', async () => {
      const employee = await loginEmployee();
      const hiker = await loginHiker();

      const dayOffset = 50;
      const slotStart = at(dayOffset, 12);
      const slotEnd = at(dayOffset, 13);
      const slotDate = localDate(slotStart);

      const created = await employee.post('/api/slots').send({ startAt: slotStart, endAt: slotEnd });
      expect(created.status).toBe(201);
      const slotId = created.body.slotId;

      const unconfiguredQuery = await employee.get(`/api/slots/capacity?from=${slotDate}&to=${slotDate}`);
      expect(unconfiguredQuery.status).toBe(200);
      const unconfiguredSlot = unconfiguredQuery.body.find((s) => s.slotId === slotId);
      expect(unconfiguredSlot).toBeDefined();
      expect(unconfiguredSlot.hasTables).toBe(false);
      expect(unconfiguredSlot.totalSeats).toBe(0);
      expect(unconfiguredSlot.bookedSeats).toBe(0);
      expect(unconfiguredSlot.remainingSeats).toBe(0);
      expect(unconfiguredSlot.occupancyPercentage).toBe(0);
      expect(unconfiguredSlot.tables).toEqual([]);

      const tableT1 = 1;
      const tableT4 = 4;
      const assignRes = await employee.post(`/api/slots/${slotId}/tables`).send({ tableIds: [tableT1, tableT4] });
      expect(assignRes.status).toBe(201);

      const initialOccupancy = await employee.get(`/api/slots/capacity?from=${slotDate}&to=${slotDate}`);
      expect(initialOccupancy.status).toBe(200);
      const slotBeforeBooking = initialOccupancy.body.find((s) => s.slotId === slotId);
      expect(slotBeforeBooking.hasTables).toBe(true);
      expect(slotBeforeBooking.totalSeats).toBe(6);
      expect(slotBeforeBooking.bookedSeats).toBe(0);
      expect(slotBeforeBooking.remainingSeats).toBe(6);
      expect(slotBeforeBooking.occupancyPercentage).toBe(0);

      const bookedPartySize = 4;
      const bookingRes = await hiker.post('/api/reservations').send({ slotId, partySize: bookedPartySize });
      expect(bookingRes.status).toBe(201);
      const reservationId = bookingRes.body.reservationId;

      const occupancyAfterBooking = await employee.get(`/api/slots/capacity?from=${slotDate}&to=${slotDate}`);
      expect(occupancyAfterBooking.status).toBe(200);
      const slotAfterBooking = occupancyAfterBooking.body.find((s) => s.slotId === slotId);

      expect(slotAfterBooking.totalSeats).toBe(6);
      expect(slotAfterBooking.bookedSeats).toBe(4);
      expect(slotAfterBooking.remainingSeats).toBe(2);
      expect(slotAfterBooking.occupancyPercentage).toBe(Math.round((4 / 6) * 100));

      expect(slotAfterBooking.tables.length).toBe(2);
      for (const table of slotAfterBooking.tables) {
        expect(table.seats).toBe(table.bookedSeats + table.remainingSeats);
        const expectedPercentage = table.seats > 0 ? Math.round((table.bookedSeats / table.seats) * 100) : 0;
        expect(table.occupancyPercentage).toBe(expectedPercentage);
      }

      const sumTableBooked = slotAfterBooking.tables.reduce((acc, t) => acc + t.bookedSeats, 0);
      expect(sumTableBooked).toBe(slotAfterBooking.bookedSeats);

      const cancelRes = await hiker.delete(`/api/reservations/${reservationId}`);
      expect(cancelRes.status).toBe(200);

      const occupancyAfterCancel = await employee.get(`/api/slots/capacity?from=${slotDate}&to=${slotDate}`);
      expect(occupancyAfterCancel.status).toBe(200);
      const slotAfterCancel = occupancyAfterCancel.body.find((s) => s.slotId === slotId);

      expect(slotAfterCancel.totalSeats).toBe(6);
      expect(slotAfterCancel.bookedSeats).toBe(0);
      expect(slotAfterCancel.remainingSeats).toBe(6);
      expect(slotAfterCancel.occupancyPercentage).toBe(0);

      for (const table of slotAfterCancel.tables) {
        expect(table.bookedSeats).toBe(0);
        expect(table.remainingSeats).toBe(table.seats);
        expect(table.occupancyPercentage).toBe(0);
      }
    });

    it('rejects invalid query date parameters with 400', async () => {
      const employee = await loginEmployee();

      const invalidDate = await employee.get('/api/slots/capacity?from=invalid-date');
      expect(invalidDate.status).toBe(400);

      const invalidRange = await employee.get('/api/slots/capacity?from=2026-12-30&to=2026-12-01');
      expect(invalidRange.status).toBe(400);
    });
  });
});
