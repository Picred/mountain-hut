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
const EMPLOYEE = 'employee@mountainhut.test';

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

async function loginAs(email, password = 'password') {
  const res = await fetch(`${BASE_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
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
           (SELECT MAX(user_id) FROM users) AS userId,
           (SELECT MAX(slot_id) FROM slots) AS slotId
  `).get();

  server = await startServer(dbPath);
}, 20000);

// Every test starts from the demo data: remove what the previous test created
afterEach(async () => {
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      db.exec('BEGIN IMMEDIATE');

      db.prepare('DELETE FROM reservation_table WHERE reservation_id > ?')
        .run(seed.reservationId);
      db.prepare('DELETE FROM reservation_requirements WHERE reservation_id > ?')
        .run(seed.reservationId);
      db.prepare('DELETE FROM reservations WHERE reservation_id > ?')
        .run(seed.reservationId);
      db.prepare('DELETE FROM slot_tables WHERE slot_id > ?')
        .run(seed.slotId);
      db.prepare('DELETE FROM slots WHERE slot_id > ?')
        .run(seed.slotId);
      db.prepare('DELETE FROM users WHERE user_id > ?')
        .run(seed.userId);

      db.exec('COMMIT');
      return;
    } catch (error) {
      if (db.isTransaction) {
        db.exec('ROLLBACK');
      }

      const isDatabaseLocked =
        error.code === 'SQLITE_BUSY' ||
        /database is locked|SQLITE_BUSY/i.test(error.message);

      if (!isDatabaseLocked || attempt === maxAttempts) {
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, attempt * 100));
    }
  }
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
      tableAllocation: [{ tableId: 1, tableCode: 'T1', allocatedSeats: 3 }],
    });
    expect(res.body).not.toHaveProperty('requirements');
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

  it('saves multiple party requirements and returns them in the reservation response', async () => {
    const cookie = await loginAs(ANNA);
    const requirements = [
      { peopleCount: 1, description: 'peanuts', isAllergy: true },
      { peopleCount: 2, description: 'vegetarian', isAllergy: false },
    ];

    const res = await book(cookie, { slotId: 4, partySize: 3, requirements });

    expect(res.status).toBe(201);
    expect(res.body.requirements).toEqual(requirements);

    const saved = db.prepare(`
      SELECT people_count, description, is_allergy
      FROM reservation_requirements
      WHERE reservation_id = ?
      ORDER BY id
    `).all(res.body.reservationId);
    expect(saved.map((row) => ({ ...row }))).toEqual([
      { people_count: 1, description: 'peanuts', is_allergy: 1 },
      { people_count: 2, description: 'vegetarian', is_allergy: 0 },
    ]);
  });

  it('rejects invalid party requirements without saving a reservation', async () => {
    const cookie = await loginAs(ANNA);

    const res = await book(cookie, {
      slotId: 4,
      partySize: 2,
      requirements: [{ peopleCount: 1, description: 'peanuts', isAllergy: 'yes' }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_INPUT');
    expect(db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE slot_id = 4').get().n).toBe(0);
  });

  it('shares a table with another party when it is the best fit', async () => {
    const cookie = await loginAs(EDWARD);

    const res = await book(cookie, { slotId: 1, partySize: 1 });

    // T3 has 1 free seat next to Anna's party of 5: preferred to the empty T2 (4) and T5 (2)
    expect(res.status).toBe(201);
    expect(res.body.tableAllocation).toEqual([{ tableId: 3, tableCode: 'T3', allocatedSeats: 1 }]);
  });

  it('splits the party over the fewest tables when no single table is big enough', async () => {
    const cookie = await loginAs(ANNA);

    const res = await book(cookie, { slotId: 4, partySize: 8 });

    expect(res.status).toBe(201);
    expect(res.body.tableAllocation).toEqual([
      { tableId: 1, tableCode: 'T1', allocatedSeats: 4 },
      { tableId: 3, tableCode: 'T3', allocatedSeats: 4 },
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

  it('lets an employee book for an existing hiker', async () => {
    const cookie = await loginAs(EMPLOYEE);

    const res = await book(cookie, {
      slotId: 4,
      partySize: 2,
      hiker: { userId: 3 },
    });

    expect(res.status).toBe(201);
    expect(res.body.hiker).toMatchObject({
      userId: 3,
      name: 'Anna Winden',
      email: ANNA,
    });
    const saved = db.prepare(`
      SELECT user_id, created_by
      FROM reservations
      WHERE reservation_id = ?
    `).get(res.body.reservationId);
    expect({ ...saved }).toEqual({ user_id: 3, created_by: 2 });
  });

  it('registers a new hiker and creates their reservation atomically', async () => {
    const cookie = await loginAs(EMPLOYEE);
    const hiker = {
      name: 'New Hiker',
      email: 'new-hiker@mountainhut.test',
      phone: '0123456789',
    };

    const res = await book(cookie, {
      slotId: 4,
      partySize: 2,
      hiker,
    });

    expect(res.status).toBe(201);
    expect(res.body.hiker).toMatchObject({
      name: hiker.name,
      email: hiker.email,
      phone: hiker.phone,
    });
    expect(res.body.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{12}$/);
    const saved = db.prepare(`
      SELECT r.user_id, r.created_by, u.role, u.name, u.email, u.password_to_change
      FROM reservations r
      JOIN users u ON u.user_id = r.user_id
      WHERE r.reservation_id = ?
    `).get(res.body.reservationId);
    expect({ ...saved }).toMatchObject({
      user_id: res.body.hiker.userId,
      created_by: 2,
      role: 'hiker',
      name: hiker.name,
      email: hiker.email,
      password_to_change: 1,
    });
  });

  it('lets an employee create a temporary guest reservation less than two hours before the slot', async () => {
    const start = new Date(Date.now() + 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const { lastInsertRowid: slotId } = db.prepare('INSERT INTO slots (start_at, end_at) VALUES (?, ?)')
      .run(start.toISOString(), end.toISOString());
    db.prepare('INSERT INTO slot_tables (slot_id, table_id) VALUES (?, 1)').run(slotId);
    const cookie = await loginAs(EMPLOYEE);

    const res = await book(cookie, {
      slotId: Number(slotId),
      partySize: 2,
      hiker: { name: 'Walk-in Guest', phone: '0987654321' },
    });

    expect(res.status).toBe(201);
    expect(res.body.hiker).toMatchObject({
      userId: null,
      name: 'Walk-in Guest',
      email: null,
      phone: '0987654321',
    });
    const saved = db.prepare(`
      SELECT user_id, guest_name, guest_phone, created_by
      FROM reservations
      WHERE reservation_id = ?
    `).get(res.body.reservationId);
    expect({ ...saved }).toEqual({
      user_id: null,
      guest_name: 'Walk-in Guest',
      guest_phone: '0987654321',
      created_by: 2,
    });
  });

  it('rejects an employee reservation without hiker details', async () => {
    const cookie = await loginAs(EMPLOYEE);

    const res = await book(cookie, { slotId: 4, partySize: 2 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_INPUT');
    expect(db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE slot_id = 4').get().n).toBe(0);
  });

  it('does not create a new hiker when their reservation cannot be accommodated', async () => {
    const cookie = await loginAs(EMPLOYEE);
    const hiker = {
      name: 'Unavailable Hiker',
      email: 'unavailable-hiker@mountainhut.test',
      phone: '0111111111'
    };

    const res = await book(cookie, {
      slotId: 4,
      partySize: 11,
      hiker,
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_AVAILABILITY');
    expect(db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get(hiker.email).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE slot_id = 4').get().n).toBe(0);
  });

  it('lets the new hiker log in with the temporary password, which must be changed', async () => {
    const cookie = await loginAs(EMPLOYEE);
    const email = 'temporary-password@mountainhut.test';
    const res = await book(cookie, {
      slotId: 4,
      partySize: 2,
      hiker: { name: 'Temporary Password', email, phone: '0123456789' },
    });
    expect(res.status).toBe(201);

    const login = await fetch(`${BASE_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: res.body.temporaryPassword }),
    });

    expect(login.status).toBe(201);
    expect(await login.json()).toMatchObject({ email, role: 'hiker', passwordToChange: true });
  });

  it('does not save in clear the password sent by the employee', async () => {
    const cookie = await loginAs(EMPLOYEE);
    const email = 'ignored-password@mountainhut.test';

    const res = await book(cookie, {
      slotId: 4,
      partySize: 2,
      hiker: { name: 'Ignored Password', email, phone: '0123456789', password: 'chosen-password' },
    });

    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).not.toBe('chosen-password');
    const login = await fetch(`${BASE_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'chosen-password' }),
    });
    expect(login.status).toBe(401);
  });

  it('does not return a temporary password for a registered or a temporary hiker', async () => {
    const cookie = await loginAs(EMPLOYEE);

    const registered = await book(cookie, { slotId: 4, partySize: 2, hiker: { userId: 5 } });
    const guest = await book(cookie, { slotId: 4, partySize: 2, hiker: { name: 'Walk-in Guest' } });

    expect(registered.status).toBe(201);
    expect(guest.status).toBe(201);
    expect(registered.body).not.toHaveProperty('temporaryPassword');
    expect(guest.body).not.toHaveProperty('temporaryPassword');
  });

  it.each([
    ['does not exist', 99999],
    ['is not a hiker (the employee)', 2],
  ])('rejects a booking for a userId that %s with HIKER_NOT_FOUND', async (_, userId) => {
    const cookie = await loginAs(EMPLOYEE);

    const res = await book(cookie, { slotId: 4, partySize: 2, hiker: { userId } });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('HIKER_NOT_FOUND');
    expect(db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE slot_id = 4').get().n).toBe(0);
  });

  it('rejects a booking for a hiker who already booked the slot', async () => {
    const cookie = await loginAs(EMPLOYEE);

    // Anna (userId 3) already has a reservation in slot 1
    const res = await book(cookie, { slotId: 1, partySize: 1, hiker: { userId: 3 } });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_BOOKED');
    expect(db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE reservation_id > ?').get(seed.reservationId).n).toBe(0);
  });

  it('rejects a new hiker whose email is already registered, without creating anything', async () => {
    const cookie = await loginAs(EMPLOYEE);
    const usersBefore = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

    const res = await book(cookie, {
      slotId: 4,
      partySize: 2,
      hiker: { name: 'Anna Again', email: ANNA, phone: '0123456789' },
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EMAIL_ALREADY_USED');
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(usersBefore);
    expect(db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE slot_id = 4').get().n).toBe(0);
  });

  it('lets an employee book more temporary hikers in the same slot', async () => {
    const cookie = await loginAs(EMPLOYEE);

    const first = await book(cookie, { slotId: 4, partySize: 2, hiker: { name: 'Same Name' } });
    const second = await book(cookie, { slotId: 4, partySize: 2, hiker: { name: 'Same Name' } });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE guest_name = 'Same Name'").get().n).toBe(2);
  });

  it('rejects an employee booking for a slot that has already started', async () => {
    const start = new Date(Date.now() - 10 * 60 * 1000);
    const end = new Date(Date.now() + 50 * 60 * 1000);
    const { lastInsertRowid: slotId } = db.prepare('INSERT INTO slots (start_at, end_at) VALUES (?, ?)')
      .run(start.toISOString(), end.toISOString());
    db.prepare('INSERT INTO slot_tables (slot_id, table_id) VALUES (?, 1)').run(slotId);
    const cookie = await loginAs(EMPLOYEE);

    const res = await book(cookie, { slotId: Number(slotId), partySize: 2, hiker: { name: 'Too Late' } });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('BOOKING_TOO_LATE');
  });

  it('lets only employees search hikers', async () => {
    const search = (cookie) => fetch(`${BASE_URL}/api/hikers?search=Anna`, { headers: cookie ? { Cookie: cookie } : {} });

    const anonymous = await search();
    const hiker = await search(await loginAs(ANNA));
    const employee = await search(await loginAs(EMPLOYEE));

    expect(anonymous.status).toBe(401);
    expect(hiker.status).toBe(403);
    expect(employee.status).toBe(200);
    expect(await employee.json()).toEqual([
      { userId: 3, name: 'Anna Winden', email: ANNA, phone: '+393401234567' },
    ]);
  });

});
