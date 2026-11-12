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
const PORT = 3106;
const BASE_URL = `http://localhost:${PORT}`;

// Demo data: Anna owns reservation 1 (slot 1, tables), Bruno's reservation 7 is already cancelled.
// Every test books its own slots, so the demo reservations are never cancelled.
const ANNA = 'anna@mountainhut.test';
const BRUNO = 'bruno@mountainhut.test';
const EDWARD = 'edward@mountainhut.test';
const EMPLOYEE = 'employee@mountainhut.test';

let tmpDir;
let db;
let server;
let seed;

function startServer(dbPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['index.js'], {
      cwd: BACKEND_DIR,
      env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), MAIL_USER: '' },
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
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const book = (cookie, body) => request('POST', '/api/reservations', cookie, body);
const cancel = (cookie, reservationId) => request('DELETE', `/api/reservations/${reservationId}`, cookie);

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

// As Anna, books a new slot starting in 72 hours with T1 (4 seats), returns her cookie, the slot and the reservation
async function annaBooks(body = { partySize: 2 }) {
  const slotId = createSlot(72, [1]);
  const cookie = await loginAs(ANNA);
  const res = await book(cookie, { slotId, ...body });
  expect(res.status).toBe(201);
  return { cookie, slotId, reservation: res.body };
}

const savedStatus = (reservationId) =>
  db.prepare('SELECT status FROM reservations WHERE reservation_id = ?').get(reservationId).status;
const allocatedSeats = (reservationId) =>
  db.prepare('SELECT COALESCE(SUM(allocated_seats), 0) AS seats FROM reservation_table WHERE reservation_id = ?')
    .get(reservationId).seats;

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

describe('DELETE /api/reservations/:reservationId', () => {
  it('returns 401 when the user is not logged in', async () => {
    const res = await cancel(null, 1);

    expect(res.status).toBe(401);
    expect(savedStatus(1)).toBe('confirmed');
  });

  it('returns 400 INVALID_INPUT for an invalid reservation id', async () => {
    const cookie = await loginAs(ANNA);

    for (const reservationId of ['abc', '0', '-1', '1.5']) {
      const res = await cancel(cookie, reservationId);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_INPUT');
    }
  });

  it('returns 404 RESERVATION_NOT_FOUND when the reservation does not exist', async () => {
    const cookie = await loginAs(ANNA);

    const res = await cancel(cookie, 99999);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('RESERVATION_NOT_FOUND');
  });

  it('returns 403 and changes nothing when the reservation belongs to another hiker', async () => {
    const cookie = await loginAs(BRUNO);
    const seatsBefore = allocatedSeats(1);

    const res = await cancel(cookie, 1);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
    expect(savedStatus(1)).toBe('confirmed');
    expect(allocatedSeats(1)).toBe(seatsBefore);
  });

  it('cancels the reservation, keeps it as cancelled and releases its tables', async () => {
    const { cookie, reservation } = await annaBooks({
      partySize: 3,
      requirements: [{ peopleCount: 1, description: 'vegan', isAllergy: false }],
    });
    expect(allocatedSeats(reservation.reservationId)).toBe(3);

    const res = await cancel(cookie, reservation.reservationId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reservationId: reservation.reservationId, status: 'cancelled' });
    expect(savedStatus(reservation.reservationId)).toBe('cancelled');
    expect(allocatedSeats(reservation.reservationId)).toBe(0);

    // The hiker still sees it among their reservations, as cancelled and without tables
    const mine = await request('GET', '/api/reservations', cookie);
    expect(mine.body.find((r) => r.reservationId === reservation.reservationId))
      .toMatchObject({ status: 'cancelled', tableAllocation: [] });
  });

  it('frees the seats for other hikers', async () => {
    // T1 has 4 seats: Anna takes all of them, so Edward cannot book
    const { cookie, slotId, reservation } = await annaBooks({ partySize: 4 });
    const edward = await loginAs(EDWARD);
    expect((await book(edward, { slotId, partySize: 2 })).body.error).toBe('NO_AVAILABILITY');

    await cancel(cookie, reservation.reservationId);

    expect((await book(edward, { slotId, partySize: 2 })).status).toBe(201);
  });

  it('returns 409 RESERVATION_NOT_CANCELLABLE for a reservation already cancelled', async () => {
    const { cookie, reservation } = await annaBooks();
    expect((await cancel(cookie, reservation.reservationId)).status).toBe(200);

    const again = await cancel(cookie, reservation.reservationId);

    expect(again.status).toBe(409);
    expect(again.body.error).toBe('RESERVATION_NOT_CANCELLABLE');

    // the same for the demo reservation 7, cancelled by Bruno
    const bruno = await loginAs(BRUNO);
    expect((await cancel(bruno, 7)).body.error).toBe('RESERVATION_NOT_CANCELLABLE');
  });

  it('lets the hiker cancel at any time, also shortly before the slot starts', async () => {
    const { cookie, slotId, reservation } = await annaBooks();
    // the slot now starts in 30 minutes: too late to book or change, not to cancel
    db.prepare('UPDATE slots SET start_at = ?, end_at = ? WHERE slot_id = ?').run(
      new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      new Date(Date.now() + 90 * 60 * 1000).toISOString(),
      slotId
    );

    const res = await cancel(cookie, reservation.reservationId);

    expect(res.status).toBe(200);
    expect(savedStatus(reservation.reservationId)).toBe('cancelled');
  });

  it('lets the hiker cancel a reservation made for them by an employee, but not the employee', async () => {
    const slotId = createSlot(72, [1]);
    const employee = await loginAs(EMPLOYEE);
    const booked = await book(employee, { slotId, partySize: 2, hiker: { userId: 5 } });
    expect(booked.status).toBe(201);

    // the reservation belongs to the hiker, not to the employee who entered it
    expect((await cancel(employee, booked.body.reservationId)).status).toBe(403);

    const edward = await loginAs(EDWARD);
    expect((await cancel(edward, booked.body.reservationId)).status).toBe(200);
  });
});