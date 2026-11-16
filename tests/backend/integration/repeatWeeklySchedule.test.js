import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';

// The real backend runs on a temporary copy of the demo database (backend/db/init-db.js):
// routes, passport, session, DAO and SQLite are all real, nothing is mocked.
const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const PORT = 3107;
const BASE_URL = `http://localhost:${PORT}`;

// Demo users (password "password")
const EMPLOYEE = 'employee@mountainhut.test';
const HIKER = { userId: 3, email: 'anna@mountainhut.test' };

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

async function request(method, url, { body, cookie } = {}) {
    const res = await fetch(`${BASE_URL}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
        body: body && JSON.stringify(body),
    });
    const text = await res.text();
    return {
        status: res.status,
        body: text ? JSON.parse(text) : undefined,
        cookie: res.headers.getSetCookie()[0]?.split(';')[0],
    };
}

async function loginAs(email) {
    const res = await request('POST', '/api/sessions', { body: { email, password: 'password' } });
    expect(res.status).toBe(201);
    return res.cookie;
}

const copyWeek = (body, cookie) => request('POST', '/api/slots/copy-week', { body, cookie });

// ---- Dates ----
// The API works on local dates (DATE(start_at, 'localtime')), and the server runs on this machine,
// so the weeks are computed in local time.

// YYYY-MM-DD of a local Date
const localDate = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Local day of a week relative to the current one: weekDay(0, 0) = Monday of this week,
// weekDay(10, 2) = Wednesday ten weeks from now, weekDay(-5, 6) = Sunday five weeks ago
function weekDay(weeksFromNow, dayOfWeek) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weeksFromNow * 7 + dayOfWeek);
    return d;
}

// ISO timestamp (UTC) of a local wall-clock time on the given day
function at(day, hour, minute = 0) {
    const d = new Date(day);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
}

// Same local wall-clock time, shifted by whole weeks (as the DAO does, DST included)
function shiftWeeks(iso, weeks) {
    const d = new Date(iso);
    d.setDate(d.getDate() + weeks * 7);
    return d.toISOString();
}

// Seed slots go from tomorrow to 12 days from now: the weeks used here are far from them
const SOURCE = 10;   // source week: 10 weeks from now
const TARGET = 11;   // target week: the week after

// ---- Direct DB access, to prepare and check the data ----

function insertSlot(startAt, endAt, { tableIds = [], menu = null } = {}) {
    const slotId = Number(db.prepare('INSERT INTO slots (start_at, end_at, menu) VALUES (?, ?, ?)').run(startAt, endAt, menu).lastInsertRowid);
    for (const tableId of tableIds) db.prepare('INSERT INTO slot_tables (slot_id, table_id) VALUES (?, ?)').run(slotId, tableId);
    return slotId;
}

function insertReservation(slotId, status) {
    return Number(db.prepare(`
        INSERT INTO reservations (slot_id, user_id, created_by, party_size, status)
        VALUES (?, ?, ?, 2, ?)
    `).run(slotId, HIKER.userId, HIKER.userId, status).lastInsertRowid);
}

// Slots of a whole local week (Monday to Sunday)
function slotsOfWeek(weeksFromNow) {
    return db.prepare(`
        SELECT slot_id AS slotId, start_at AS startAt, end_at AS endAt
        FROM slots
        WHERE DATE(start_at, 'localtime') BETWEEN ? AND ?
        ORDER BY start_at
    `).all(localDate(weekDay(weeksFromNow, 0)), localDate(weekDay(weeksFromNow, 6)));
}

const tablesOf = (slotId) =>
    db.prepare('SELECT table_id FROM slot_tables WHERE slot_id = ? ORDER BY table_id').all(slotId).map((r) => r.table_id);

const menuOf = (slotId) =>
    db.prepare('SELECT menu FROM slots WHERE slot_id = ?').get(slotId)?.menu ?? null;

const slotExists = (slotId) => db.prepare('SELECT 1 FROM slots WHERE slot_id = ?').get(slotId) !== undefined;

// Source week used by most tests: a lunch with tables and menu, a dinner with tables and no menu,
// a slot with neither tables nor menu
function createSourceWeek() {
    const lunch = { startAt: at(weekDay(SOURCE, 1), 12), endAt: at(weekDay(SOURCE, 1), 13), tableIds: [1, 2], menu: '**Lunch menu**\n- Soup' };
    const dinner = { startAt: at(weekDay(SOURCE, 3), 19), endAt: at(weekDay(SOURCE, 3), 21), tableIds: [3], menu: null };
    const empty = { startAt: at(weekDay(SOURCE, 6), 11), endAt: at(weekDay(SOURCE, 6), 12), tableIds: [], menu: null };
    for (const s of [lunch, dinner, empty]) s.slotId = insertSlot(s.startAt, s.endAt, s);
    return { lunch, dinner, empty };
}

beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-'));
    const dbPath = path.join(tmpDir, 'test.sqlite');
    execFileSync('node', ['db/init-db.js'], { cwd: BACKEND_DIR, env: { ...process.env, DB_PATH: dbPath } });

    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON'); // needed for the CASCADE on slot_tables
    seed = db.prepare(`
        SELECT (SELECT MAX(reservation_id) FROM reservations) AS reservationId,
               (SELECT MAX(slot_id) FROM slots) AS slotId
    `).get();

    server = await startServer(dbPath);
}, 20000);

// Every test starts from the demo data: remove what the previous test created
afterEach(() => {
    db.prepare('DELETE FROM reservations WHERE reservation_id > ?').run(seed.reservationId);
    db.prepare('DELETE FROM slots WHERE slot_id > ?').run(seed.slotId);
});

afterAll(async () => {
    db?.close();
    if (server) {
        server.kill();
        await once(server, 'exit');
    }
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
});

describe('POST /api/slots/copy-week', () => {
    describe('201 Created', () => {
        it('copies the slots and the tables, not the menu (example of the documentation)', async () => {
            const cookie = await loginAs(EMPLOYEE);
            const { lunch, dinner, empty } = createSourceWeek();

            const res = await copyWeek({
                fromDate: localDate(weekDay(SOURCE, 0)),
                toDate: localDate(weekDay(TARGET, 0)),
                copyTables: true,
                copyMenu: false,
            }, cookie);

            expect(res.status).toBe(201);
            expect(res.body).toMatchObject({
                fromWeek: localDate(weekDay(SOURCE, 0)),
                toWeek: localDate(weekDay(TARGET, 0)),
                copyTables: true,
                copyMenu: false,
                skipped: [],
            });

            // Same local day of the week and time, one week later; the slot without tables is copied too
            expect(res.body.created).toHaveLength(3);
            expect(res.body.created.map(({ startAt, endAt }) => ({ startAt, endAt }))).toEqual(
                [lunch, dinner, empty].map((s) => ({ startAt: shiftWeeks(s.startAt, 1), endAt: shiftWeeks(s.endAt, 1) })),
            );

            const [newLunch, newDinner, newEmpty] = res.body.created;
            expect(newLunch).toMatchObject({ hasTables: true, totalSeats: 8 });
            expect(newLunch.tables.map((t) => t.tableId)).toEqual([1, 2]);
            expect(newDinner).toMatchObject({ hasTables: true, totalSeats: 6 });
            expect(newEmpty).toMatchObject({ hasTables: false, totalSeats: 0, tables: [] });

            // DB: new slots in the target week, with the tables and without the menu
            expect(slotsOfWeek(TARGET).map((s) => s.slotId)).toEqual(res.body.created.map((s) => s.slotId));
            expect(tablesOf(newLunch.slotId)).toEqual([1, 2]);
            expect(tablesOf(newDinner.slotId)).toEqual([3]);
            expect(menuOf(newLunch.slotId)).toBeNull();

            // The source week is unchanged
            expect(slotsOfWeek(SOURCE).map((s) => s.slotId)).toEqual([lunch.slotId, dinner.slotId, empty.slotId]);
            expect(menuOf(lunch.slotId)).toBe('**Lunch menu**\n- Soup');
        });

        it('copies tables and menu by default when copyTables and copyMenu are omitted', async () => {
            const cookie = await loginAs(EMPLOYEE);
            createSourceWeek();

            const res = await copyWeek({
                fromDate: localDate(weekDay(SOURCE, 0)),
                toDate: localDate(weekDay(TARGET, 0)),
            }, cookie);

            expect(res.status).toBe(201);
            expect(res.body).toMatchObject({ copyTables: true, copyMenu: true });

            const [newLunch, newDinner, newEmpty] = res.body.created;
            expect(tablesOf(newLunch.slotId)).toEqual([1, 2]);
            expect(menuOf(newLunch.slotId)).toBe('**Lunch menu**\n- Soup');
            expect(menuOf(newDinner.slotId)).toBeNull();
            expect(menuOf(newEmpty.slotId)).toBeNull();
        });

        it('copies only the slots when copyTables and copyMenu are false', async () => {
            const cookie = await loginAs(EMPLOYEE);
            createSourceWeek();

            const res = await copyWeek({
                fromDate: localDate(weekDay(SOURCE, 0)),
                toDate: localDate(weekDay(TARGET, 0)),
                copyTables: false,
                copyMenu: false,
            }, cookie);

            expect(res.status).toBe(201);
            expect(res.body.created).toHaveLength(3);
            for (const slot of res.body.created) {
                expect(slot).toMatchObject({ hasTables: false, totalSeats: 0, tables: [] });
                expect(tablesOf(slot.slotId)).toEqual([]);
                expect(menuOf(slot.slotId)).toBeNull();
            }
        });

        it('accepts any day of the source and target weeks', async () => {
            const cookie = await loginAs(EMPLOYEE);
            createSourceWeek();

            const res = await copyWeek({
                fromDate: localDate(weekDay(SOURCE, 6)), // Sunday
                toDate: localDate(weekDay(TARGET, 3)),   // Thursday
            }, cookie);

            expect(res.status).toBe(201);
            expect(res.body.fromWeek).toBe(localDate(weekDay(SOURCE, 0)));
            expect(res.body.toWeek).toBe(localDate(weekDay(TARGET, 0)));
            expect(res.body.created).toHaveLength(3);
        });

        it('copies into a week before the source week', async () => {
            const cookie = await loginAs(EMPLOYEE);
            const { lunch } = createSourceWeek();
            const before = SOURCE - 3;

            const res = await copyWeek({
                fromDate: localDate(weekDay(SOURCE, 0)),
                toDate: localDate(weekDay(before, 0)),
            }, cookie);

            expect(res.status).toBe(201);
            expect(res.body.toWeek).toBe(localDate(weekDay(before, 0)));
            expect(res.body.created[0].startAt).toBe(shiftWeeks(lunch.startAt, -3));
            expect(slotsOfWeek(before)).toHaveLength(3);
        });

        it('replaces all the slots of the target week when none has active reservations', async () => {
            const cookie = await loginAs(EMPLOYEE);
            createSourceWeek();

            // Old target slots: one not overlapping any copied slot, one with only a cancelled reservation
            const oldMonday = insertSlot(at(weekDay(TARGET, 0), 8), at(weekDay(TARGET, 0), 9), { tableIds: [1], menu: '**Old menu**' });
            const oldFriday = insertSlot(at(weekDay(TARGET, 4), 15), at(weekDay(TARGET, 4), 16), { tableIds: [2] });
            const cancelled = insertReservation(oldFriday, 'cancelled');

            const res = await copyWeek({
                fromDate: localDate(weekDay(SOURCE, 0)),
                toDate: localDate(weekDay(TARGET, 0)),
            }, cookie);

            expect(res.status).toBe(201);

            // Only the copied slots are left in the target week
            expect(slotsOfWeek(TARGET).map((s) => s.slotId)).toEqual(res.body.created.map((s) => s.slotId));
            expect(slotExists(oldMonday)).toBe(false);
            expect(slotExists(oldFriday)).toBe(false);
            // Tables, menu and the cancelled reservation of the old slots are gone too
            expect(tablesOf(oldMonday)).toEqual([]);
            expect(menuOf(oldMonday)).toBeNull();
            expect(db.prepare('SELECT 1 FROM reservations WHERE reservation_id = ?').get(cancelled)).toBeUndefined();
        });
    });

    describe('200 OK', () => {
        it('creates nothing when every slot would fall in the past (SLOT_IN_THE_PAST)', async () => {
            const cookie = await loginAs(EMPLOYEE);
            const { lunch, dinner, empty } = createSourceWeek();
            const past = -5;

            const res = await copyWeek({
                fromDate: localDate(weekDay(SOURCE, 0)),
                toDate: localDate(weekDay(past, 0)),
            }, cookie);

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                fromWeek: localDate(weekDay(SOURCE, 0)),
                toWeek: localDate(weekDay(past, 0)),
                created: [],
            });
            const weeks = past - SOURCE;
            expect(res.body.skipped).toEqual([lunch, dinner, empty].map((s) => ({
                startAt: shiftWeeks(s.startAt, weeks),
                endAt: shiftWeeks(s.endAt, weeks),
                reason: 'SLOT_IN_THE_PAST',
            })));
            expect(slotsOfWeek(past)).toEqual([]);
        });
    });

    describe('errors', () => {
        const body = () => ({
            fromDate: localDate(weekDay(SOURCE, 0)),
            toDate: localDate(weekDay(TARGET, 0)),
        });

        it('returns 401 if the user is not logged in', async () => {
            createSourceWeek();

            const res = await copyWeek(body());

            expect(res.status).toBe(401);
            expect(slotsOfWeek(TARGET)).toEqual([]);
        });

        it('returns 403 if the user is a hiker', async () => {
            const cookie = await loginAs(HIKER.email);
            createSourceWeek();

            const res = await copyWeek(body(), cookie);

            expect(res.status).toBe(403);
            expect(slotsOfWeek(TARGET)).toEqual([]);
        });

        it.each([
            ['fromDate is missing', { fromDate: undefined }],
            ['toDate is missing', { toDate: undefined }],
            ['fromDate is not YYYY-MM-DD', { fromDate: '16/11/2026' }],
            ['toDate is not a real date', { toDate: '2026-02-30' }],
            ['fromDate is a date-time', { fromDate: '2026-11-16T10:00:00Z' }],
            ['copyTables is not a boolean', { copyTables: 'false' }],
            ['copyMenu is not a boolean', { copyMenu: 1 }],
        ])('returns 400 INVALID_INPUT if %s', async (_, override) => {
            const cookie = await loginAs(EMPLOYEE);
            createSourceWeek();

            const res = await copyWeek({ ...body(), ...override }, cookie);

            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: 'INVALID_INPUT' });
            expect(slotsOfWeek(TARGET)).toEqual([]);
        });

        it('returns 400 SOURCE_WEEK_IN_TARGET_WEEKS if both dates are in the same week', async () => {
            const cookie = await loginAs(EMPLOYEE);
            createSourceWeek();

            const res = await copyWeek({
                fromDate: localDate(weekDay(SOURCE, 1)),
                toDate: localDate(weekDay(SOURCE, 5)),
            }, cookie);

            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: 'SOURCE_WEEK_IN_TARGET_WEEKS' });
            expect(slotsOfWeek(SOURCE)).toHaveLength(3);
        });

        it('returns 400 NO_SLOTS_TO_COPY if the source week has no slots', async () => {
            const cookie = await loginAs(EMPLOYEE);
            // The target week has a slot: it must not be deleted
            const old = insertSlot(at(weekDay(TARGET, 2), 12), at(weekDay(TARGET, 2), 13));

            const res = await copyWeek(body(), cookie);

            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: 'NO_SLOTS_TO_COPY' });
            expect(slotsOfWeek(TARGET).map((s) => s.slotId)).toEqual([old]);
        });

        it.each(['confirmed', 'waiting'])(
            'returns 409 SLOT_HAS_RESERVATIONS and changes nothing if a target slot has a %s reservation',
            async (status) => {
                const cookie = await loginAs(EMPLOYEE);
                createSourceWeek();

                const free = insertSlot(at(weekDay(TARGET, 0), 8), at(weekDay(TARGET, 0), 9), { tableIds: [1] });
                const reserved = insertSlot(at(weekDay(TARGET, 5), 12), at(weekDay(TARGET, 5), 13), { tableIds: [2], menu: '**Reserved menu**' });
                insertReservation(reserved, status);

                const res = await copyWeek(body(), cookie);

                expect(res.status).toBe(409);
                expect(res.body.error).toMatch(/^SLOT_HAS_RESERVATIONS/);
                expect(res.body.error).toContain(`slotId: ${reserved}`);
                expect(res.body.error).not.toContain(`slotId: ${free}`);

                // Rolled back: the target week is exactly as before, the free slot was not deleted either
                expect(slotsOfWeek(TARGET).map((s) => s.slotId)).toEqual([free, reserved]);
                expect(tablesOf(free)).toEqual([1]);
                expect(tablesOf(reserved)).toEqual([2]);
                expect(menuOf(reserved)).toBe('**Reserved menu**');
            },
        );
    });
});
