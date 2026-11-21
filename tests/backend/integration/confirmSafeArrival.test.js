import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const PORT = 3110;
const BASE_URL = `http://localhost:${PORT}`;

const ANNA = 'anna@mountainhut.test';
const BRUNO = 'bruno@mountainhut.test';
const CARL = 'employee@mountainhut.test';
const JULIA = 'warden@mountainhut.test';

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

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const TODAY = new Date();
TODAY.setUTCHours(0, 0, 0, 0);

const at = (daysFromNow, hour) => new Date(TODAY.getTime() + daysFromNow * DAY + hour * HOUR).toISOString();

function createHikePayload(offsetDays = 30) {
    return {
        destination: 'Monte Viso Summit',
        route: 'Pian del Re to Refuge trail',
        scheduledDeparture: at(offsetDays, 8),
        expectedArrival: at(offsetDays, 16),
        partySize: 2,
        passages: ['Refuge Quintino Sella', 'High Pass'],
    };
}

beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-'));
    const dbPath = path.join(tmpDir, 'test.sqlite');
    execFileSync('node', ['db/init-db.js'], { cwd: BACKEND_DIR, env: { ...process.env, DB_PATH: dbPath } });

    db = new DatabaseSync(dbPath);
    seed = db.prepare('SELECT COALESCE(MAX(hike_id), 0) AS hikeId FROM hikes').get();

    server = await startServer(dbPath);
}, 20000);

afterEach(() => {
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

describe('Confirm Safe Arrival (Backend Integration)', () => {
    describe('Authentication and role authorization', () => {
        it('rejects unauthenticated requests with 401', async () => {
            const listRes = await request('GET', '/api/hikes');
            expect(listRes.status).toBe(401);

            const confirmRes = await request('PUT', '/api/hikes/1/confirm-arrival');
            expect(confirmRes.status).toBe(401);
        });

        it.each([
            ['employee', CARL],
            ['warden', JULIA],
        ])('forbids %s from accessing hiker endpoints with 403', async (_role, email) => {
            const cookie = await loginAs(email);

            const listRes = await request('GET', '/api/hikes', cookie);
            expect(listRes.status).toBe(403);

            const confirmRes = await request('PUT', '/api/hikes/1/confirm-arrival', cookie);
            expect(confirmRes.status).toBe(403);
        });
    });

    describe('GET /api/hikes', () => {
        it('returns only the authenticated hiker hikes, sorted by departure', async () => {
            const cookieAnna = await loginAs(ANNA);
            const cookieBruno = await loginAs(BRUNO);

            const hikeLater = await request('POST', '/api/hikes', cookieAnna, {
                ...createHikePayload(32),
                destination: 'Later Destination',
            });
            const hikeEarlier = await request('POST', '/api/hikes', cookieAnna, {
                ...createHikePayload(31),
                destination: 'Earlier Destination',
            });
            const hikeBruno = await request('POST', '/api/hikes', cookieBruno, {
                ...createHikePayload(33),
                destination: 'Bruno Destination',
            });

            expect(hikeLater.status).toBe(201);
            expect(hikeEarlier.status).toBe(201);
            expect(hikeBruno.status).toBe(201);

            const resAnna = await request('GET', '/api/hikes', cookieAnna);
            expect(resAnna.status).toBe(200);

            const annaHikeIds = resAnna.body.map((h) => h.hikeId);
            expect(annaHikeIds).toContain(hikeEarlier.body.hikeId);
            expect(annaHikeIds).toContain(hikeLater.body.hikeId);
            expect(annaHikeIds).not.toContain(hikeBruno.body.hikeId);

            const earlierIndex = resAnna.body.findIndex((h) => h.hikeId === hikeEarlier.body.hikeId);
            const laterIndex = resAnna.body.findIndex((h) => h.hikeId === hikeLater.body.hikeId);
            expect(earlierIndex).toBeLessThan(laterIndex);
        });

        it('includes ordered passage points for each hike', async () => {
            const cookie = await loginAs(ANNA);
            const passages = ['Point 1', 'Point 2', 'Point 3'];
            const created = await request('POST', '/api/hikes', cookie, {
                ...createHikePayload(35),
                passages,
            });
            expect(created.status).toBe(201);

            const res = await request('GET', '/api/hikes', cookie);
            expect(res.status).toBe(200);

            const hike = res.body.find((h) => h.hikeId === created.body.hikeId);
            expect(hike).toBeDefined();
            expect(hike.passages).toEqual(passages);
        });
    });

    describe('PUT /api/hikes/:hikeId/confirm-arrival', () => {
        it('transitions a scheduled hike to returned status and persists it', async () => {
            const cookie = await loginAs(ANNA);
            const created = await request('POST', '/api/hikes', cookie, createHikePayload(36));
            expect(created.status).toBe(201);
            const hikeId = created.body.hikeId;

            const confirmRes = await request('PUT', `/api/hikes/${hikeId}/confirm-arrival`, cookie);
            expect(confirmRes.status).toBe(200);

            const dbRow = db.prepare('SELECT status FROM hikes WHERE hike_id = ?').get(hikeId);
            expect(dbRow.status).toBe('returned');

            const listRes = await request('GET', '/api/hikes', cookie);
            const updatedHike = listRes.body.find((h) => h.hikeId === hikeId);
            expect(updatedHike.status).toBe('returned');
        });

        it('returns 409 when the hike has already been confirmed as returned', async () => {
            const cookie = await loginAs(ANNA);
            const created = await request('POST', '/api/hikes', cookie, createHikePayload(37));
            expect(created.status).toBe(201);
            const hikeId = created.body.hikeId;

            const firstConfirm = await request('PUT', `/api/hikes/${hikeId}/confirm-arrival`, cookie);
            expect(firstConfirm.status).toBe(200);

            const secondConfirm = await request('PUT', `/api/hikes/${hikeId}/confirm-arrival`, cookie);
            expect(secondConfirm.status).toBe(409);
        });

        it('returns 404 when trying to confirm a hike belonging to a different hiker', async () => {
            const cookieAnna = await loginAs(ANNA);
            const cookieBruno = await loginAs(BRUNO);

            const annaHike = await request('POST', '/api/hikes', cookieAnna, createHikePayload(38));
            expect(annaHike.status).toBe(201);
            const hikeId = annaHike.body.hikeId;

            const brunoConfirm = await request('PUT', `/api/hikes/${hikeId}/confirm-arrival`, cookieBruno);
            expect(brunoConfirm.status).toBe(404);

            const dbRow = db.prepare('SELECT status FROM hikes WHERE hike_id = ?').get(hikeId);
            expect(dbRow.status).toBe('scheduled');
        });

        it('returns 404 if the hike does not exist', async () => {
            const cookie = await loginAs(ANNA);
            const res = await request('PUT', '/api/hikes/999999/confirm-arrival', cookie);

            expect(res.status).toBe(404);
        });

        it.each(['0', '-3', 'abc', '2.5'])('returns 400 for invalid hikeId parameter %s', async (invalidId) => {
            const cookie = await loginAs(ANNA);
            const res = await request('PUT', `/api/hikes/${invalidId}/confirm-arrival`, cookie);

            expect(res.status).toBe(400);
        });
    });
});
