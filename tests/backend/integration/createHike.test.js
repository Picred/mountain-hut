import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const PORT = 3105;
const BASE_URL = `http://localhost:${PORT}`;

const ANNA = 'anna@mountainhut.test';
const BRUNO = 'bruno@mountainhut.test';
const JULIA = 'warden@mountainhut.test';
const CARL = 'employee@mountainhut.test';

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

async function request(method, url, cookie, body) {
    const res = await fetch(`${BASE_URL}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
}

// Midnight UTC of today, computed once, so that all dates in a test run
// refer to the same day even if the run crosses midnight.
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const TODAY = new Date();
TODAY.setUTCHours(0, 0, 0, 0);

/** ISO string (UTC) for `daysFromNow` days and `hour` hours after today's 00:00 UTC. */
const at = (daysFromNow, hour) => new Date(TODAY.getTime() + daysFromNow * DAY + hour * HOUR).toISOString();

/** Fresh valid payload on each call, so tests never share or mutate state. */
const validPayload = () => ({
    destination: 'Monte Viso',
    route: 'Pian del Re - Colle delle Traversette - Monte Viso',
    scheduledDeparture: at(30, 8),
    expectedArrival: at(30, 17),
    partySize: 3,
    passages: ['Pian del Re', 'Colle delle Traversette', 'Rifugio Quintino Sella'],
});

const userIdOf = (email) => db.prepare('SELECT user_id FROM users WHERE email = ?').get(email).user_id;

beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-'));
    const dbPath = path.join(tmpDir, 'test.sqlite');
    execFileSync('node', ['db/init-db.js'], { cwd: BACKEND_DIR, env: { ...process.env, DB_PATH: dbPath } });

    db = new DatabaseSync(dbPath);
    seed = db.prepare('SELECT COALESCE(MAX(hike_id), 0) AS hikeId FROM hikes').get();

    server = await startServer(dbPath);
}, 20000);

afterEach(() => {
    // Children first, in case hike_passages has no ON DELETE CASCADE.
    db.prepare('DELETE FROM hike_passages WHERE hike_id > ?').run(seed.hikeId);
    db.prepare('DELETE FROM hikes WHERE hike_id > ?').run(seed.hikeId);
});

afterAll(async () => {
    db?.close();
    if (server) {
        server.kill();
        await once(server, 'exit');
    }
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
});

describe('POST `/api/hikes`', () => {
    // ---------- Success ----------

    it('a hiker creates a hike successfully', async () => {
        const cookie = await loginAs(ANNA);
        const payload = validPayload();

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body).toEqual({
            hikeId: expect.any(Number),
            userId: userIdOf(ANNA),
            ...payload,
            status: 'scheduled',
        });
    });

    it('persists the hike in the database', async () => {
        const cookie = await loginAs(ANNA);
        const payload = validPayload();

        const res = await request('POST', '/api/hikes', cookie, payload);
        expect(res.status).toBe(201);

        const row = db.prepare('SELECT status FROM hikes WHERE hike_id = ?').get(res.body.hikeId);
        expect(row).toBeDefined();
        expect(row.status).toBe('scheduled');

        const { n } = db.prepare('SELECT COUNT(*) AS n FROM hike_passages WHERE hike_id = ?').get(res.body.hikeId);
        expect(n).toBe(payload.passages.length);
    });

    it('creates a hike with an empty passages array', async () => {
        const cookie = await loginAs(ANNA);
        const payload = { ...validPayload(), passages: [] };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body.passages).toEqual([]);
    });

    it('defaults passages to [] when omitted', async () => {
        const cookie = await loginAs(ANNA);
        const { passages: _omitted, ...payload } = validPayload();

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body.passages).toEqual([]);
    });

    it('preserves the order of the passages', async () => {
        const cookie = await loginAs(ANNA);
        const payload = { ...validPayload(), passages: ['Zeta', 'Alfa', 'Mela'] };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body.passages).toEqual(['Zeta', 'Alfa', 'Mela']);
    });

    it('normalizes dates with an offset to UTC', async () => {
        const cookie = await loginAs(ANNA);
        const day = at(30, 0).slice(0, 10);
        const payload = {
            ...validPayload(),
            scheduledDeparture: `${day}T10:00:00+02:00`,
            expectedArrival: `${day}T19:00:00+02:00`,
        };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body.scheduledDeparture).toBe(at(30, 8));
        expect(res.body.expectedArrival).toBe(at(30, 17));
    });

    // ---------- Validation (400) ----------

    it.each([
        ['destination is a number', { destination: 1 }, 'INVALID_INPUT'],
        ['destination is empty', { destination: '' }, 'INVALID_INPUT'],
        ['route is a number', { route: 1 }, 'INVALID_INPUT'],
        ['route is empty', { route: '' }, 'INVALID_INPUT'],
        ['scheduledDeparture is a number', { scheduledDeparture: 1 }, 'INVALID_INPUT'],
        ['scheduledDeparture is empty', { scheduledDeparture: '' }, 'INVALID_INPUT'],
        ['expectedArrival is a number', { expectedArrival: 1 }, 'INVALID_INPUT'],
        ['expectedArrival is empty', { expectedArrival: '' }, 'INVALID_INPUT'],
        ['partySize is negative', { partySize: -1 }, 'INVALID_INPUT'],
        ['partySize is zero', { partySize: 0 }, 'INVALID_INPUT'],
        ['partySize is not an integer', { partySize: 2.5 }, 'INVALID_INPUT'],
        ['partySize is a string', { partySize: 'aaa' }, 'INVALID_INPUT'],
        ['passages is a number', { passages: 1 }, 'INVALID_INPUT'],
        ['passages is a string', { passages: 'aaa' }, 'INVALID_INPUT'],
        ['passages contains an empty string', { passages: ['ok', ''] }, 'INVALID_INPUT'],
        ['passages contains a number', { passages: [1] }, 'INVALID_INPUT'],

        ['scheduledDeparture is not a date', { scheduledDeparture: 'aaa' }, 'INVALID_DATE'],
        ['expectedArrival is not a date', { expectedArrival: 'aaa' }, 'INVALID_DATE'],
        ['scheduledDeparture has no timezone', { scheduledDeparture: `${at(30, 0).slice(0, 10)}T08:00:00` }, 'INVALID_DATE'],
        ['expectedArrival has no timezone', { expectedArrival: `${at(30, 0).slice(0, 10)}T17:00:00` }, 'INVALID_DATE'],
        ['scheduledDeparture is date only', { scheduledDeparture: at(30, 0).slice(0, 10) }, 'INVALID_DATE'],
        ['expectedArrival is date only', { expectedArrival: at(30, 0).slice(0, 10) }, 'INVALID_DATE'],

        ['departure is in the past', { scheduledDeparture: at(-30, 8), expectedArrival: at(-30, 17) }, 'DEPARTURE_IN_THE_PAST'],

        ['arrival before departure', { scheduledDeparture: at(30, 17), expectedArrival: at(30, 8) }, 'INVALID_TIME_RANGE'],
        ['arrival equal to departure', { scheduledDeparture: at(30, 8), expectedArrival: at(30, 8) }, 'INVALID_TIME_RANGE'],
    ])('returns 400 when %s', async (_label, override, error) => {
        const cookie = await loginAs(ANNA);

        const res = await request('POST', '/api/hikes', cookie, { ...validPayload(), ...override });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error });
    });

    it.each(['destination', 'route', 'scheduledDeparture', 'expectedArrival', 'partySize'])(
        'returns 400 INVALID_INPUT when %s is missing',
        async (field) => {
            const cookie = await loginAs(ANNA);
            const payload = validPayload();
            delete payload[field];

            const res = await request('POST', '/api/hikes', cookie, payload);

            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: 'INVALID_INPUT' });
        },
    );

    // ---------- Auth ----------

    it('returns 401 if the user is not logged in', async () => {
        const res = await request('POST', '/api/hikes', null, validPayload());

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'UNAUTHORIZED' });
    });

    it('returns 401 (not 400) if not logged in and the body is invalid', async () => {
        const res = await request('POST', '/api/hikes', null, { ...validPayload(), partySize: -1 });

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'UNAUTHORIZED' });
    });

    it.each([
        ['employee', CARL],
        ['warden', JULIA],
    ])('returns 403 if the authenticated user is a %s', async (_role, email) => {
        const cookie = await loginAs(email);

        const res = await request('POST', '/api/hikes', cookie, validPayload());

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'FORBIDDEN' });
    });

    // ---------- Conflicts (409) ----------

    it.each([
        ['same interval', 8, 17, 409],
        ['partial overlap', 12, 20, 409],
        ['contained', 10, 12, 409],
        ['containing', 6, 20, 409],
        ['adjacent after', 17, 20, 201],
        ['adjacent before', 4, 8, 201],
    ])('existing 08-17, new %s (%i-%i) -> %i', async (_label, from, to, expected) => {
        const cookie = await loginAs(ANNA);
        const first = await request('POST', '/api/hikes', cookie, validPayload());
        expect(first.status).toBe(201);

        const res = await request('POST', '/api/hikes', cookie, {
            ...validPayload(),
            scheduledDeparture: at(30, from),
            expectedArrival: at(30, to),
        });

        expect(res.status).toBe(expected);
        if (expected === 409) expect(res.body).toEqual({ error: 'HIKE_TIME_CONFLICT' });
    });

    it('allows a different hiker to book the same time interval', async () => {
        const cookieAnna = await loginAs(ANNA);
        const cookieBruno = await loginAs(BRUNO);

        const first = await request('POST', '/api/hikes', cookieAnna, validPayload());
        expect(first.status).toBe(201);

        const second = await request('POST', '/api/hikes', cookieBruno, validPayload());
        expect(second.status).toBe(201);
    });

    it('does not count non-scheduled hikes as conflicts', async () => {
        const cookie = await loginAs(ANNA);
        const first = await request('POST', '/api/hikes', cookie, validPayload());
        expect(first.status).toBe(201);

        // Adjust the status value to one your schema actually allows.
        db.prepare("UPDATE hikes SET status = 'returned' WHERE hike_id = ?").run(first.body.hikeId);

        const second = await request('POST', '/api/hikes', cookie, validPayload());
        expect(second.status).toBe(201);
    });
});