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

// Seed users (see db/init-db.js)
const JULIA = 'warden@mountainhut.test'; // warden
const CARL = 'employee@mountainhut.test'; // employee
const ANNA = 'anna@mountainhut.test'; // hiker (has a scheduled hike at day +1, 06:00-15:00)
const BRUNO = 'bruno@mountainhut.test'; // hiker
const CATERINA = 's336160@studenti.polito.it'; // hiker (has a cancelled hike at day +3, 08:00-14:00)

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

// Midnight UTC of today, computed once: all dates of a run refer to the same day
// even if the run crosses midnight.
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const TODAY = new Date();
TODAY.setUTCHours(0, 0, 0, 0);

/** ISO string (UTC) `daysFromNow` days and `hour` hours after today's 00:00 UTC. */
const at = (daysFromNow, hour) => new Date(TODAY.getTime() + daysFromNow * DAY + hour * HOUR).toISOString();

/** Fresh valid payload at day +30 (no seed hike there), a new object on each call. */
const validPayload = () => ({
    destination: 'Monte Viso',
    route: 'Pian del Re - Colle delle Traversette - Monte Viso',
    scheduledDeparture: at(30, 8),
    expectedArrival: at(30, 17),
    partySize: 3,
    passages: ['Pian del Re', 'Colle delle Traversette', 'Rifugio Quintino Sella'],
});

const userIdOf = (email) => db.prepare('SELECT user_id FROM users WHERE email = ?').get(email).user_id;
const countHikes = () => db.prepare('SELECT COUNT(*) AS n FROM hikes').get().n;

beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-'));
    const dbPath = path.join(tmpDir, 'test.sqlite');
    execFileSync('node', ['db/init-db.js'], { cwd: BACKEND_DIR, env: { ...process.env, DB_PATH: dbPath } });

    db = new DatabaseSync(dbPath);
    seed = db.prepare('SELECT COALESCE(MAX(hike_id), 0) AS hikeId FROM hikes').get();

    server = await startServer(dbPath);
}, 20000);

afterEach(() => {
    // Children first (hike_passages has ON DELETE CASCADE, but this does not depend on it).
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
    // ---------- Success (201) ----------

    it('a hiker creates a hike successfully', async () => {
        const cookie = await loginAs(ANNA);
        const payload = validPayload();

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body).toEqual({
            hikeId: expect.any(Number),
            userId: userIdOf(ANNA),
            ...payload,
            members: [],
            status: 'scheduled',
        });
    });

    it('persists the hike and its passages in the database', async () => {
        const cookie = await loginAs(ANNA);
        const payload = validPayload();

        const res = await request('POST', '/api/hikes', cookie, payload);
        expect(res.status).toBe(201);

        const row = db.prepare('SELECT * FROM hikes WHERE hike_id = ?').get(res.body.hikeId);
        expect(row).toMatchObject({
            user_id: userIdOf(ANNA),
            destination: payload.destination,
            route: payload.route,
            party_size: payload.partySize,
            status: 'scheduled',
        });
        expect(new Date(row.scheduled_departure).toISOString()).toBe(payload.scheduledDeparture);
        expect(new Date(row.expected_arrival).toISOString()).toBe(payload.expectedArrival);

        const passages = db
            .prepare('SELECT position, name FROM hike_passages WHERE hike_id = ? ORDER BY position')
            .all(res.body.hikeId);
        expect(passages.map((p) => ({ ...p }))).toEqual([
            { position: 1, name: 'Pian del Re' },
            { position: 2, name: 'Colle delle Traversette' },
            { position: 3, name: 'Rifugio Quintino Sella' },
        ]);
    });

    it('creates a hike with an empty passages array', async () => {
        const cookie = await loginAs(ANNA);
        const payload = { ...validPayload(), passages: [] };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body.passages).toEqual([]);
        const { n } = db.prepare('SELECT COUNT(*) AS n FROM hike_passages WHERE hike_id = ?').get(res.body.hikeId);
        expect(n).toBe(0);
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

        const stored = db
            .prepare('SELECT name FROM hike_passages WHERE hike_id = ? ORDER BY position')
            .all(res.body.hikeId)
            .map((p) => p.name);
        expect(stored).toEqual(['Zeta', 'Alfa', 'Mela']);
    });

    it('allows the same passage name more than once', async () => {
        const cookie = await loginAs(ANNA);
        const payload = { ...validPayload(), passages: ['Colle', 'Rifugio', 'Colle'] };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body.passages).toEqual(['Colle', 'Rifugio', 'Colle']);
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

    it('ignores userId and status sent in the body', async () => {
        const cookie = await loginAs(ANNA);
        const payload = { ...validPayload(), userId: userIdOf(BRUNO), status: 'returned' };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body.userId).toBe(userIdOf(ANNA));
        expect(res.body.status).toBe('scheduled');
    });

    it('assigns different ids to different hikes', async () => {
        const cookie = await loginAs(ANNA);

        const first = await request('POST', '/api/hikes', cookie, validPayload());
        const second = await request('POST', '/api/hikes', cookie, {
            ...validPayload(),
            scheduledDeparture: at(31, 8),
            expectedArrival: at(31, 17),
        });

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(second.body.hikeId).not.toBe(first.body.hikeId);
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
        ['scheduledDeparture is an impossible date', { scheduledDeparture: '2030-02-30T08:00:00Z' }, 'INVALID_DATE'],
        ['scheduledDeparture has no timezone', { scheduledDeparture: `${at(30, 0).slice(0, 10)}T08:00:00` }, 'INVALID_DATE'],
        ['expectedArrival has no timezone', { expectedArrival: `${at(30, 0).slice(0, 10)}T17:00:00` }, 'INVALID_DATE'],
        ['scheduledDeparture is date only', { scheduledDeparture: at(30, 0).slice(0, 10) }, 'INVALID_DATE'],
        ['expectedArrival is date only', { expectedArrival: at(30, 0).slice(0, 10) }, 'INVALID_DATE'],

        ['departure is in the past', { scheduledDeparture: at(-30, 8), expectedArrival: at(-30, 17) }, 'DEPARTURE_IN_THE_PAST'],
        [
            'departure was one minute ago',
            { scheduledDeparture: new Date(Date.now() - 60 * 1000).toISOString(), expectedArrival: at(30, 17) },
            'DEPARTURE_IN_THE_PAST',
        ],

        ['arrival before departure', { scheduledDeparture: at(30, 17), expectedArrival: at(30, 8) }, 'INVALID_TIME_RANGE'],
        ['arrival equal to departure', { scheduledDeparture: at(30, 8), expectedArrival: at(30, 8) }, 'INVALID_TIME_RANGE'],
    ])('returns 400 when %s', async (_label, override, error) => {
        const cookie = await loginAs(ANNA);

        const res = await request('POST', '/api/hikes', cookie, { ...validPayload(), ...override });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error });
    });

    it.each(['destination', 'route', 'scheduledDeparture', 'expectedArrival'])(
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

    it('returns 400 INVALID_INPUT when the body is empty', async () => {
        const cookie = await loginAs(ANNA);

        const res = await request('POST', '/api/hikes', cookie, {});

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'INVALID_INPUT' });
    });

    it('does not create any hike or passage when validation fails', async () => {
        const cookie = await loginAs(ANNA);
        const hikesBefore = countHikes();
        const passagesBefore = db.prepare('SELECT COUNT(*) AS n FROM hike_passages').get().n;

        // Valid hike with one invalid passage: nothing must be stored, not even the hike.
        const res = await request('POST', '/api/hikes', cookie, { ...validPayload(), passages: ['ok', ''] });

        expect(res.status).toBe(400);
        expect(countHikes()).toBe(hikesBefore);
        expect(db.prepare('SELECT COUNT(*) AS n FROM hike_passages').get().n).toBe(passagesBefore);
    });

    // ---------- Authentication / authorization ----------

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

    it('does not create a hike if the user is not logged in', async () => {
        const hikesBefore = countHikes();

        await request('POST', '/api/hikes', null, validPayload());

        expect(countHikes()).toBe(hikesBefore);
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

    it('returns 403 (not 400) if the user is not a hiker and the body is invalid', async () => {
        const cookie = await loginAs(CARL);

        const res = await request('POST', '/api/hikes', cookie, { ...validPayload(), partySize: -1 });

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'FORBIDDEN' });
    });

    it('does not create a hike if the user is not a hiker', async () => {
        const cookie = await loginAs(JULIA);
        const hikesBefore = countHikes();

        await request('POST', '/api/hikes', cookie, validPayload());

        expect(countHikes()).toBe(hikesBefore);
    });

    // ---------- Time conflicts (409) ----------

    it.each([
        ['same interval', 8, 17, 409],
        ['partial overlap at the end', 12, 20, 409],
        ['partial overlap at the start', 4, 10, 409],
        ['contained', 10, 12, 409],
        ['containing', 6, 20, 409],
        ['adjacent after', 17, 20, 201],
        ['adjacent before', 4, 8, 201],
        ['entirely after', 18, 22, 201],
        ['entirely before', 2, 6, 201],
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

    it('returns 409 when overlapping a hike already present in the seed', async () => {
        const cookie = await loginAs(ANNA);

        // Seed hike of Anna: day +1, 06:00-15:00, scheduled
        const res = await request('POST', '/api/hikes', cookie, {
            ...validPayload(),
            scheduledDeparture: at(1, 10),
            expectedArrival: at(1, 12),
        });

        expect(res.status).toBe(409);
        expect(res.body).toEqual({ error: 'HIKE_TIME_CONFLICT' });
    });

    it('does not create anything when there is a conflict', async () => {
        const cookie = await loginAs(ANNA);
        const first = await request('POST', '/api/hikes', cookie, validPayload());
        expect(first.status).toBe(201);
        const hikesBefore = countHikes();
        const passagesBefore = db.prepare('SELECT COUNT(*) AS n FROM hike_passages').get().n;

        const second = await request('POST', '/api/hikes', cookie, validPayload());

        expect(second.status).toBe(409);
        expect(countHikes()).toBe(hikesBefore);
        expect(db.prepare('SELECT COUNT(*) AS n FROM hike_passages').get().n).toBe(passagesBefore);
    });

    it('allows a different hiker to book the same time interval', async () => {
        const cookieAnna = await loginAs(ANNA);
        const cookieBruno = await loginAs(BRUNO);

        const first = await request('POST', '/api/hikes', cookieAnna, validPayload());
        expect(first.status).toBe(201);

        const second = await request('POST', '/api/hikes', cookieBruno, validPayload());
        expect(second.status).toBe(201);
        expect(second.body.userId).toBe(userIdOf(BRUNO));
    });

    it.each(['returned', 'cancelled'])('does not count %s hikes as conflicts', async (status) => {
        const cookie = await loginAs(ANNA);
        const first = await request('POST', '/api/hikes', cookie, validPayload());
        expect(first.status).toBe(201);

        db.prepare('UPDATE hikes SET status = ? WHERE hike_id = ?').run(status, first.body.hikeId);

        const second = await request('POST', '/api/hikes', cookie, validPayload());
        expect(second.status).toBe(201);
    });

    it('does not count a cancelled hike of the seed as a conflict', async () => {
        const cookie = await loginAs(CATERINA);

        // Seed hike of Caterina: day +3, 08:00-14:00, cancelled
        const res = await request('POST', '/api/hikes', cookie, {
            ...validPayload(),
            scheduledDeparture: at(3, 9),
            expectedArrival: at(3, 12),
        });

        expect(res.status).toBe(201);
    });
});