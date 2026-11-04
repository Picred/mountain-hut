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

let counter = 0;

// ISO timestamp far enough in the future to avoid any overlap with demo slots
function at(dayOffset, hours, minutes = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

async function loginAs(email, password = 'password') {
  const agent = request.agent(BACKEND_URL);
  const res = await agent.post('/api/sessions').send({ email, password });
  expect(res.status).toBe(201);
  return agent;
}

const loginEmployee = () => loginAs('employee@mountainhut.test');
const loginAnna = () => loginAs('anna@mountainhut.test');
const loginBruno = () => loginAs('bruno@mountainhut.test');

async function newHiker() {
  counter += 1;
  const agent = request.agent(BACKEND_URL);
  const res = await agent.post('/api/users').send({
    name: `Hiker MH06 ${counter}`,
    email: `hiker.mh06.${Date.now()}.${counter}@example.com`,
    phone: '3331112233',
    password: 'password123',
  });
  expect(res.status).toBe(201);
  return agent;
}

async function newSlot(tableIds = [T1, T2, T3], dayOffset = 60) {
  counter += 1;
  const employee = await loginEmployee();
  const created = await employee.post('/api/slots').send({
    startAt: at(dayOffset + counter, 12),
    endAt: at(dayOffset + counter, 13),
  });
  expect(created.status).toBe(201);
  const { slotId } = created.body;
  const assigned = await employee.post(`/api/slots/${slotId}/tables`).send({ tableIds });
  expect(assigned.status).toBe(201);
  return slotId;
}

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

beforeAll(async () => {
  execFileSync('node', ['db/init-db.js', '--reset'], { cwd: new URL('../../../backend', import.meta.url) });
  try {
    await import('../../../backend/index.js');
  } catch (err) {
    // If backend was already imported/started in another test file
  }
  await waitForServer();
});

describe('Change a booking e2e', () => {
  describe('Authentication and Authorization', () => {
    it('returns 401 UNAUTHORIZED when no user is authenticated', async () => {
      const anonymous = request(BACKEND_URL);
      const res = await anonymous.patch('/api/reservations/2').send({ partySize: 3 });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('returns 403 FORBIDDEN when attempting to modify a reservation of another hiker', async () => {
      // Reservation 2 belongs to Bruno (userId: 4)
      const anna = await loginAnna(); // Anna has userId: 3
      const res = await anna.patch('/api/reservations/2').send({ partySize: 3 });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });
  });

  describe('Input validation (400 INVALID_INPUT)', () => {
    it('returns 400 when reservationId in path is not a positive integer', async () => {
      const hiker = await newHiker();

      const res1 = await hiker.patch('/api/reservations/notanumber').send({ partySize: 2 });
      expect(res1.status).toBe(400);
      expect(res1.body.error).toBe('INVALID_INPUT');

      const res2 = await hiker.patch('/api/reservations/0').send({ partySize: 2 });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toBe('INVALID_INPUT');

      const res3 = await hiker.patch('/api/reservations/-5').send({ partySize: 2 });
      expect(res3.status).toBe(400);
      expect(res3.body.error).toBe('INVALID_INPUT');
    });

    it('returns 400 when the request body contains no fields', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();
      const booking = (await hiker.post('/api/reservations').send({ slotId, partySize: 2 })).body;

      const res = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_INPUT');
    });

    it('returns 400 when slotId is invalid', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();
      const booking = (await hiker.post('/api/reservations').send({ slotId, partySize: 2 })).body;

      for (const invalidSlotId of ['abc', 0, -2, 1.5]) {
        const res = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
          slotId: invalidSlotId,
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('INVALID_INPUT');
      }
    });

    it('returns 400 when partySize is invalid', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();
      const booking = (await hiker.post('/api/reservations').send({ slotId, partySize: 2 })).body;

      for (const invalidPartySize of [0, -3, 'four', 2.5]) {
        const res = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
          partySize: invalidPartySize,
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('INVALID_INPUT');
      }
    });

    it('returns 400 when requirements structure is invalid', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();
      const booking = (await hiker.post('/api/reservations').send({ slotId, partySize: 2 })).body;

      // requirements must be an object, not array or primitive
      const res1 = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: 'invalid',
      });
      expect(res1.status).toBe(400);
      expect(res1.body.error).toBe('INVALID_INPUT');

      const res2 = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: [{ peopleCount: 1, description: 'vegan', isAllergy: false }],
      });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toBe('INVALID_INPUT');

      // add, update, remove must be arrays if provided
      const res3 = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: { add: 'not-array' },
      });
      expect(res3.status).toBe(400);
      expect(res3.body.error).toBe('INVALID_INPUT');

      const res4 = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: { update: 123 },
      });
      expect(res4.status).toBe(400);
      expect(res4.body.error).toBe('INVALID_INPUT');

      const res5 = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: { remove: 'id-not-array' },
      });
      expect(res5.status).toBe(400);
      expect(res5.body.error).toBe('INVALID_INPUT');
    });

    it('returns 400 when requirement items are malformed', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();
      const booking = (await hiker.post('/api/reservations').send({
        slotId,
        partySize: 3,
      })).body;

      // Add a requirement via PATCH so we get its real requirement id
      const withReq = (await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: {
          add: [{ peopleCount: 1, description: 'vegan', isAllergy: false }],
        },
      })).body;
      expect(withReq.requirements).toHaveLength(1);
      const reqId = withReq.requirements[0].id;
      expect(Number.isInteger(reqId)).toBe(true);

      // add: missing/invalid peopleCount
      const res1 = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: { add: [{ peopleCount: 0, description: 'celiac', isAllergy: true }] },
      });
      expect(res1.status).toBe(400);
      expect(res1.body.error).toBe('INVALID_INPUT');

      // add: empty description
      const res2 = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: { add: [{ peopleCount: 1, description: '   ', isAllergy: true }] },
      });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toBe('INVALID_INPUT');

      // add: isAllergy not boolean
      const res3 = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: { add: [{ peopleCount: 1, description: 'celiac', isAllergy: 'yes' }] },
      });
      expect(res3.status).toBe(400);
      expect(res3.body.error).toBe('INVALID_INPUT');

      // update: missing requirement id
      const res4 = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: { update: [{ peopleCount: 1, description: 'celiac', isAllergy: true }] },
      });
      expect(res4.status).toBe(400);
      expect(res4.body.error).toBe('INVALID_INPUT');

      // remove: id is not positive integer
      const res5 = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: { remove: [-1] },
      });
      expect(res5.status).toBe(400);
      expect(res5.body.error).toBe('INVALID_INPUT');

      // duplicate ids in update
      const res6 = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: {
          update: [
            { id: reqId, peopleCount: 1, description: 'v1', isAllergy: false },
            { id: reqId, peopleCount: 1, description: 'v2', isAllergy: false },
          ],
        },
      });
      expect(res6.status).toBe(400);
      expect(res6.body.error).toBe('INVALID_INPUT');

      // duplicate ids in remove
      const res7 = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: { remove: [reqId, reqId] },
      });
      expect(res7.status).toBe(400);
      expect(res7.body.error).toBe('INVALID_INPUT');

      // same id in both update and remove
      const res8 = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: {
          update: [{ id: reqId, peopleCount: 1, description: 'v1', isAllergy: false }],
          remove: [reqId],
        },
      });
      expect(res8.status).toBe(400);
      expect(res8.body.error).toBe('INVALID_INPUT');
    });

    it('returns 400 when resulting requirements count exceeds partySize', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();
      const booking = (await hiker.post('/api/reservations').send({ slotId, partySize: 2 })).body;

      // partySize is 2, but adding requirements for 3 people
      const res = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: {
          add: [{ peopleCount: 3, description: 'vegetarians', isAllergy: false }],
        },
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_INPUT');
    });
  });

  describe('Not Found Errors (404)', () => {
    it('returns 404 RESERVATION_NOT_FOUND when reservation does not exist', async () => {
      const hiker = await newHiker();
      const res = await hiker.patch('/api/reservations/99999').send({ partySize: 3 });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('RESERVATION_NOT_FOUND');
    });

    it('returns 404 SLOT_NOT_FOUND when target slotId does not exist', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();
      const booking = (await hiker.post('/api/reservations').send({ slotId, partySize: 2 })).body;

      const res = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        slotId: 99999,
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('SLOT_NOT_FOUND');
    });

    it('returns 404 REQUIREMENT_NOT_FOUND when requirement ID does not belong to reservation', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();
      const booking = (await hiker.post('/api/reservations').send({ slotId, partySize: 2 })).body;

      // Non-existent requirement id in update
      const res1 = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: {
          update: [{ id: 99999, peopleCount: 1, description: 'vegan', isAllergy: false }],
        },
      });
      expect(res1.status).toBe(404);
      expect(res1.body.error).toBe('REQUIREMENT_NOT_FOUND');

      // Non-existent requirement id in remove
      const res2 = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        requirements: { remove: [99999] },
      });
      expect(res2.status).toBe(404);
      expect(res2.body.error).toBe('REQUIREMENT_NOT_FOUND');
    });
  });

  describe('Business Rules and Conflicts (409)', () => {
    it('returns 409 RESERVATION_NOT_EDITABLE when reservation is cancelled', async () => {
      // Demo reservation 7 belongs to Bruno (userId: 4) and has status 'cancelled'
      const bruno = await loginBruno();
      const res = await bruno.patch('/api/reservations/7').send({ partySize: 3 });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('RESERVATION_NOT_EDITABLE');
    });

    it('returns 409 EDIT_WINDOW_EXPIRED when booking was made more than 48 hours ago', async () => {
      // Demo reservation 1 belongs to Anna (userId: 3) and was created 72 hours ago
      const anna = await loginAnna();
      const res = await anna.patch('/api/reservations/1').send({ partySize: 3 });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('EDIT_WINDOW_EXPIRED');
    });

    it('returns 409 BOOKING_TOO_LATE when changing to a slot that starts in less than 2 hours', async () => {
      const employee = await loginEmployee();
      const hiker = await newHiker();

      // Create a valid initial booking far in the future
      const futureSlot = await newSlot([T1, T2]);
      const booking = (await hiker.post('/api/reservations').send({
        slotId: futureSlot,
        partySize: 2,
      })).body;

      // Employee creates a slot starting in 1 hour
      const tooCloseSlot = (await employee.post('/api/slots').send({
        startAt: hoursFromNow(1),
        endAt: hoursFromNow(2),
      })).body.slotId;
      await employee.post(`/api/slots/${tooCloseSlot}/tables`).send({ tableIds: [T1] });

      const res = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        slotId: tooCloseSlot,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('BOOKING_TOO_LATE');
    });

    it('returns 409 NO_AVAILABILITY when increasing partySize beyond slot capacity', async () => {
      const hiker = await newHiker();
      // Slot with only T4 (2 seats)
      const slotId = await newSlot([T4]);

      const booking = (await hiker.post('/api/reservations').send({
        slotId,
        partySize: 2,
      })).body;

      // Try to increase party size to 3 on a slot that only has 2 seats total
      const res = await hiker.patch(`/api/reservations/${booking.reservationId}`).send({
        partySize: 3,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('NO_AVAILABILITY');
    });

    it('returns 409 ALREADY_BOOKED when hiker already has another booking for the target slot', async () => {
      const hiker = await newHiker();
      const slotA = await newSlot([T1, T2]);
      const slotB = await newSlot([T1, T2]);

      // Hiker books both slot A and slot B
      const bookingA = (await hiker.post('/api/reservations').send({ slotId: slotA, partySize: 2 })).body;
      await hiker.post('/api/reservations').send({ slotId: slotB, partySize: 2 });

      // Hiker tries to move booking A to slot B, which they already have a booking for
      const res = await hiker.patch(`/api/reservations/${bookingA.reservationId}`).send({
        slotId: slotB,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('ALREADY_BOOKED');
    });
  });

  describe('Successful Updates (200 OK)', () => {
    it('changes date and time (slotId) and recalculates table allocation atomically', async () => {
      const anonymous = request(BACKEND_URL);
      const hiker = await newHiker();

      const slotA = await newSlot([T1]); // 4 seats on T1
      const slotB = await newSlot([T2]); // 4 seats on T2

      // Book 3 seats in slot A
      const initialBooking = (await hiker.post('/api/reservations').send({
        slotId: slotA,
        partySize: 3,
      })).body;

      expect(initialBooking.slotId).toBe(slotA);
      expect(initialBooking.tableAllocation[0].tableId).toBe(T1);

      // Verify slot A has only 1 seat left and slot B has 4 seats left
      const availA1 = await anonymous.get(`/api/slots/${slotA}/availability?partySize=2`);
      expect(availA1.body.available).toBe(false);

      const availB1 = await anonymous.get(`/api/slots/${slotB}/availability?partySize=4`);
      expect(availB1.body.available).toBe(true);

      // Move booking from slot A to slot B
      const updateRes = await hiker.patch(`/api/reservations/${initialBooking.reservationId}`).send({
        slotId: slotB,
      });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.reservationId).toBe(initialBooking.reservationId);
      expect(updateRes.body.slotId).toBe(slotB);
      expect(updateRes.body.partySize).toBe(3);
      expect(updateRes.body.status).toBe('confirmed');
      expect(updateRes.body.tableAllocation).toEqual([
        { tableId: T2, tableCode: 'T2', allocatedSeats: 3 },
      ]);

      // Verify slot A now has 4 seats free again (released)
      const availA2 = await anonymous.get(`/api/slots/${slotA}/availability?partySize=4`);
      expect(availA2.body.available).toBe(true);

      // Verify slot B now only has 1 seat free (4 - 3 = 1)
      const availB2 = await anonymous.get(`/api/slots/${slotB}/availability?partySize=2`);
      expect(availB2.body.available).toBe(false);
    });

    it('increases party size and updates table allocation', async () => {
      const hiker = await newHiker();
      // Slot with T4 (2 seats) and T1 (4 seats) = 6 seats total
      const slotId = await newSlot([T4, T1]);

      const initialBooking = (await hiker.post('/api/reservations').send({
        slotId,
        partySize: 2,
      })).body;

      // Increase party size from 2 to 4
      const updateRes = await hiker.patch(`/api/reservations/${initialBooking.reservationId}`).send({
        partySize: 4,
      });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.partySize).toBe(4);
      expect(updateRes.body.slotId).toBe(slotId);
      const totalAllocated = updateRes.body.tableAllocation.reduce((sum, t) => sum + t.allocatedSeats, 0);
      expect(totalAllocated).toBe(4);
    });

    it('decreases party size and releases the freed seats', async () => {
      const anonymous = request(BACKEND_URL);
      const hiker = await newHiker();
      // Slot with T1 (4 seats)
      const slotId = await newSlot([T1]);

      const initialBooking = (await hiker.post('/api/reservations').send({
        slotId,
        partySize: 4,
      })).body;

      // Initially no seats are free on this slot
      const beforeAvail = await anonymous.get(`/api/slots/${slotId}/availability?partySize=1`);
      expect(beforeAvail.body.available).toBe(false);

      // Reduce party size to 2
      const updateRes = await hiker.patch(`/api/reservations/${initialBooking.reservationId}`).send({
        partySize: 2,
      });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.partySize).toBe(2);
      expect(updateRes.body.tableAllocation).toEqual([
        { tableId: T1, tableCode: 'T1', allocatedSeats: 2 },
      ]);

      // 2 seats are now free for another customer
      const afterAvail = await anonymous.get(`/api/slots/${slotId}/availability?partySize=2`);
      expect(afterAvail.body.available).toBe(true);
    });

    it('adds, updates, and removes dietary requirements in a single request', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();

      // Create a booking with 4 seats
      const initialBooking = (await hiker.post('/api/reservations').send({
        slotId,
        partySize: 4,
      })).body;

      // Add 2 initial requirements via PATCH so they have valid requirement IDs
      const withReq = (await hiker.patch(`/api/reservations/${initialBooking.reservationId}`).send({
        requirements: {
          add: [
            { peopleCount: 1, description: 'vegetarian', isAllergy: false },
            { peopleCount: 1, description: 'nut allergy', isAllergy: true },
          ],
        },
      })).body;

      expect(withReq.requirements).toHaveLength(2);
      const vegId = withReq.requirements[0].id;
      const nutId = withReq.requirements[1].id;

      // Update: change vegetarian to 2 people, remove nut allergy, add celiac
      const updateRes = await hiker.patch(`/api/reservations/${initialBooking.reservationId}`).send({
        requirements: {
          add: [
            { peopleCount: 1, description: 'celiac', isAllergy: true },
          ],
          update: [
            { id: vegId, peopleCount: 2, description: '2 vegetarians', isAllergy: false },
          ],
          remove: [nutId],
        },
      });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.requirements).toHaveLength(2);

      const updatedVeg = updateRes.body.requirements.find((r) => r.id === vegId);
      expect(updatedVeg).toEqual({
        id: vegId,
        peopleCount: 2,
        description: '2 vegetarians',
        isAllergy: false,
      });

      const removedNut = updateRes.body.requirements.find((r) => r.id === nutId);
      expect(removedNut).toBeUndefined();

      const addedCeliac = updateRes.body.requirements.find((r) => r.description === 'celiac');
      expect(addedCeliac).toMatchObject({
        peopleCount: 1,
        description: 'celiac',
        isAllergy: true,
      });
    });

    it('changes slot, party size, and requirements together in one atomic request', async () => {
      const hiker = await newHiker();
      const slot1 = await newSlot([T1, T2]);
      const slot2 = await newSlot([T1, T3]);

      const initialBooking = (await hiker.post('/api/reservations').send({
        slotId: slot1,
        partySize: 3,
      })).body;

      // Add initial requirement via PATCH
      const withReq = (await hiker.patch(`/api/reservations/${initialBooking.reservationId}`).send({
        requirements: {
          add: [
            { peopleCount: 1, description: 'lactose intolerance', isAllergy: false },
          ],
        },
      })).body;

      const reqId = withReq.requirements[0].id;

      const updateRes = await hiker.patch(`/api/reservations/${initialBooking.reservationId}`).send({
        slotId: slot2,
        partySize: 5,
        requirements: {
          update: [
            { id: reqId, peopleCount: 2, description: '2 lactose intolerance', isAllergy: false },
          ],
          add: [
            { peopleCount: 1, description: 'peanut allergy', isAllergy: true },
          ],
        },
      });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.slotId).toBe(slot2);
      expect(updateRes.body.partySize).toBe(5);
      expect(updateRes.body.requirements).toHaveLength(2);
      const totalSeats = updateRes.body.tableAllocation.reduce((s, t) => s + t.allocatedSeats, 0);
      expect(totalSeats).toBe(5);
    });
  });

  describe('Atomicity & Rollback on failure', () => {
    it('preserves existing reservation and seats when an update is rejected', async () => {
      const anonymous = request(BACKEND_URL);
      const hiker = await newHiker();

      const slotA = await newSlot([T4]); // 2 seats total on T4
      const slotB = await newSlot([T4]); // 2 seats total on T4

      const initialBooking = (await hiker.post('/api/reservations').send({
        slotId: slotA,
        partySize: 2,
      })).body;

      // Add a requirement via PATCH
      const withReq = (await hiker.patch(`/api/reservations/${initialBooking.reservationId}`).send({
        requirements: {
          add: [
            { peopleCount: 1, description: 'vegetarian', isAllergy: false },
          ],
        },
      })).body;

      const reqId = withReq.requirements[0].id;

      // Attempt to move to slotB with partySize 6 (exceeds slotB capacity -> NO_AVAILABILITY)
      const failedRes = await hiker.patch(`/api/reservations/${initialBooking.reservationId}`).send({
        slotId: slotB,
        partySize: 6,
        requirements: {
          remove: [reqId],
        },
      });

      expect(failedRes.status).toBe(409);
      expect(failedRes.body.error).toBe('NO_AVAILABILITY');

      // Verify that slot A is STILL occupied by the original booking (2 seats)
      const availA = await anonymous.get(`/api/slots/${slotA}/availability?partySize=1`);
      expect(availA.body.available).toBe(false);

      // Verify that a valid change can still be performed and the original requirement is still there
      const validRes = await hiker.patch(`/api/reservations/${initialBooking.reservationId}`).send({
        requirements: {
          update: [
            { id: reqId, peopleCount: 1, description: 'strict vegetarian', isAllergy: false },
          ],
        },
      });

      expect(validRes.status).toBe(200);
      expect(validRes.body.slotId).toBe(slotA);
      expect(validRes.body.partySize).toBe(2);
      expect(validRes.body.requirements[0].description).toBe('strict vegetarian');
    });
  });
});
