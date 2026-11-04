import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll } from 'vitest';

const BACKEND_URL = 'http://localhost:3002'; // PORT, see backend/vitest.config.js

// Demo tables (backend/db/init-db.js)
const T1 = 1; // 4 seats
const T2 = 2; // 4 seats
const T3 = 3; // 6 seats
const T4 = 4; // 2 seats

// Database connection of the backend (same file, DB_PATH, see backend/vitest.config.js).
// It is loaded in beforeAll, after the database has been recreated.
let db;

// Recreate the e2e database from the demo data, then start the backend
beforeAll(async () => {
  execFileSync('node', ['db/init-db.js', '--reset'], { cwd: new URL('../../../backend', import.meta.url) });
  try {
    await import('../../../backend/index.js');
  } catch (err) {
    // The backend may already be running (started by another test file)
  }
  db = (await import('../../../backend/db/db.js')).default;
});



// helpers
const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

// Requirements stored in the database for a reservation, in insertion order
const storedRequirements = (reservationId) =>
  dbAll(
    `SELECT people_count AS peopleCount, description, is_allergy AS isAllergy
     FROM reservation_requirements WHERE reservation_id = ? ORDER BY id`,
    [reservationId]
  );

const countReservationsInSlot = async (slotId) =>
  (await dbAll('SELECT COUNT(*) AS n FROM reservations WHERE slot_id = ?', [slotId]))[0].n;

const countAllRequirements = async () =>
  (await dbAll('SELECT COUNT(*) AS n FROM reservation_requirements'))[0].n;

// ISO timestamp of a local time, far enough in the future not to overlap the demo slots
function at(dayOffset, hours, minutes = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

let counter = 0;

// A new hiker, registered and logged in (registration opens the session, see authentication.test.js)
async function newHiker() {
  counter += 1;
  const agent = request.agent(BACKEND_URL);
  const res = await agent.post('/api/users').send({
    name: `Requirements Hiker ${counter}`,
    email: `requirements.${Date.now()}.${counter}@example.com`,
    phone: '3331112233',
    password: 'password123',
  });
  expect(res.status).toBe(201);
  return agent;
}

async function loginEmployee() {
  const agent = request.agent(BACKEND_URL);
  const res = await agent.post('/api/sessions').send({ email: 'employee@mountainhut.test', password: 'password' });
  expect(res.status).toBe(201);
  return agent;
}

// A new empty slot far in the future with the given tables: every test uses its own slot,
// so tests do not depend on the demo reservations or on each other
async function newSlot(tableIds = [T1, T2, T3]) {
  counter += 1;
  const employee = await loginEmployee();
  const created = await employee.post('/api/slots').send({ startAt: at(100 + counter, 12), endAt: at(100 + counter, 13) });
  expect(created.status).toBe(201);
  const { slotId } = created.body;
  const assigned = await employee.post(`/api/slots/${slotId}/tables`).send({ tableIds });
  expect(assigned.status).toBe(201);
  return slotId;
}

const seatsOf = (tableAllocation) => tableAllocation.reduce((sum, t) => sum + t.allocatedSeats, 0);

// Requirements used in the story clarifications
const VEGAN_PEANUT = { peopleCount: 1, description: '1 vegan, peanut allergy', isAllergy: true };
const SHELLFISH = { peopleCount: 1, description: '1 shellfish allergy', isAllergy: true };
const VEGETARIANS = { peopleCount: 2, description: '2 vegetarians', isAllergy: false };




//tests
describe('MH-05 Provide party requirements e2e', () => {
  describe('Entering the requirements while booking', () => {
    it('saves the three requirements of the story example, each with its own allergy flag and description', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();

      const res = await hiker.post('/api/reservations').send({
        slotId,
        partySize: 4,
        requirements: [VEGAN_PEANUT, SHELLFISH, VEGETARIANS],
      });

      expect(res.status).toBe(201);

      // The booking confirmation reports the three requirements, in the order entered
      expect(res.body.requirements, 'the booking response must list the requirements').toEqual([
        VEGAN_PEANUT, SHELLFISH, VEGETARIANS,
      ]);

      // ... and they are really saved, linked to this booking
      const stored = await storedRequirements(res.body.reservationId);
      expect(stored, 'three requirements must be saved for the booking').toEqual([
        { peopleCount: 1, description: '1 vegan, peanut allergy', isAllergy: 1 },
        { peopleCount: 1, description: '1 shellfish allergy', isAllergy: 1 },
        { peopleCount: 2, description: '2 vegetarians', isAllergy: 0 },
      ]);
    });

    it('keeps the allergy flag of each requirement separate (no flag is shared or swapped)', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();

      const requirements = [
        { peopleCount: 1, description: 'vegetarian', isAllergy: false },
        { peopleCount: 1, description: 'celiac', isAllergy: true },
        { peopleCount: 1, description: 'no pork', isAllergy: false },
        { peopleCount: 1, description: 'nut allergy', isAllergy: true },
      ];

      const res = await hiker.post('/api/reservations').send({ slotId, partySize: 4, requirements });
      expect(res.status).toBe(201);

      const stored = await storedRequirements(res.body.reservationId);
      expect(stored.map((r) => [r.description, r.isAllergy])).toEqual([
        ['vegetarian', 0],
        ['celiac', 1],
        ['no pork', 0],
        ['nut allergy', 1],
      ]);
      expect(res.body.requirements.map((r) => r.isAllergy)).toEqual([false, true, false, true]);
    });

    it('accepts a requirement for a subset of the party and one for the whole party', async () => {
      const slotId = await newSlot();

      // 2 people out of 5
      const subset = await (await newHiker()).post('/api/reservations').send({
        slotId,
        partySize: 5,
        requirements: [{ peopleCount: 2, description: 'vegan', isAllergy: false }],
      });
      expect(subset.status).toBe(201);
      expect(await storedRequirements(subset.body.reservationId)).toHaveLength(1);

      // Everybody (3 out of 3) in a single requirement
      const everybody = await (await newHiker()).post('/api/reservations').send({
        slotId,
        partySize: 3,
        requirements: [{ peopleCount: 3, description: 'gluten free', isAllergy: true }],
      });
      expect(everybody.status).toBe(201);
      expect(await storedRequirements(everybody.body.reservationId)).toHaveLength(1);
    });

    it('accepts requirements that cover exactly the whole party split in several requirements', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();

      const res = await hiker.post('/api/reservations').send({
        slotId,
        partySize: 3,
        requirements: [
          { peopleCount: 1, description: 'vegan', isAllergy: false },
          { peopleCount: 2, description: 'lactose free', isAllergy: true },
        ],
      });

      expect(res.status).toBe(201);
      expect(await storedRequirements(res.body.reservationId)).toHaveLength(2);
    });

    it('saves 0 (false) for a requirement whose allergy checkbox is not selected', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();

      const res = await hiker.post('/api/reservations').send({
        slotId,
        partySize: 2,
        requirements: [{ peopleCount: 2, description: '2 vegetarians', isAllergy: false }],
      });

      expect(res.status).toBe(201);
      expect(res.body.requirements).toEqual([{ peopleCount: 2, description: '2 vegetarians', isAllergy: false }]);
      expect(await storedRequirements(res.body.reservationId)).toEqual([
        { peopleCount: 2, description: '2 vegetarians', isAllergy: 0 },
      ]);
    });

    it('saves the description without leading and trailing spaces', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();

      const res = await hiker.post('/api/reservations').send({
        slotId,
        partySize: 2,
        requirements: [{ peopleCount: 1, description: '   1 vegan, peanut allergy \n', isAllergy: true }],
      });

      expect(res.status).toBe(201);
      expect(res.body.requirements[0].description, 'the response must show the saved description').toBe('1 vegan, peanut allergy');
      expect((await storedRequirements(res.body.reservationId))[0].description, 'the database must not keep the extra spaces')
        .toBe('1 vegan, peanut allergy');
    });

    it('stores the description exactly as written (accents, quotes, emoji and SQL-like text)', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();
      const description = `senza glutine, "noci" & nocciole – Robert'); DROP TABLE reservations;-- 🥜`;

      const res = await hiker.post('/api/reservations').send({
        slotId,
        partySize: 2,
        requirements: [{ peopleCount: 1, description, isAllergy: true }],
      });

      expect(res.status).toBe(201);
      expect(res.body.requirements[0].description).toBe(description);
      expect((await storedRequirements(res.body.reservationId))[0].description).toBe(description);
      // The reservations table is still there
      expect(await countReservationsInSlot(slotId)).toBe(1);
    });
  });

  describe('Requirements are optional', () => {
    it('books without requirements and saves none', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();

      const res = await hiker.post('/api/reservations').send({ slotId, partySize: 2 });

      expect(res.status).toBe(201);
      expect(await storedRequirements(res.body.reservationId)).toEqual([]);
    });

    it('books with an empty list of requirements and saves none', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();

      const res = await hiker.post('/api/reservations').send({ slotId, partySize: 2, requirements: [] });

      expect(res.status).toBe(201);
      expect(await storedRequirements(res.body.reservationId)).toEqual([]);
    });
  });

  describe('Requirements do not change the table allocation', () => {
    it('seats the party exactly as the availability check says, with or without requirements', async () => {
      const slotId = await newSlot([T1, T4]); // 4 + 2 seats
      const anonymous = request(BACKEND_URL);

      const check = await anonymous.get(`/api/slots/${slotId}/availability?partySize=5`);
      expect(check.status).toBe(200);
      expect(check.body.available).toBe(true);

      const res = await (await newHiker()).post('/api/reservations').send({
        slotId,
        partySize: 5,
        requirements: [VEGAN_PEANUT, VEGETARIANS],
      });

      expect(res.status).toBe(201);
      expect(res.body.tableAllocation).toEqual(check.body.tableAllocation);
      expect(seatsOf(res.body.tableAllocation)).toBe(5);
    });
  });

  describe('Requirements belong to their own booking', () => {
    it('does not mix the requirements of two hikers booking the same slot', async () => {
      const slotId = await newSlot();

      const first = await (await newHiker()).post('/api/reservations').send({
        slotId, partySize: 2, requirements: [{ peopleCount: 1, description: 'first hiker: vegan', isAllergy: false }],
      });
      const second = await (await newHiker()).post('/api/reservations').send({
        slotId, partySize: 3, requirements: [
          { peopleCount: 1, description: 'second hiker: peanuts', isAllergy: true },
          { peopleCount: 2, description: 'second hiker: vegetarians', isAllergy: false },
        ],
      });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect((await storedRequirements(first.body.reservationId)).map((r) => r.description))
        .toEqual(['first hiker: vegan']);
      expect((await storedRequirements(second.body.reservationId)).map((r) => r.description))
        .toEqual(['second hiker: peanuts', 'second hiker: vegetarians']);
    });
  });

  describe('Invalid requirements are rejected and nothing is saved', () => {
    const valid = { peopleCount: 1, description: 'vegan', isAllergy: false };

    const invalidRequirements = [
      ['requirements is an object instead of a list', { description: 'vegan' }],
      ['requirements is a string', 'vegan'],
      ['requirements is null', null],
      ['a requirement is null', [null]],
      ['a requirement is a string', ['vegan']],
      ['description is missing', [{ peopleCount: 1, isAllergy: false }]],
      ['description is empty', [{ ...valid, description: '' }]],
      ['description is only spaces', [{ ...valid, description: '    ' }]],
      ['description is not a text', [{ ...valid, description: 42 }]],
      ['description is null', [{ ...valid, description: null }]],
      ['allergy flag is a text', [{ ...valid, isAllergy: 'yes' }]],
      ['allergy flag is null', [{ ...valid, isAllergy: null }]],
      ['people count is zero', [{ ...valid, peopleCount: 0 }]],
      ['people count is negative', [{ ...valid, peopleCount: -1 }]],
      ['people count is not an integer', [{ ...valid, peopleCount: 1.5 }]],
      ['people count is a text', [{ ...valid, peopleCount: '1' }]],
      ['people count is null', [{ ...valid, peopleCount: null }]],
      ['one valid and one invalid requirement', [valid, { ...valid, description: '' }]],
    ];

    it.each(invalidRequirements)('returns 400 INVALID_INPUT when %s', async (_name, requirements) => {
      const hiker = await newHiker();
      const slotId = await newSlot();
      const requirementsBefore = await countAllRequirements();

      const res = await hiker.post('/api/reservations').send({ slotId, partySize: 2, requirements });

      expect(res.status, 'invalid requirements must be rejected').toBe(400);
      expect(res.body.error).toBe('INVALID_INPUT');

      // Nothing was saved: no booking, no requirement
      expect(await countReservationsInSlot(slotId), 'a rejected request must not create the booking').toBe(0);
      expect(await countAllRequirements()).toBe(requirementsBefore);

      // The hiker is not blocked: the same booking, now valid, goes through
      const retry = await hiker.post('/api/reservations').send({ slotId, partySize: 2, requirements: [valid] });
      expect(retry.status).toBe(201);
    });

    it('returns 400 INVALID_INPUT when the requirements cover more people than the party', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();

      // 3 people with requirements, but the party has 2
      const res = await hiker.post('/api/reservations').send({
        slotId,
        partySize: 2,
        requirements: [
          { peopleCount: 1, description: 'vegan', isAllergy: false },
          { peopleCount: 2, description: 'celiac', isAllergy: true },
        ],
      });

      expect(res.status, 'the requirements are for subsets of the party: they cannot exceed it').toBe(400);
      expect(res.body.error).toBe('INVALID_INPUT');
      expect(await countReservationsInSlot(slotId)).toBe(0);
    });

    it('returns 400 INVALID_INPUT when a single requirement is for more people than the party', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();

      const res = await hiker.post('/api/reservations').send({
        slotId,
        partySize: 2,
        requirements: [{ peopleCount: 3, description: 'vegan', isAllergy: false }],
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_INPUT');
      expect(await countReservationsInSlot(slotId)).toBe(0);
    });
  });

  describe('Requirements of bookings that fail are not saved', () => {
    it('saves nothing when the slot has not enough seats (409 NO_AVAILABILITY)', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot([T4]); // 2 seats
      const requirementsBefore = await countAllRequirements();

      const res = await hiker.post('/api/reservations').send({
        slotId,
        partySize: 3,
        requirements: [VEGAN_PEANUT],
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('NO_AVAILABILITY');
      expect(await countReservationsInSlot(slotId)).toBe(0);
      expect(await countAllRequirements(), 'no orphan requirement must remain').toBe(requirementsBefore);
    });

    it('keeps only the requirements of the first booking when the same hiker books the same slot again', async () => {
      const hiker = await newHiker();
      const slotId = await newSlot();

      const first = await hiker.post('/api/reservations').send({ slotId, partySize: 2, requirements: [VEGAN_PEANUT] });
      expect(first.status).toBe(201);

      const second = await hiker.post('/api/reservations').send({
        slotId, partySize: 2, requirements: [{ peopleCount: 2, description: 'second try', isAllergy: false }],
      });
      expect(second.status).toBe(409);
      expect(second.body.error).toBe('ALREADY_BOOKED');

      expect((await storedRequirements(first.body.reservationId)).map((r) => r.description))
        .toEqual(['1 vegan, peanut allergy']);
      const all = await dbAll(
        `SELECT rr.description FROM reservation_requirements rr
         JOIN reservations r ON r.reservation_id = rr.reservation_id WHERE r.slot_id = ?`,
        [slotId]
      );
      expect(all).toHaveLength(1);
    });

    it('rejects an unauthenticated booking with requirements (401) and saves nothing', async () => {
      const slotId = await newSlot();

      const res = await request(BACKEND_URL).post('/api/reservations').send({
        slotId, partySize: 2, requirements: [VEGAN_PEANUT],
      });

      expect(res.status).toBe(401);
      expect(await countReservationsInSlot(slotId)).toBe(0);
    });
  });

  describe('Many hikers booking at the same time with requirements', () => {
    it('answers every request with 201 or 409, saves the requirements of each confirmed booking exactly once and never overbooks', async () => {
      // 14 seats (T1 4 + T2 4 + T3 6), 8 hikers asking 2 seats each: exactly 7 fit
      const slotId = await newSlot();
      const hikers = [];
      for (let i = 0; i < 8; i += 1) hikers.push(await newHiker());

      const responses = await Promise.all(hikers.map((hiker, i) =>
        hiker.post('/api/reservations').send({
          slotId,
          partySize: 2,
          requirements: [{ peopleCount: 1, description: `hiker ${i}: peanut allergy`, isAllergy: true }],
        })
      ));

      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s !== 201 && s !== 409),
        `every request must be 201 or 409, got ${JSON.stringify(responses.map((r) => [r.status, r.body.error]))}`)
        .toEqual([]);
      expect(statuses.filter((s) => s === 201), 'exactly 7 parties of 2 fit in 14 seats').toHaveLength(7);

      const confirmed = responses.filter((r) => r.status === 201);
      for (const r of confirmed) {
        expect(await storedRequirements(r.body.reservationId)).toHaveLength(1);
      }

      const seatsInUse = await dbAll(
        `SELECT COALESCE(SUM(rt.allocated_seats), 0) AS seats
         FROM reservation_table rt JOIN slot_tables st ON st.slot_table_id = rt.slot_table_id
         WHERE st.slot_id = ?`,
        [slotId]
      );
      expect(seatsInUse[0].seats).toBeLessThanOrEqual(14);
    });
  });
});