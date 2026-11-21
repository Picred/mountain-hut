import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';

const BACKEND_DIR = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../backend'
);

const PORT = 3112;
const BASE_URL = `http://localhost:${PORT}`;

const EMPLOYEE = 'employee@mountainhut.test';
const HIKER = 'anna@mountainhut.test';
const WARDEN = 'warden@mountainhut.test';

let tmpDir;
let db;
let server;
let employeeId;
let hikerId;
let seed;

function startServer(dbPath) {
    return new Promise((resolve, reject) => {
        const proc = spawn('node', ['index.js'], {
            cwd: BACKEND_DIR,
            env: {
                ...process.env,
                DB_PATH: dbPath,
                PORT: String(PORT),
            },
        });

        let started = false;

        proc.stdout.on('data', (chunk) => {
            if (!started && chunk.toString().includes('backend running')) {
                started = true;
                resolve(proc);
            }
        });

        proc.once('exit', (code) => {
            if (!started) {
                reject(new Error(`Backend exited with code ${code}`));
            }
        });

        proc.once('error', reject);
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

async function getCapacity(cookie, query = '') {
    const res = await fetch(`${BASE_URL}/api/slots/capacity${query}`, {
        headers: cookie ? { Cookie: cookie } : {},
    });

    return {
        status: res.status,
        body: await res.json().catch(() => null),
    };
}

// Create an isolated slot in the future, without modifying demo slots.
function createSlot(daysFromNow, tableSeats = []) {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + daysFromNow);
    start.setUTCHours(12, 0, 0, 0);

    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const result = db.prepare(`
    INSERT INTO slots (start_at, end_at, menu)
    VALUES (?, ?, ?)
  `).run(start.toISOString(), end.toISOString(), 'Test menu');

    const slotId = Number(result.lastInsertRowid);
    const tables = [];

    for (const [index, seats] of tableSeats.entries()) {
        const tableResult = db.prepare(`
      INSERT INTO tables (table_code, seats)
      VALUES (?, ?)
    `).run(`US12-${slotId}-${index}`, seats);

        const tableId = Number(tableResult.lastInsertRowid);

        const assignment = db.prepare(`
      INSERT INTO slot_tables (slot_id, table_id)
      VALUES (?, ?)
    `).run(slotId, tableId);

        tables.push({
            tableId,
            slotTableId: Number(assignment.lastInsertRowid),
            code: `US12-${slotId}-${index}`,
            seats,
        });
    }

    return {
        slotId,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        tables,
    };
}

// Insert a real reservation and its allocated seats.
function createReservation(slot, allocations, status = 'confirmed') {
    const partySize = allocations.reduce(
        (sum, allocation) => sum + allocation.seats,
        0
    );

    const result = db.prepare(`
    INSERT INTO reservations
      (slot_id, user_id, created_by, party_size, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(slot.slotId, hikerId, employeeId, partySize, status);

    const reservationId = Number(result.lastInsertRowid);

    for (const allocation of allocations) {
        db.prepare(`
      INSERT INTO reservation_table
        (reservation_id, slot_table_id, allocated_seats)
      VALUES (?, ?, ?)
    `).run(
            reservationId,
            slot.tables[allocation.tableIndex].slotTableId,
            allocation.seats
        );
    }

    return reservationId;
}

async function getTestSlot(cookie, slotId) {
    const res = await getCapacity(cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const slot = res.body.find((item) => item.slotId === slotId);
    expect(slot).toBeDefined();

    return slot;
}

beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-us12-'));
    const dbPath = path.join(tmpDir, 'test.sqlite');

    execFileSync('node', ['db/init-db.js'], {
        cwd: BACKEND_DIR,
        env: { ...process.env, DB_PATH: dbPath },
    });

    db = new DatabaseSync(dbPath);

    employeeId = db.prepare(
        'SELECT user_id FROM users WHERE email = ?'
    ).get(EMPLOYEE).user_id;

    hikerId = db.prepare(
        'SELECT user_id FROM users WHERE email = ?'
    ).get(HIKER).user_id;

    seed = db.prepare(`
    SELECT
      (SELECT COALESCE(MAX(reservation_id), 0) FROM reservations) AS reservationId,
      (SELECT COALESCE(MAX(slot_id), 0) FROM slots) AS slotId,
      (SELECT COALESCE(MAX(table_id), 0) FROM tables) AS tableId
  `).get();

    server = await startServer(dbPath);
}, 20000);

// Restore the demo database after each test.
afterEach(() => {
    if (!db || !seed) return;

    db.prepare(`
    DELETE FROM reservation_table
    WHERE reservation_id > ?
  `).run(seed.reservationId);

    db.prepare(`
    DELETE FROM reservations
    WHERE reservation_id > ?
  `).run(seed.reservationId);

    db.prepare(`
    DELETE FROM slot_tables
    WHERE slot_id > ?
  `).run(seed.slotId);

    db.prepare(`
    DELETE FROM slots
    WHERE slot_id > ?
  `).run(seed.slotId);

    db.prepare(`
    DELETE FROM tables
    WHERE table_id > ?
  `).run(seed.tableId);
});

afterAll(async () => {
    if (server && server.exitCode === null) {
        server.kill();
        await once(server, 'exit');
    }

    db?.close();

    if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
    }
});

describe('Monitor Occupancy (Backend Integration)', () => {
    describe('Authentication and authorization', () => {
        it('returns 401 when the user is not authenticated', async () => {
            const res = await getCapacity();

            expect(res.status).toBe(401);
        });

        it('returns 403 for the hiker role', async () => {
            const cookie = await loginAs(HIKER);
            const res = await getCapacity(cookie);

            expect(res.status).toBe(403);
        });

        it('allows wardens to retrieve occupancy data', async () => {
            const cookie = await loginAs(WARDEN);
            const res = await getCapacity(cookie);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('allows employees to retrieve occupancy data', async () => {
            const cookie = await loginAs(EMPLOYEE);
            const res = await getCapacity(cookie);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });
    });

    describe('Slot and table occupancy', () => {
        it('reports full availability when no reservations exist', async () => {
            const slot = createSlot(40, [4, 6]);
            const cookie = await loginAs(EMPLOYEE);

            const result = await getTestSlot(cookie, slot.slotId);

            expect(result).toMatchObject({
                slotId: slot.slotId,
                menu: 'Test menu',
                hasTables: true,
                totalSeats: 10,
                bookedSeats: 0,
                remainingSeats: 10,
                occupancyPercentage: 0,
            });

            expect(result.tables).toEqual([
                {
                    tableId: slot.tables[0].tableId,
                    code: slot.tables[0].code,
                    seats: 4,
                    bookedSeats: 0,
                    remainingSeats: 4,
                    occupancyPercentage: 0,
                },
                {
                    tableId: slot.tables[1].tableId,
                    code: slot.tables[1].code,
                    seats: 6,
                    bookedSeats: 0,
                    remainingSeats: 6,
                    occupancyPercentage: 0,
                },
            ]);
        });

        it('counts confirmed reservations at slot and table level', async () => {
            const slot = createSlot(41, [4, 6]);

            createReservation(slot, [
                { tableIndex: 0, seats: 2 },
                { tableIndex: 1, seats: 3 },
            ]);

            const cookie = await loginAs(EMPLOYEE);
            const result = await getTestSlot(cookie, slot.slotId);

            expect(result).toMatchObject({
                totalSeats: 10,
                bookedSeats: 5,
                remainingSeats: 5,
                occupancyPercentage: 50,
            });

            expect(result.tables[0]).toMatchObject({
                seats: 4,
                bookedSeats: 2,
                remainingSeats: 2,
                occupancyPercentage: 50,
            });

            expect(result.tables[1]).toMatchObject({
                seats: 6,
                bookedSeats: 3,
                remainingSeats: 3,
                occupancyPercentage: 50,
            });
        });

        it('ignores cancelled and waiting reservations', async () => {
            const slot = createSlot(42, [6]);

            createReservation(slot, [
                { tableIndex: 0, seats: 2 },
            ], 'confirmed');

            createReservation(slot, [
                { tableIndex: 0, seats: 3 },
            ], 'cancelled');

            createReservation(slot, [
                { tableIndex: 0, seats: 1 },
            ], 'waiting');

            const cookie = await loginAs(EMPLOYEE);
            const result = await getTestSlot(cookie, slot.slotId);

            expect(result).toMatchObject({
                totalSeats: 6,
                bookedSeats: 2,
                remainingSeats: 4,
                occupancyPercentage: 33,
            });

            expect(result.tables[0]).toMatchObject({
                bookedSeats: 2,
                remainingSeats: 4,
                occupancyPercentage: 33,
            });
        });

        it('sums multiple reservations without duplicating table capacity', async () => {
            const slot = createSlot(43, [6, 4]);

            createReservation(slot, [
                { tableIndex: 0, seats: 2 },
            ]);

            createReservation(slot, [
                { tableIndex: 0, seats: 3 },
            ]);

            createReservation(slot, [
                { tableIndex: 1, seats: 1 },
            ]);

            const cookie = await loginAs(EMPLOYEE);
            const result = await getTestSlot(cookie, slot.slotId);

            expect(result).toMatchObject({
                totalSeats: 10,
                bookedSeats: 6,
                remainingSeats: 4,
                occupancyPercentage: 60,
            });

            expect(result.tables).toHaveLength(2);

            expect(result.tables[0]).toMatchObject({
                seats: 6,
                bookedSeats: 5,
                remainingSeats: 1,
                occupancyPercentage: 83,
            });

            expect(result.tables[1]).toMatchObject({
                seats: 4,
                bookedSeats: 1,
                remainingSeats: 3,
                occupancyPercentage: 25,
            });
        });

        it('reports 100% occupancy when all seats are booked', async () => {
            const slot = createSlot(44, [4]);

            createReservation(slot, [
                { tableIndex: 0, seats: 4 },
            ]);

            const cookie = await loginAs(EMPLOYEE);
            const result = await getTestSlot(cookie, slot.slotId);

            expect(result).toMatchObject({
                totalSeats: 4,
                bookedSeats: 4,
                remainingSeats: 0,
                occupancyPercentage: 100,
            });

            expect(result.tables[0]).toMatchObject({
                bookedSeats: 4,
                remainingSeats: 0,
                occupancyPercentage: 100,
            });
        });

        it('returns zero occupancy for slots without tables', async () => {
            const slot = createSlot(45);
            const cookie = await loginAs(EMPLOYEE);

            const result = await getTestSlot(cookie, slot.slotId);

            expect(result).toMatchObject({
                hasTables: false,
                totalSeats: 0,
                bookedSeats: 0,
                remainingSeats: 0,
                occupancyPercentage: 0,
                tables: [],
            });
        });

        it('updates occupancy after a reservation is cancelled', async () => {
            const slot = createSlot(46, [4]);

            const reservationId = createReservation(slot, [
                { tableIndex: 0, seats: 3 },
            ]);

            const cookie = await loginAs(EMPLOYEE);

            const before = await getTestSlot(cookie, slot.slotId);

            expect(before.bookedSeats).toBe(3);
            expect(before.remainingSeats).toBe(1);

            db.prepare(`
        UPDATE reservations
        SET status = 'cancelled'
        WHERE reservation_id = ?
      `).run(reservationId);

            const after = await getTestSlot(cookie, slot.slotId);

            expect(after.bookedSeats).toBe(0);
            expect(after.remainingSeats).toBe(4);
            expect(after.occupancyPercentage).toBe(0);

            expect(after.tables[0]).toMatchObject({
                bookedSeats: 0,
                remainingSeats: 4,
                occupancyPercentage: 0,
            });
        });

        it('keeps occupancy independent between different slots', async () => {
            const first = createSlot(47, [4]);
            const second = createSlot(48, [6]);

            createReservation(first, [
                { tableIndex: 0, seats: 3 },
            ]);

            createReservation(second, [
                { tableIndex: 0, seats: 2 },
            ]);

            const cookie = await loginAs(EMPLOYEE);

            const firstResult = await getTestSlot(cookie, first.slotId);
            const secondResult = await getTestSlot(cookie, second.slotId);

            expect(firstResult).toMatchObject({
                totalSeats: 4,
                bookedSeats: 3,
                remainingSeats: 1,
                occupancyPercentage: 75,
            });

            expect(secondResult).toMatchObject({
                totalSeats: 6,
                bookedSeats: 2,
                remainingSeats: 4,
                occupancyPercentage: 33,
            });
        });
    });

    describe('Date filtering and validation', () => {
        it('returns only slots within the requested date range', async () => {
            const first = createSlot(50, [4]);
            const second = createSlot(55, [6]);

            const cookie = await loginAs(EMPLOYEE);

            // Use local dates, matching the DAO's SQLite localtime filter.
            const date = new Date(first.startAt).toLocaleDateString('en-CA');
            const res = await getCapacity(
                cookie,
                `?from=${date}&to=${date}`
            );

            expect(res.status).toBe(200);

            const ids = res.body.map((slot) => slot.slotId);

            expect(ids).toContain(first.slotId);
            expect(ids).not.toContain(second.slotId);
        });

        it('returns 400 for invalid date parameters', async () => {
            const cookie = await loginAs(EMPLOYEE);

            for (const query of [
                '?from=invalid',
                '?to=2027-99-99',
                '?from=2027-01-12&to=2027-01-10',
            ]) {
                const res = await getCapacity(cookie, query);
                expect(res.status).toBe(400);
            }
        });
    });
});
