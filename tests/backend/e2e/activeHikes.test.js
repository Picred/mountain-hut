import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const PORT = 3106;
const BASE_URL = `http://localhost:${PORT}`;

// Seed users (see db/init-db.js)
const JULIA = 'warden@mountainhut.test'; // warden
const CARL = 'employee@mountainhut.test'; // employee
const ANNA = 'anna@mountainhut.test'; // hiker
const BRUNO = 'bruno@mountainhut.test'; // hiker

// Seed hikes: only hike 4 (Edward, departed 9 hours ago, expected back 2 hours ago) is active.
// Hikes 1 and 2 have not started yet, hike 3 is returned, hike 5 is cancelled.
const OVERDUE_SEED_HIKE = 4;

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
        let started = false;
        proc.stdout.on('data', (chunk) => {
            if (chunk.toString().includes('backend running')) {
                started = true;
                resolve(proc);
            }
        });
        proc.once('exit', (code) => {
            if (!started) reject(new Error(`backend exited with code ${code}`));
        });
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

async function getActiveHikes(cookie) {
    const res = await fetch(`${BASE_URL}/api/hikes/active`, {
        headers: cookie ? { Cookie: cookie } : {},
    });
    return { status: res.status, body: await res.json().catch(() => null) };
}

const HOUR = 60 * 60 * 1000;
/** ISO string (UTC) `hours` hours from now (negative: in the past). */
const fromNow = (hours) => new Date(Date.now() + hours * HOUR).toISOString();

const userIdOf = (email) => db.prepare('SELECT user_id FROM users WHERE email = ?').get(email).user_id;

/** Inserts a hike directly in the database (the API does not accept departures in the past). */
function insertHike({ email, departure, arrival, status = 'scheduled', passages = [] }) {
    const { lastInsertRowid } = db
        .prepare(
            `INSERT INTO hikes (user_id, destination, route, scheduled_departure, expected_arrival, party_size, status)
             VALUES (?, 'Monte Viso', 'Via the Chiaretto lake', ?, ?, 2, ?)`,
        )
        .run(userIdOf(email), departure, arrival, status);
    const hikeId = Number(lastInsertRowid);
    passages.forEach((name, i) =>
        db.prepare('INSERT INTO hike_passages (hike_id, position, name) VALUES (?, ?, ?)').run(hikeId, i + 1, name),
    );
    return hikeId;
}

beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-'));
    const dbPath = path.join(tmpDir, 'test.sqlite');
    execFileSync('node', ['db/init-db.js'], { cwd: BACKEND_DIR, env: { ...process.env, DB_PATH: dbPath } });

    db = new DatabaseSync(dbPath);
    seed = db.prepare('SELECT MAX(hike_id) AS hikeId FROM hikes').get();

    server = await startServer(dbPath);
}, 20000);

afterEach(() => {
    db.prepare('DELETE FROM hike_passages WHERE hike_id > ?').run(seed.hikeId);
    db.prepare('DELETE FROM hikes WHERE hike_id > ?').run(seed.hikeId);
    db.prepare("UPDATE hikes SET status = 'scheduled' WHERE hike_id = ?").run(OVERDUE_SEED_HIKE);
});

afterAll(async () => {
    db?.close();
    if (server) {
        server.kill();
        await once(server, 'exit');
    }
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
});

describe('GET `/api/hikes/active`', () => {
    // ---------- Success (200) ----------

    it('returns only the hikes that have started and are still scheduled', async () => {
        const cookie = await loginAs(CARL);
        const row = db.prepare('SELECT * FROM hikes WHERE hike_id = ?').get(OVERDUE_SEED_HIKE);

        const res = await getActiveHikes(cookie);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([
            {
                hikeId: OVERDUE_SEED_HIKE,
                destination: 'Viso Mozzo',
                route: 'Ridge route, return through the Vallanta valley',
                passages: ['Vallanta pass'],
                scheduledDeparture: row.scheduled_departure,
                expectedArrival: row.expected_arrival,
                partySize: 1,
                members: [],
                status: 'scheduled',
                createdAt: row.created_at,
                isOverdue: true,
                hiker: {
                    userId: row.user_id,
                    name: 'Edward Coles',
                    email: 'edward@mountainhut.test',
                    phone: '+393451234567',
                    notes: null,
                    emergencyContact: null,
                },
            },
        ]);
    });

    it('returns a hike that is not overdue, with its passages in order and the hiker details', async () => {
        const cookie = await loginAs(CARL);
        const hikeId = insertHike({
            email: ANNA,
            departure: fromNow(-1),
            arrival: fromNow(5),
            passages: ['Viso Mozzo', 'Chiaretto saddle', 'Alpe Gias'],
        });

        const res = await getActiveHikes(cookie);

        expect(res.status).toBe(200);
        expect(res.body.find((h) => h.hikeId === hikeId)).toMatchObject({
            destination: 'Monte Viso',
            route: 'Via the Chiaretto lake',
            passages: ['Viso Mozzo', 'Chiaretto saddle', 'Alpe Gias'],
            isOverdue: false,
            hiker: {
                userId: userIdOf(ANNA),
                name: 'Anna Winden',
                notes: 'Registered mountain guide',
                emergencyContact: 'Peter Winden (brother), +39 340 7654321',
            },
        });
        // The passages of different hikes are not mixed
        expect(res.body.find((h) => h.hikeId === OVERDUE_SEED_HIKE).passages).toEqual(['Vallanta pass']);
    });

    it('returns an empty passages list for a hike without intermediate points', async () => {
        const cookie = await loginAs(CARL);
        const hikeId = insertHike({ email: ANNA, departure: fromNow(-1), arrival: fromNow(5) });

        const res = await getActiveHikes(cookie);

        expect(res.status).toBe(200);
        expect(res.body.find((h) => h.hikeId === hikeId).passages).toEqual([]);
    });

    it('orders the hikes by expected return time', async () => {
        const cookie = await loginAs(CARL);
        const later = insertHike({ email: ANNA, departure: fromNow(-3), arrival: fromNow(5) });
        const sooner = insertHike({ email: BRUNO, departure: fromNow(-1), arrival: fromNow(1) });

        const res = await getActiveHikes(cookie);

        expect(res.status).toBe(200);
        expect(res.body.map((h) => h.hikeId)).toEqual([OVERDUE_SEED_HIKE, sooner, later]);
    });

    it('does not return a hike that has not started yet', async () => {
        const cookie = await loginAs(CARL);
        const hikeId = insertHike({ email: ANNA, departure: fromNow(1), arrival: fromNow(5) });

        const res = await getActiveHikes(cookie);

        expect(res.status).toBe(200);
        expect(res.body.map((h) => h.hikeId)).not.toContain(hikeId);
    });

    it.each(['returned', 'cancelled'])('does not return a started hike that is %s', async (status) => {
        const cookie = await loginAs(CARL);
        const hikeId = insertHike({ email: ANNA, departure: fromNow(-1), arrival: fromNow(5), status });

        const res = await getActiveHikes(cookie);

        expect(res.status).toBe(200);
        expect(res.body.map((h) => h.hikeId)).not.toContain(hikeId);
    });

    it('returns an empty list when nobody is on a hike', async () => {
        const cookie = await loginAs(CARL);
        db.prepare("UPDATE hikes SET status = 'returned' WHERE hike_id = ?").run(OVERDUE_SEED_HIKE);

        const res = await getActiveHikes(cookie);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    // ---------- Authentication / authorization ----------

    it('returns 401 if the user is not logged in', async () => {
        const res = await getActiveHikes(null);

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'UNAUTHORIZED' });
    });

    it('returns 403 if the authenticated user is a hiker', async () => {
        const cookie = await loginAs(ANNA);

        const res = await getActiveHikes(cookie);

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'FORBIDDEN' });
    });

    it('lets a warden see the active hikes, as an employee', async () => {
        const cookie = await loginAs(JULIA);

        const res = await getActiveHikes(cookie);

        expect(res.status).toBe(200);
        expect(res.body.map((h) => h.hikeId)).toEqual([OVERDUE_SEED_HIKE]);
    });
});
