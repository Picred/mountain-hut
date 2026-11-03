import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// The real backend runs on a temporary copy of the demo database (backend/db/init-db.js):
// routes, DAO and SQLite are all real, nothing is mocked.
const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const PORT = 3104;
const BASE_URL = `http://localhost:${PORT}`;

// Demo data: slot 1 (tomorrow) has free seats on T2 (4), T3 (1, shared with Anna's party) and T5 (2);
// slot 4 (in two days) is empty with T1 (4) and T3 (6).
const ANNA = 'anna@mountainhut.test';

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

// No cookie is sent: the check is public
async function checkAvailability(slotId, partySize) {
  const res = await fetch(`${BASE_URL}/api/slots/${slotId}/availability?partySize=${partySize}`);
  return { status: res.status, body: await res.json() };
}

// Slot starting in the given hours, with the given tables
function createSlot(hoursFromNow, tableIds) {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const { lastInsertRowid: slotId } = db.prepare('INSERT INTO slots (start_at, end_at) VALUES (?, ?)')
    .run(start.toISOString(), end.toISOString());
  for (const tableId of tableIds) {
    db.prepare('INSERT INTO slot_tables (slot_id, table_id) VALUES (?, ?)').run(slotId, tableId);
  }
  return Number(slotId);
}

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  execFileSync('node', ['db/init-db.js'], { cwd: BACKEND_DIR, env: { ...process.env, DB_PATH: dbPath } });

  db = new DatabaseSync(dbPath);
  seed = db.prepare(`
    SELECT (SELECT MAX(reservation_id) FROM reservations) AS reservationId,
           (SELECT MAX(slot_id) FROM slots) AS slotId,
           (SELECT MAX(table_id) FROM tables) AS tableId
  `).get();

  server = await startServer(dbPath);
}, 20000);

// Every test starts from the demo data: remove what the previous test created
afterEach(() => {
  db.prepare('DELETE FROM reservation_table WHERE reservation_id > ?').run(seed.reservationId);
  db.prepare('DELETE FROM reservations WHERE reservation_id > ?').run(seed.reservationId);
  db.prepare('DELETE FROM slot_tables WHERE slot_id > ?').run(seed.slotId);
  db.prepare('DELETE FROM slots WHERE slot_id > ?').run(seed.slotId);
  db.prepare('DELETE FROM tables WHERE table_id > ?').run(seed.tableId);
});

afterAll(async () => {
  if (server && server.exitCode === null) {
    await new Promise((resolve) => {
      server.once('exit', resolve);
      server.kill();
    });
  }

  db?.close();

  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('GET /api/slots/:slotId/availability', () => {
  it('answers without login and splits the party over several tables when needed', async () => {
    // 6 free seats split over 3 tables of 2: T4, T5 and a new T6
    const { lastInsertRowid: t6 } = db.prepare("INSERT INTO tables (table_code, seats) VALUES ('T6', 2)").run();
    const slotId = createSlot(48, [4, 5, Number(t6)]);

    const res = await checkAvailability(slotId, 6);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      slotId,
      partySize: 6,
      available: true,
      tableAllocation: [
        { tableId: 4, tableCode: 'T4', allocatedSeats: 2 },
        { tableId: 5, tableCode: 'T5', allocatedSeats: 2 },
        { tableId: Number(t6), tableCode: 'T6', allocatedSeats: 2 },
      ],
    });
  });

  it('counts only the seats left free by the existing reservations', async () => {
    // Slot 1 has 7 free seats: T2 (4) + T3 (1) + T5 (2)
    const fits = await checkAvailability(1, 7);
    const tooMany = await checkAvailability(1, 8);

    expect(fits.body.available).toBe(true);
    expect(fits.body.tableAllocation).toEqual([
      { tableId: 2, tableCode: 'T2', allocatedSeats: 4 },
      { tableId: 3, tableCode: 'T3', allocatedSeats: 1 },
      { tableId: 5, tableCode: 'T5', allocatedSeats: 2 },
    ]);
    expect(tooMany.body).toMatchObject({ available: false, tableAllocation: [] });
  });

  it('proposes the same seating the booking then assigns, and updates after the booking', async () => {
    const before = await checkAvailability(4, 3);

    const login = await fetch(`${BASE_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ANNA, password: 'password' }),
    });
    const booking = await fetch(`${BASE_URL}/api/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: login.headers.getSetCookie()[0].split(';')[0] },
      body: JSON.stringify({ slotId: 4, partySize: 3 }),
    });

    expect(booking.status).toBe(201);
    expect((await booking.json()).tableAllocation).toEqual(before.body.tableAllocation);
    // 10 seats, 3 now booked: 7 still fit, 8 no longer do
    expect((await checkAvailability(4, 7)).body.available).toBe(true);
    expect((await checkAvailability(4, 8)).body.available).toBe(false);
  });

  it('is not available less than 2 hours before the slot starts, even with free seats', async () => {
    const slotId = createSlot(1, [1]);

    const res = await checkAvailability(slotId, 2);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: false, tableAllocation: [] });
  });

  it('returns 404 when the slot does not exist', async () => {
    const res = await checkAvailability(999, 2);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('SLOT_NOT_FOUND');
  });

  it('returns 400 when the slot or the party size is not a positive integer', async () => {
    for (const [slotId, partySize] of [['abc', 2], [1, 0], [1, 2.5], [1, undefined]]) {
      const res = await checkAvailability(slotId, partySize);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_INPUT');
    }
  });
});
