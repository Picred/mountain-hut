import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const BACKEND_URL = 'http://localhost:3002'; // PORT, see backend/vitest.config.js

// Demo users and tables (backend/db/init-db.js), all demo users have password "password"
const WARDEN_ID = 1;
const EMPLOYEE_ID = 2;
const ANNA = { userId: 3, name: 'Anna Winden', email: 'anna@mountainhut.test', phone: '+393401234567' };
const T1 = 1; // 4 seats
const T2 = 2; // 4 seats
const T3 = 3; // 6 seats

// Recreate the e2e database (DB_PATH, see backend/vitest.config.js) from the demo data, then start the backend
beforeAll(async () => {
  execFileSync('node', ['db/init-db.js', '--reset'], { cwd: new URL('../../../backend', import.meta.url) });
  await import('../../../backend/index.js');
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
        expect(res.body[0]).toHaveProperty('availableSeats');
        expect(Number.isInteger(res.body[0].availableSeats)).toBe(true);
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

    // ----------- Reservation made by an employee ---------------

    it('an employee creates a reservation for a registered hiker', async () => {
      // Register a fresh hiker (separate agent, so the employee session is kept)
      const unique = Date.now();
      const hikerData = {
        name: 'Luca Bianchi',
        email: `luca.${unique}@example.com`,
        phone: '3339998877',
        password: 'password123',
      };
      const regRes = await request(BACKEND_URL).post('/api/users').send(hikerData);
      expect(regRes.status).toBe(201);

      // Log in as employee
      const login = await agent.post('/api/sessions').send({
        email: 'employee@mountainhut.test',
        password: 'password',
      });
      expect(login.status).toBe(201);

      // Create a new slot with tables T1, T2, T3 (14 seats)
      const start = new Date();
      start.setDate(start.getDate() + 60);
      start.setHours(12, 0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const slotRes = await agent.post('/api/slots').send({ startAt: start.toISOString(), endAt: end.toISOString() });
      expect(slotRes.status).toBe(201);
      const slotId = slotRes.body.slotId;
      expect((await agent.post(`/api/slots/${slotId}/tables`).send({ tableIds: [1, 2, 3] })).status).toBe(201);

      // Look up the hiker
      const search = await agent.get('/api/hikers').query({ search: hikerData.email });
      expect(search.status).toBe(200);
      expect(search.body).toHaveLength(1);
      const hiker = search.body[0];

      const bookRes = await agent.post('/api/reservations').send({
        slotId,
        partySize: 2,
        hiker: { userId: hiker.userId },
      });

      expect(bookRes.status).toBe(201);
      expect(bookRes.body).toHaveProperty('reservationId');
      expect(bookRes.body.slotId).toBe(slotId);
      expect(bookRes.body.partySize).toBe(2);
      expect(bookRes.body.status).toBe('confirmed');
      expect(Array.isArray(bookRes.body.tableAllocation)).toBe(true);
      expect(bookRes.body.hiker).toEqual({
        userId: hiker.userId,
        name: hikerData.name,
        email: hikerData.email,
        phone: hikerData.phone,
      });

      // The hiker sees the reservation among their own
      const hikerAgent = request.agent(BACKEND_URL);
      await hikerAgent.post('/api/sessions').send({ email: hikerData.email, password: hikerData.password });
      const mine = await hikerAgent.get('/api/reservations');
      expect(mine.status).toBe(200);
      expect(mine.body.map((r) => r.reservationId)).toContain(bookRes.body.reservationId);

      // Second booking for the same hiker in the same slot: rejected with 409 ALREADY_BOOKED
      const duplicateRes = await agent.post('/api/reservations').send({
        slotId,
        partySize: 2,
        hiker: { userId: hiker.userId },
      });
      expect(duplicateRes.status).toBe(409);
      expect(duplicateRes.body.error).toBe('ALREADY_BOOKED');
    });

    it('an employee creates a reservation for an unregistered hiker, who is registered with it', async () => {
      const login = await agent.post('/api/sessions').send({
        email: 'employee@mountainhut.test',
        password: 'password',
      });
      expect(login.status).toBe(201);

      // Create a new slot with tables T1, T2, T3 (14 seats)
      const start = new Date();
      start.setDate(start.getDate() + 61);
      start.setHours(12, 0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const slotRes = await agent.post('/api/slots').send({ startAt: start.toISOString(), endAt: end.toISOString() });
      expect(slotRes.status).toBe(201);
      const slotId = slotRes.body.slotId;
      expect((await agent.post(`/api/slots/${slotId}/tables`).send({ tableIds: [1, 2, 3] })).status).toBe(201);

      // A new hiker needs name, email and phone: the password is generated by the backend
      const unique = Date.now();
      const hikerData = {
        name: 'Giovanni Giorgio',
        email: `giovanni.${unique}@example.com`,
        phone: '1234321',
      };

      const bookRes = await agent.post('/api/reservations').send({
        slotId,
        partySize: 2,
        hiker: hikerData,
      });

      expect(bookRes.status).toBe(201);
      expect(bookRes.body).toHaveProperty('reservationId');
      expect(bookRes.body.slotId).toBe(slotId);
      expect(bookRes.body.partySize).toBe(2);
      expect(bookRes.body.status).toBe('confirmed');
      expect(Array.isArray(bookRes.body.tableAllocation)).toBe(true);
      expect(bookRes.body.hiker).toEqual({
        userId: expect.any(Number),
        name: hikerData.name,
        email: hikerData.email,
        phone: hikerData.phone,
      });
      // The random password is returned once, to be told to the hiker
      const temporaryPassword = bookRes.body.temporaryPassword;
      expect(temporaryPassword).toMatch(/^[A-Za-z0-9_-]{12}$/);

      // The employee can now find the hiker
      const search = await agent.get('/api/hikers').query({ search: hikerData.email });
      expect(search.status).toBe(200);
      expect(search.body).toHaveLength(1);

      // The new hiker logs in with the temporary password and must change it
      const hikerAgent = request.agent(BACKEND_URL);
      const hikerLogin = await hikerAgent.post('/api/sessions').send({ email: hikerData.email, password: temporaryPassword });
      expect(hikerLogin.status).toBe(201);
      expect(hikerLogin.body.passwordToChange).toBe(true);
    });

    it('an employee creates a reservation for a temporary hiker, without an account', async () => {
      const login = await agent.post('/api/sessions').send({
        email: 'employee@mountainhut.test',
        password: 'password',
      });
      expect(login.status).toBe(201);

      // Create a new slot with tables T1, T2, T3 (14 seats)
      const start = new Date();
      start.setDate(start.getDate() + 62);
      start.setHours(12, 0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const slotRes = await agent.post('/api/slots').send({ startAt: start.toISOString(), endAt: end.toISOString() });
      expect(slotRes.status).toBe(201);
      const slotId = slotRes.body.slotId;
      expect((await agent.post(`/api/slots/${slotId}/tables`).send({ tableIds: [1, 2, 3] })).status).toBe(201);

      // Only name (and optionally phone): a temporary hiker
      const bookRes = await agent.post('/api/reservations').send({
        slotId,
        partySize: 2,
        hiker: { name: 'Mark Rossi', phone: '0123456789' },
      });

      expect(bookRes.status).toBe(201);
      expect(bookRes.body.status).toBe('confirmed');
      expect(bookRes.body.hiker).toEqual({ userId: null, name: 'Mark Rossi', email: null, phone: '0123456789' });

      // Without phone: saved as null
      const noPhoneRes = await agent.post('/api/reservations').send({
        slotId,
        partySize: 2,
        hiker: { name: 'Walk In' },
      });

      expect(noPhoneRes.status).toBe(201);
      expect(noPhoneRes.body.hiker).toEqual({ userId: null, name: 'Walk In', email: null, phone: null });

      // A temporary hiker is not registered
      const search = await agent.get('/api/hikers').query({ search: 'Mark Rossi' });
      expect(search.status).toBe(200);
      expect(search.body).toEqual([]);
    });

    it('returns 400 when an employee sends an invalid hiker', async () => {
      const login = await agent.post('/api/sessions').send({
        email: 'employee@mountainhut.test',
        password: 'password',
      });
      expect(login.status).toBe(201);

      // Missing hiker
      const res1 = await agent.post('/api/reservations').send({ slotId: 4, partySize: 2 });
      expect(res1.status).toBe(400);

      // Hiker is not an object
      const res2 = await agent.post('/api/reservations').send({ slotId: 4, partySize: 2, hiker: 'Anna Winden' });
      expect(res2.status).toBe(400);

      // Invalid userId
      const res3 = await agent.post('/api/reservations').send({ slotId: 4, partySize: 2, hiker: { userId: 'abc' } });
      expect(res3.status).toBe(400);

      
      // New hiker without phone
      const res4 = await agent.post('/api/reservations').send({
        slotId: 4,
        partySize: 2,
        hiker: { name: 'Giovanni Giorgio', email: 'giovanni@giorgio.com' },
      });
      expect(res4.status).toBe(400);

      // New hiker with an empty name
      const res5 = await agent.post('/api/reservations').send({
        slotId: 4,
        partySize: 2,
        hiker: { name: ' ', email: 'giovanni@giorgio.com', phone: '1234321' },
      });
      expect(res5.status).toBe(400);


      // Temporary hiker with an empty name
      const res6 = await agent.post('/api/reservations').send({ slotId: 4, partySize: 2, hiker: { name: '  ' } });
      expect(res6.status).toBe(400);

      // Temporary hiker with a phone that is not a string
      const res7 = await agent.post('/api/reservations').send({
        slotId: 4,
        partySize: 2,
        hiker: { name: 'Mark Rossi', phone: 123456 },
      });
      expect(res7.status).toBe(400);
    });

    it('returns 404 when an employee books for a slot or a hiker that does not exist', async () => {
      const login = await agent.post('/api/sessions').send({
        email: 'employee@mountainhut.test',
        password: 'password',
      });
      expect(login.status).toBe(201);

      // Slot does not exist
      const res1 = await agent.post('/api/reservations').send({ slotId: 99999, partySize: 2, hiker: { userId: 3 } });
      expect(res1.status).toBe(404);
      expect(res1.body.error).toBe('SLOT_NOT_FOUND');

      // Hiker does not exist
      const res2 = await agent.post('/api/reservations').send({ slotId: 4, partySize: 2, hiker: { userId: 99999 } });
      expect(res2.status).toBe(404);
      expect(res2.body.error).toBe('HIKER_NOT_FOUND');

      // The user is not a hiker (the employee itself)
      const res3 = await agent.post('/api/reservations').send({ slotId: 4, partySize: 2, hiker: { userId: 2 } });
      expect(res3.status).toBe(404);
      expect(res3.body.error).toBe('HIKER_NOT_FOUND');
    });

    it('returns 409 EMAIL_ALREADY_USED when an employee registers a hiker with an existing email', async () => {
      const login = await agent.post('/api/sessions').send({
        email: 'employee@mountainhut.test',
        password: 'password',
      });
      expect(login.status).toBe(201);

      const res = await agent.post('/api/reservations').send({
        slotId: 4,
        partySize: 2,
        hiker: { name: 'Anna Again', email: 'anna@mountainhut.test', phone: '3330000000', password: 'password123' },
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('EMAIL_ALREADY_USED');
    });

    it('returns 409 NO_AVAILABILITY when the party does not fit, and does not register the new hiker', async () => {
      const login = await agent.post('/api/sessions').send({
        email: 'employee@mountainhut.test',
        password: 'password',
      });
      expect(login.status).toBe(201);

      // Create a new slot with tables T1, T2, T3 (14 seats)
      const start = new Date();
      start.setDate(start.getDate() + 63);
      start.setHours(12, 0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const slotRes = await agent.post('/api/slots').send({ startAt: start.toISOString(), endAt: end.toISOString() });
      expect(slotRes.status).toBe(201);
      const slotId = slotRes.body.slotId;
      expect((await agent.post(`/api/slots/${slotId}/tables`).send({ tableIds: [1, 2, 3] })).status).toBe(201);

      const unique = Date.now();
      const hikerData = {
        name: 'Too Many',
        email: `toomany.${unique}@example.com`,
        phone: '3330000000',
        password: 'password123',
      };

      const res = await agent.post('/api/reservations').send({ slotId, partySize: 15, hiker: hikerData });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('NO_AVAILABILITY');

      // The reservation failed, so the account was not created
      const search = await agent.get('/api/hikers').query({ search: hikerData.email });
      expect(search.status).toBe(200);
      expect(search.body).toEqual([]);
    });

    it('lets an employee book less than 2 hours before the slot, unlike a hiker', async () => {
      const unique = Date.now();
      const hikerData = {
        name: 'Luca Bianchi',
        email: `late.${unique}@example.com`,
        phone: '3339998877',
        password: 'password123',
      };
      const hikerAgent = request.agent(BACKEND_URL);
      const regRes = await hikerAgent.post('/api/users').send(hikerData);
      expect(regRes.status).toBe(201);

      const login = await agent.post('/api/sessions').send({
        email: 'employee@mountainhut.test',
        password: 'password',
      });
      expect(login.status).toBe(201);

      // Create a slot that starts in 30 minutes
      const start = new Date(Date.now() + 30 * 60 * 1000);
      const end = new Date(Date.now() + 60 * 60 * 1000);
      const slotRes = await agent.post('/api/slots').send({ startAt: start.toISOString(), endAt: end.toISOString() });
      expect(slotRes.status).toBe(201);
      const slotId = slotRes.body.slotId;
      expect((await agent.post(`/api/slots/${slotId}/tables`).send({ tableIds: [1, 2, 3] })).status).toBe(201);

      // The hiker cannot book by themselves
      const byHiker = await hikerAgent.post('/api/reservations').send({ slotId, partySize: 2 });
      expect(byHiker.status).toBe(409);
      expect(byHiker.body.error).toBe('BOOKING_TOO_LATE');

      // The employee can book for them
      const byEmployee = await agent.post('/api/reservations').send({
        slotId,
        partySize: 2,
        hiker: { userId: regRes.body.user_id },
      });
      expect(byEmployee.status).toBe(201);
    });

    it('returns 409 BOOKING_TOO_LATE when the slot has already started', async () => {
      const login = await agent.post('/api/sessions').send({
        email: 'employee@mountainhut.test',
        password: 'password',
      });
      expect(login.status).toBe(201);

      // A slot can only be created in the future: create one that starts in 2 seconds and wait
      const start = new Date(Date.now() + 2000);
      const end = new Date(Date.now() + 5 * 60 * 1000);
      const slotRes = await agent.post('/api/slots').send({ startAt: start.toISOString(), endAt: end.toISOString() });
      expect(slotRes.status).toBe(201);
      const slotId = slotRes.body.slotId;
      expect((await agent.post(`/api/slots/${slotId}/tables`).send({ tableIds: [1, 2, 3] })).status).toBe(201);

      await new Promise((resolve) => setTimeout(resolve, 3000));

      const res = await agent.post('/api/reservations').send({ slotId, partySize: 2, hiker: { name: 'Too Late' } });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('BOOKING_TOO_LATE');
    });
  });


  describe("GET /api/hikers?search=text", () => {

    it('finds and hiker if his name is searched', async () => {
      const login = await agent.post('/api/sessions').send({
        email: 'employee@mountainhut.test',
        password: 'password',
      });

      const res = await agent.get("/api/hikers?search=Anna")
      expect(res.status).toBe(200);
      const user = res.body
      expect(user[0]).toHaveProperty("userId")
        .toHaveProperty("name", "Anna Winden")
        .toHaveProperty("email", "anna@mountainhut.test")
        .toHaveProperty("phone")

    })

    it('finds and hiker if his name is email', async () => {
      const login = await agent.post('/api/sessions').send({
        email: 'employee@mountainhut.test',
        password: 'password',
      });

      const res = await agent.get("/api/hikers?search=anna@")
      expect(res.status).toBe(200);
      const user = res.body
      expect(user[0]).toHaveProperty("userId")
        .toHaveProperty("name", "Anna Winden")
        .toHaveProperty("email", "anna@mountainhut.test")
        .toHaveProperty("phone")

    })

    it('finds and hiker if his phone number is searched', async () => {
      const login = await agent.post('/api/sessions').send({
        email: 'employee@mountainhut.test',
        password: 'password',
      });

      const res = await agent.get("/api/hikers?search=+3934")
      expect(res.status).toBe(200);
      const user = res.body
      expect(user[0]).toHaveProperty("userId")
        .toHaveProperty("name", "Anna Winden")
        .toHaveProperty("email", "anna@mountainhut.test")
        .toHaveProperty("phone")

    })

    it('finds no matches and gives back an empty array', async () => {
      const login = await agent.post('/api/sessions').send({
        email: 'employee@mountainhut.test',
        password: 'password',
      });

      const res = await agent.get("/api/hikers?search=wetenbewer")
      expect(res.status).toBe(200);
      const user = res.body
      expect(user).toEqual([])
    })

    it('returns 401 if the employee is not authenticated', async () => {
      const res = await agent.get("/api/hikers?search=anna@")
      expect(res.status).toBe(401);
    })

    it('returns 403 if a hiker tries to call the function', async () => {
      const login = await agent.post('/api/sessions').send({
        email: 'anna@mountainhut.test',
        password: 'password',
      });

      const res = await agent.get("/api/hikers?search=anna@")
      expect(res.status).toBe(403);
    })

    it("returns 400 if the input is invalid", async () => {
      const login = await agent.post('/api/sessions').send({
        email: 'employee@mountainhut.test',
        password: 'password',
      });

      const res1 = await agent.get("/api/hikers")
      expect(res1.status).toBe(400);

      const res2 = await agent.get("/api/hikers?search=")
      expect(res2.status).toBe(400);

      const res3 = await agent.get("/api/hikers?search=%20%20")
      expect(res3.status).toBe(400);

      const res4 = await agent.get("/api/hikers?search=a&search=b")
      expect(res4.status).toBe(400);

    })
  })

});


