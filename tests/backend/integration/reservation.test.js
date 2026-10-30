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
const PORT = 3101;
const BASE_URL = `http://localhost:${PORT}`;

// Demo data: slot 1 (tomorrow) has free seats on T2 (4), T3 (1, shared with Anna's party) and T5 (2);
// slot 4 (in two days) is empty with T1 (4) and T3 (6). Anna and Bruno already booked slot 1, Edward did not.
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

async function book(cookie, body) {
  const res = await fetch(`${BASE_URL}/api/reservations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// YYYY-MM-DD in the server's timezone, as used by GET /api/slots
function localDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  db.prepare('DELETE FROM reservation_table WHERE reservation_id > ?').run(seed.reservationId);
  db.prepare('DELETE FROM reservations WHERE reservation_id > ?').run(seed.reservationId);
  db.prepare('DELETE FROM slot_tables WHERE slot_id > ?').run(seed.slotId);
  db.prepare('DELETE FROM slots WHERE slot_id > ?').run(seed.slotId);
});

afterAll(() => {
  server?.kill();
  db?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/slots', () => {
  it('returns the slots of the selected date with their booking availability', async () => {
    const { start_at } = db.prepare('SELECT start_at FROM slots WHERE slot_id = 1').get();

    const res = await fetch(`${BASE_URL}/api/slots?date=${localDate(start_at)}`);
    const slots = await res.json();

    expect(res.status).toBe(200);
    expect(slots.map((s) => s.slotId)).toEqual([1, 2, 3]);
    expect(slots.every((s) => s.bookingAllowed && s.restrictionReason === null)).toBe(true);
  });
});

describe('POST /api/reservations', () => {
  it('returns 401 when the user is not logged in', async () => {
    const res = await book(null, { slotId: 4, partySize: 2 });

    expect(res.status).toBe(401);
  });

  it('returns 404 when the slot does not exist', async () => {
    const cookie = await loginAs(ANNA);

    const res = await book(cookie, { slotId: 999, partySize: 2 });

    expect(res.status).toBe(404);
  });

  it('refuses a booking less than 2 hours before the slot starts', async () => {
    const start = new Date(Date.now() + 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const { lastInsertRowid: slotId } = db.prepare('INSERT INTO slots (start_at, end_at) VALUES (?, ?)')
      .run(start.toISOString(), end.toISOString());
    db.prepare('INSERT INTO slot_tables (slot_id, table_id) VALUES (?, 1)').run(slotId);
    const cookie = await loginAs(ANNA);

    const res = await book(cookie, { slotId: Number(slotId), partySize: 2 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('BOOKING_TOO_LATE');
  });

  it('allows only one booking per user in the same slot', async () => {
    const cookie = await loginAs(ANNA);

    const res = await book(cookie, { slotId: 1, partySize: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_BOOKED');
  });

  it('seats the party at the smallest single table that fits and saves the reservation', async () => {
    const cookie = await loginAs(ANNA);

    const res = await book(cookie, { slotId: 4, partySize: 3 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      slotId: 4,
      partySize: 3,
      status: 'confirmed',
      tableAllocation: [{ tableId: 1, allocatedSeats: 3 }],
    });
    const saved = db.prepare(`
      SELECT r.user_id, r.status, t.table_id, rt.allocated_seats
      FROM reservations r
      JOIN reservation_table rt ON rt.reservation_id = r.reservation_id
      JOIN slot_tables st ON st.slot_table_id = rt.slot_table_id
      JOIN tables t ON t.table_id = st.table_id
      WHERE r.reservation_id = ?
    `).all(res.body.reservationId);
    expect(saved.map((row) => ({ ...row }))).toEqual([{ user_id: 3, status: 'confirmed', table_id: 1, allocated_seats: 3 }]);
  });

  it('shares a table with another party when it is the best fit', async () => {
    const cookie = await loginAs(EDWARD);

    const res = await book(cookie, { slotId: 1, partySize: 1 });

    // T3 has 1 free seat next to Anna's party of 5: preferred to the empty T2 (4) and T5 (2)
    expect(res.status).toBe(201);
    expect(res.body.tableAllocation).toEqual([{ tableId: 3, allocatedSeats: 1 }]);
  });

  it('splits the party over the fewest tables when no single table is big enough', async () => {
    const cookie = await loginAs(ANNA);

    const res = await book(cookie, { slotId: 4, partySize: 8 });

    expect(res.status).toBe(201);
    expect(res.body.tableAllocation).toEqual([
      { tableId: 1, allocatedSeats: 4 },
      { tableId: 3, allocatedSeats: 4 },
    ]);
  });

  it('returns 409 and saves nothing when the party exceeds the free seats', async () => {
    const cookie = await loginAs(ANNA);

    const res = await book(cookie, { slotId: 4, partySize: 11 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_AVAILABILITY');
    expect(db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE slot_id = 4').get().n).toBe(0);
  });

  it('never overbooks when two users book the last seats at the same time', async () => {
    const [anna, bruno] = await Promise.all([loginAs(ANNA), loginAs(BRUNO)]);

    // 10 free seats in slot 4: only one party of 6 can fit
    const results = await Promise.all([
      book(anna, { slotId: 4, partySize: 6 }),
      book(bruno, { slotId: 4, partySize: 6 }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const { seats } = db.prepare(`
      SELECT SUM(rt.allocated_seats) AS seats
      FROM reservation_table rt
      JOIN slot_tables st ON st.slot_table_id = rt.slot_table_id
      WHERE st.slot_id = 4
    `).get();
    expect(seats).toBe(6);
  });
});
