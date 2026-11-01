import request from 'supertest';
import sqlite3 from 'sqlite3';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DB_PATH } from '../../../backend/db/db.js';

const BACKEND_URL = 'http://localhost:3001';

// Helper to remove any test data added during test runs
function cleanupTestData() {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(DB_PATH);
    db.serialize(() => {
      db.run('DELETE FROM reservation_table WHERE reservation_id > 8');
      db.run('DELETE FROM reservations WHERE reservation_id > 8');
      db.run('DELETE FROM users WHERE email LIKE "%@example.com"');
      db.close(resolve);
    });
  });
}

beforeAll(async () => {
  await import('../../../backend/index.js');
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
});

function getLocalDateString(dayOffset = 1) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

describe('Reservation e2e', () => {
  let agent;

  beforeEach(() => {
    agent = request.agent(BACKEND_URL);
  });

  describe('GET /api/slots', () => {
    it('returns 400 when date query parameter is missing', async () => {
      const res = await agent.get('/api/slots');
      expect(res.status).toBe(400);
    });

    it('returns 400 when date format is invalid', async () => {
      const res = await agent.get('/api/slots?date=invalid-date');
      expect(res.status).toBe(400);
    });

    it('returns 200 and slots array for a valid date', async () => {
      const date = getLocalDateString(1);
      const res = await agent.get(`/api/slots?date=${date}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        expect(res.body[0]).toHaveProperty('slotId');
        expect(res.body[0]).toHaveProperty('startTime');
        expect(res.body[0]).toHaveProperty('endTime');
        expect(res.body[0]).toHaveProperty('bookingAllowed');
      }
    });
  });

  describe('POST /api/reservations', () => {
    it('returns 401 when the request is unauthenticated', async () => {
      const res = await agent.post('/api/reservations').send({
        slotId: 1,
        partySize: 2,
      });

      expect(res.status).toBe(401);
    });

    it('returns 400 when input fields are invalid or missing', async () => {
      const unique = Date.now();
      await agent.post('/api/users').send({
        name: 'Test Hiker',
        email: `hiker.${unique}@example.com`,
        phone: '3331112233',
        password: 'password123',
      });

      // Missing partySize
      const res1 = await agent.post('/api/reservations').send({ slotId: 1 });
      expect(res1.status).toBe(400);

      // Invalid partySize (<= 0)
      const res2 = await agent.post('/api/reservations').send({ slotId: 1, partySize: 0 });
      expect(res2.status).toBe(400);

      // Invalid slotId (non-integer)
      const res3 = await agent.post('/api/reservations').send({ slotId: 'abc', partySize: 2 });
      expect(res3.status).toBe(400);
    });

    it('returns 404 when slot does not exist', async () => {
      const unique = Date.now();
      await agent.post('/api/users').send({
        name: 'Test Hiker',
        email: `hiker.${unique}@example.com`,
        phone: '3331112233',
        password: 'password123',
      });

      const res = await agent.post('/api/reservations').send({
        slotId: 99999,
        partySize: 2,
      });

      expect(res.status).toBe(404);
    });

    it('creates a reservation successfully and rejects duplicate booking for the same slot', async () => {
      // Register a fresh hiker who has no existing reservations
      const unique = Date.now();
      const user = {
        name: 'Marco Neri',
        email: `marco.${unique}@example.com`,
        phone: '3334445566',
        password: 'password123',
      };
      const regRes = await agent.post('/api/users').send(user);
      expect(regRes.status).toBe(201);

      // Find an allowed time slot from upcoming days
      let targetSlotId = null;
      for (const offset of [1, 2, 3]) {
        const dateStr = getLocalDateString(offset);
        const slotsRes = await agent.get(`/api/slots?date=${dateStr}`);
        if (slotsRes.status === 200 && Array.isArray(slotsRes.body)) {
          const allowedSlot = slotsRes.body.find((s) => s.bookingAllowed);
          if (allowedSlot) {
            targetSlotId = allowedSlot.slotId;
            break;
          }
        }
      }

      if (!targetSlotId) targetSlotId = 4;

      // First booking: should succeed with 201
      const bookRes = await agent.post('/api/reservations').send({
        slotId: targetSlotId,
        partySize: 2,
      });

      expect(bookRes.status).toBe(201);
      expect(bookRes.body).toHaveProperty('reservationId');
      expect(bookRes.body.slotId).toBe(targetSlotId);
      expect(bookRes.body.partySize).toBe(2);
      expect(bookRes.body.status).toBe('confirmed');
      expect(Array.isArray(bookRes.body.tableAllocation)).toBe(true);

      // Second booking in same slot by same user: should be rejected with 409 ALREADY_BOOKED
      const duplicateRes = await agent.post('/api/reservations').send({
        slotId: targetSlotId,
        partySize: 2,
      });

      expect(duplicateRes.status).toBe(409);
      expect(duplicateRes.body.error).toBe('ALREADY_BOOKED');
    });
  });
});
