import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// The real backend runs on a temporary copy of the demo database (backend/db/init-db.js):
// routes, DAO, transactions and SQLite are all real, nothing is mocked.
const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const PORT = 3105;
const BASE_URL = `http://localhost:${PORT}`;

// Demo data: slot 6 (in eight days) is empty with T1 (4), T2 (4), T3 (6) and T5 (2).
// Anna booked slot 1 (reservation 1, tomorrow) and slot 2 (reservation 5), Bruno's reservation 7 is cancelled.
// Changes are admitted until 48 hours before the booked slot starts.
const ANNA = 'anna@mountainhut.test';
const BRUNO = 'bruno@mountainhut.test';
const EDWARD = 'edward@mountainhut.test';

let tmpDir;
let db;
let server;
let seed;

function startServer(dbPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['index.js'], {
      cwd: BACKEND_DIR,
      env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT) },
    });
    proc.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('backend running')) resolve(proc);
    });
    proc.on('exit', (code) => reject(new Error(`backend exited with code ${code}`)));
  });
}

async function loginAs(email) {
  const res = await fetch(`${BASE_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password' }),
  });
  expect(res.status).toBe(201);
  return res.headers.getSetCookie()[0].split(';')[0];
}

async function request(method, url, cookie, body) {
  const res = await fetch(`${BASE_URL}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const book = (cookie, body) => request('POST', '/api/reservations', cookie, body);
const change = (cookie, reservationId, body) => request('PATCH', `/api/reservations/${reservationId}`, cookie, body);

// Creates a slot starting in the given hours with the given tables and returns its id
function createSlot(hours, tableIds) {
  const start = new Date(Date.now() + hours * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const { lastInsertRowid: slotId } = db.prepare('INSERT INTO slots (start_at, end_at) VALUES (?, ?)')
    .run(start.toISOString(), end.toISOString());
  for (const tableId of tableIds) {
    db.prepare('INSERT INTO slot_tables (slot_id, table_id) VALUES (?, ?)').run(slotId, tableId);
  }
  return Number(slotId);
}

// As Anna, books a new slot starting in 72 hours with T1 (4) and T3 (6), returns her cookie, the slot and the reservation
async function annaBooks(body) {
  const slotId = createSlot(72, [1, 3]);
  const cookie = await loginAs(ANNA);
  const res = await book(cookie, { slotId, ...body });
  expect(res.status).toBe(201);
  return { cookie, slotId, reservation: res.body };
}

function savedReservation(reservationId) {
  const reservation = db.prepare('SELECT slot_id, party_size FROM reservations WHERE reservation_id = ?')
    .get(reservationId);
  const tables = db.prepare(`
    SELECT st.slot_id, st.table_id, rt.allocated_seats
    FROM reservation_table rt
    JOIN slot_tables st ON st.slot_table_id = rt.slot_table_id
    WHERE rt.reservation_id = ?
    ORDER BY st.table_id
  `).all(reservationId);
  const requirements = db.prepare(`
    SELECT people_count, description, is_allergy
    FROM reservation_requirements
    WHERE reservation_id = ?
    ORDER BY id
  `).all(reservationId);
  return JSON.parse(JSON.stringify({ ...reservation, tables, requirements }));
}

const requirementIds = (reservationId) => db
  .prepare('SELECT id FROM reservation_requirements WHERE reservation_id = ? ORDER BY id')
  .all(reservationId)
  .map((row) => row.id);

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  execFileSync('node', ['db/init-db.js'], { cwd: BACKEND_DIR, env: { ...process.env, DB_PATH: dbPath } });

  db = new DatabaseSync(dbPath);
  seed = db.prepare(`
    SELECT (SELECT MAX(reservation_id) FROM reservations) AS reservationId,
           (SELECT MAX(slot_id) FROM slots) AS slotId
  `).get();

  server = await startServer(dbPath);
}, 20000);

// Every test starts from the demo data: remove what the previous test created
afterEach(() => {
  db.prepare('DELETE FROM reservations WHERE reservation_id > ?').run(seed.reservationId);
  db.prepare('DELETE FROM slot_tables WHERE slot_id > ?').run(seed.slotId);
  db.prepare('DELETE FROM slots WHERE slot_id > ?').run(seed.slotId);
});

afterAll(async () => {
  if (server && server.exitCode === null) {
    await new Promise((resolve) => {
      server.once('exit', resolve);
      server.kill();
    });
  }
  db?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('PATCH /api/reservations/:reservationId', () => {
  it('returns 401 when the user is not logged in', async () => {
    const res = await change(null, 1, { partySize: 2 });

    expect(res.status).toBe(401);
  });

  it('returns 400 INVALID_INPUT for an invalid request', async () => {
    const cookie = await loginAs(ANNA);

    for (const [reservationId, body] of [
      ['abc', { partySize: 2 }],
      [1, {}],
      [1, { slotId: 'x' }],
      [1, { partySize: 0 }],
      [1, { requirements: [] }],
      [1, { requirements: { add: {} } }],
      [1, { requirements: { add: [{ peopleCount: 1, description: ' ', isAllergy: false }] } }],
    ]) {
      const res = await change(cookie, reservationId, body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_INPUT');
    }
  });

  it('returns 404 when the reservation does not exist', async () => {
    const cookie = await loginAs(ANNA);

    const res = await change(cookie, 999, { partySize: 2 });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('RESERVATION_NOT_FOUND');
  });

  it('returns 403 when the reservation belongs to another hiker', async () => {
    const cookie = await loginAs(EDWARD);

    const res = await change(cookie, 1, { partySize: 2 });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  it('refuses to change a cancelled reservation', async () => {
    const cookie = await loginAs(BRUNO);

    const res = await change(cookie, 7, { partySize: 3 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('RESERVATION_NOT_EDITABLE');
  });

  it('refuses changes less than 48 hours before the booked slot and saves nothing', async () => {
    const cookie = await loginAs(ANNA);
    const booked = await book(cookie, { slotId: createSlot(47, [1]), partySize: 2 });
    expect(booked.status).toBe(201);
    const before = savedReservation(booked.body.reservationId);

    const res = await change(cookie, booked.body.reservationId, { partySize: 3 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EDIT_WINDOW_EXPIRED');
    expect(savedReservation(booked.body.reservationId)).toEqual(before);
  });

  it('reallocates the tables when the party size changes', async () => {
    const { cookie, slotId, reservation } = await annaBooks({ partySize: 3 });

    const res = await change(cookie, reservation.reservationId, { partySize: 8 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      reservationId: reservation.reservationId,
      slotId,
      partySize: 8,
      status: 'confirmed',
      requirements: [],
      tableAllocation: [
        { tableId: 1, tableCode: 'T1', allocatedSeats: 4 },
        { tableId: 3, tableCode: 'T3', allocatedSeats: 4 },
      ],
    });
    expect(savedReservation(reservation.reservationId)).toEqual({
      slot_id: slotId,
      party_size: 8,
      tables: [
        { slot_id: slotId, table_id: 1, allocated_seats: 4 },
        { slot_id: slotId, table_id: 3, allocated_seats: 4 },
      ],
      requirements: [],
    });
  });

  it('moves the reservation to another slot and frees the seats of the old one', async () => {
    const { cookie, slotId, reservation } = await annaBooks({ partySize: 2 });

    const res = await change(cookie, reservation.reservationId, { slotId: 6 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      slotId: 6,
      partySize: 2,
      tableAllocation: [{ tableId: 5, tableCode: 'T5', allocatedSeats: 2 }],
    });
    expect(savedReservation(reservation.reservationId).tables).toEqual([
      { slot_id: 6, table_id: 5, allocated_seats: 2 },
    ]);
    const oldSlot = await request('GET', `/api/slots/${slotId}/availability?partySize=10`, null);
    expect(oldSlot.body.available).toBe(true);
  });

  it('returns 409 and keeps the old reservation when the new party does not fit', async () => {
    const { cookie, reservation } = await annaBooks({ partySize: 3 });
    const before = savedReservation(reservation.reservationId);

    const res = await change(cookie, reservation.reservationId, { partySize: 11 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_AVAILABILITY');
    expect(savedReservation(reservation.reservationId)).toEqual(before);
  });

  it('refuses to move the reservation to a slot the hiker already booked', async () => {
    const { cookie, reservation } = await annaBooks({ partySize: 2 });

    const res = await change(cookie, reservation.reservationId, { slotId: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_BOOKED');
  });

  it('refuses to move the reservation to a missing slot or one starting in less than 2 hours', async () => {
    const soonSlotId = createSlot(1, [1]);
    const { cookie, reservation } = await annaBooks({ partySize: 2 });

    const missing = await change(cookie, reservation.reservationId, { slotId: 999 });
    const tooLate = await change(cookie, reservation.reservationId, { slotId: soonSlotId });

    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('SLOT_NOT_FOUND');
    expect(tooLate.status).toBe(409);
    expect(tooLate.body.error).toBe('BOOKING_TOO_LATE');
  });

  it('adds, updates and removes party requirements without moving the party', async () => {
    const { cookie, slotId, reservation } = await annaBooks({
      partySize: 3,
      requirements: [
        { peopleCount: 1, description: 'peanuts', isAllergy: true },
        { peopleCount: 2, description: 'vegetarian', isAllergy: false },
      ],
    });
    const [peanutsId, vegetarianId] = requirementIds(reservation.reservationId);

    const res = await change(cookie, reservation.reservationId, {
      requirements: {
        update: [{ id: peanutsId, peopleCount: 1, description: 'nuts', isAllergy: true }],
        remove: [vegetarianId],
        add: [{ peopleCount: 2, description: '  vegan  ', isAllergy: false }],
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.requirements).toEqual([
      { id: peanutsId, peopleCount: 1, description: 'nuts', isAllergy: true },
      { id: expect.any(Number), peopleCount: 2, description: 'vegan', isAllergy: false },
    ]);
    expect(savedReservation(reservation.reservationId)).toEqual({
      slot_id: slotId,
      party_size: 3,
      tables: [{ slot_id: slotId, table_id: 1, allocated_seats: 3 }],
      requirements: [
        { people_count: 1, description: 'nuts', is_allergy: 1 },
        { people_count: 2, description: 'vegan', is_allergy: 0 },
      ],
    });
  });

  it('rejects requirements for more people than the party or not of the reservation, saving nothing', async () => {
    const { cookie, reservation } = await annaBooks({
      partySize: 2,
      requirements: [{ peopleCount: 2, description: 'peanuts', isAllergy: true }],
    });
    const before = savedReservation(reservation.reservationId);
    const [otherReservationRequirementId] = requirementIds(1);

    const tooMany = await change(cookie, reservation.reservationId, {
      requirements: { add: [{ peopleCount: 1, description: 'vegan', isAllergy: false }] },
    });
    const smallerParty = await change(cookie, reservation.reservationId, { partySize: 1 });
    const notOwned = await change(cookie, reservation.reservationId, {
      requirements: { remove: [otherReservationRequirementId] },
    });

    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toBe('INVALID_INPUT');
    expect(smallerParty.status).toBe(400);
    expect(smallerParty.body.error).toBe('INVALID_INPUT');
    expect(notOwned.status).toBe(404);
    expect(notOwned.body.error).toBe('REQUIREMENT_NOT_FOUND');
    expect(savedReservation(reservation.reservationId)).toEqual(before);
  });
});

describe('GET /api/reservations', () => {
  it('returns 401 when the user is not logged in', async () => {
    const res = await request('GET', '/api/reservations', null);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it("lists only the hiker's reservations, latest slot first, with the details needed to change them", async () => {
    const { cookie, slotId, reservation } = await annaBooks({
      partySize: 3,
      requirements: [{ peopleCount: 1, description: 'peanuts', isAllergy: true }],
    });
    const saved = db.prepare(`
      SELECT s.start_at, s.end_at, r.created_at
      FROM reservations r JOIN slots s ON s.slot_id = r.slot_id
      WHERE r.reservation_id = ?
    `).get(reservation.reservationId);

    const res = await request('GET', '/api/reservations', cookie);

    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.reservationId)).toEqual([reservation.reservationId, 5, 1]);
    expect(res.body[0]).toEqual({
      reservationId: reservation.reservationId,
      slotId,
      startAt: saved.start_at,
      endAt: saved.end_at,
      partySize: 3,
      status: 'confirmed',
      createdAt: saved.created_at,
      requirements: [
        { id: requirementIds(reservation.reservationId)[0], peopleCount: 1, description: 'peanuts', isAllergy: true },
      ],
      tableAllocation: [{ tableId: 1, tableCode: 'T1', allocatedSeats: 3 }],
    });
  });
});
