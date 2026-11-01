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
const PORT = 3103;
const BASE_URL = `http://localhost:${PORT}`;


const CARL_empl = "employee@mountainhut.test"
const ANNA_hiker = "anna@mountainhut.test"

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
// YYYY-MM-DD in the server's timezone, as used by the API
function localDate(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const addHours = (iso, hours) => new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000).toISOString();


beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-'));
    const dbPath = path.join(tmpDir, 'test.sqlite');
    execFileSync('node', ['db/init-db.js'], { cwd: BACKEND_DIR, env: { ...process.env, DB_PATH: dbPath } });

    db = new DatabaseSync(dbPath);
    seed = db.prepare(`
    SELECT (SELECT MAX(reservation_id) FROM reservations) AS reservationId,
           (SELECT MAX(slot_id) FROM slots) AS slotId,
           (SELECT MAX(slot_table_id) FROM slot_tables) AS slotTableId,
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
});

afterAll(async () => {
    db?.close();
    if (server) {
        server.kill();
        await once(server, 'exit');
    }
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
});

describe("GET /api/slots/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD", () => {
    it('returns all slots ordered by start time', async () => {
        const cookie = await loginAs(CARL_empl);
        const { start_at } = db.prepare('SELECT start_at FROM slots WHERE slot_id = 1').get();
        const day = localDate(start_at);
        const params = new URLSearchParams({ from: day, to: day });

        const res = await fetch(`${BASE_URL}/api/slots/capacity?${params}`, {
            headers: { Cookie: cookie },
        });
        const slots = await res.json();

        expect(res.status).toBe(200);
        expect(slots.map((s) => s.slotId).sort()).toEqual([1, 2, 3]); // slot 4 is two days later, so it must be excluded
    });
    it('return 401 if the user is not logged in', async () => {
        const { start_at } = db.prepare('SELECT start_at FROM slots WHERE slot_id = 1').get();
        const day = localDate(start_at);
        const params = new URLSearchParams({ from: day, to: day });

        const res = await fetch(`${BASE_URL}/api/slots/capacity?${params}`);
        const slots = await res.json();

        expect(res.status).toBe(401);
    });

    it('returns 400 if the "from" date is invalid', async () => {
        const cookie = await loginAs(CARL_empl);
        const { start_at } = db.prepare('SELECT start_at FROM slots WHERE slot_id = 1').get();
        const day = localDate(start_at);
        const params = new URLSearchParams({ from: "invalid_date", to: day });

        const res = await fetch(`${BASE_URL}/api/slots/capacity?${params}`, {
            headers: { Cookie: cookie },
        });
        const slots = await res.json();

        expect(res.status).toBe(400);
    });

    it('returns 400 if the "to" date is invalid', async () => {
        const cookie = await loginAs(CARL_empl);
        const { start_at } = db.prepare('SELECT start_at FROM slots WHERE slot_id = 1').get();
        const day = localDate(start_at);
        const params = new URLSearchParams({ from: day, to: "invalid_date" });

        const res = await fetch(`${BASE_URL}/api/slots/capacity?${params}`, {
            headers: { Cookie: cookie },
        });
        const slots = await res.json();

        expect(res.status).toBe(400);
    });

    it('returns 400 if the date range is invalid', async () => {
        const cookie = await loginAs(CARL_empl);
        const { start_at } = db.prepare('SELECT start_at FROM slots WHERE slot_id = 1').get();
        const dayBefore = new Date(start_at);
        dayBefore.setDate(dayBefore.getDate() - 1);

        const day = localDate(start_at);
        const yesterday = localDate(dayBefore);
        const params = new URLSearchParams({ from: day, to: yesterday });

        const res = await fetch(`${BASE_URL}/api/slots/capacity?${params}`, {
            headers: { Cookie: cookie },
        });
        const slots = await res.json();

        expect(res.status).toBe(400);
    });

    it('returns 403 if an hiker tries to call the api', async () => {
        const cookie = await loginAs(ANNA_hiker);
        const { start_at } = db.prepare('SELECT start_at FROM slots WHERE slot_id = 1').get();
        const day = localDate(start_at);
        const params = new URLSearchParams({ from: day, to: day });

        const res = await fetch(`${BASE_URL}/api/slots/capacity?${params}`, {
            headers: { Cookie: cookie },
        });
        const slots = await res.json();

        expect(res.status).toBe(403);
    });
})

describe("POST api/slots", () => {
    it("creates a new time slot", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
const startAt = addHours(end_at, 24);
const endAt = addHours(end_at, 25);
        const res = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        expect(res.status).toBe(201)
        const slot = await res.json();
        expect(slot).toHaveProperty("slotId")
            .toHaveProperty("startAt", startAt)
            .toHaveProperty("endAt", endAt)
            .toHaveProperty("hasTables", false)
            .toHaveProperty("totalSeats", 0)
            .toHaveProperty("tables", [])
    })
})