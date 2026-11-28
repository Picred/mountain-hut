import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const PORT = 3002;
const BASE_URL = `http://localhost:${PORT}`;

const ANNA = 'anna@mountainhut.test';
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
    members: [{ name: "Marco", phone: "1112223334" }],
    partySize: 2,
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
    db.prepare('DELETE FROM hike_members WHERE hike_id > ?').run(seed.hikeId);
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

describe('Party Size and Party Details e2e', () => {
    it.each([
        ['partySize is zero', { partySize: 0 }],
        ['partySize is negative', { partySize: -1 }],
        ['partySize is not an integer', { partySize: 2.5 }],
        ['partySize is a string number', { partySize: '2' }],
        ['partySize is a string text', { partySize: 'abc' }],
        ['partySize is null', { partySize: null }],
    ])('returns 400 INVALID_INPUT when %s', async (_label, override) => {
        const cookie = await loginAs(ANNA);

        const res = await request('POST', '/api/hikes', cookie, { ...validPayload(), ...override });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'INVALID_INPUT' });
    });

    it('allows members omitted and defaults to empty array', async () => {
        const cookie = await loginAs(ANNA);
        const { members: _removed, ...payloadWithoutMembers } = validPayload();

        const res = await request('POST', '/api/hikes', cookie, payloadWithoutMembers);

        expect(res.status).toBe(201);
        expect(res.body.members).toEqual([]);
    });

    it('allows empty members array', async () => {
        const cookie = await loginAs(ANNA);
        const payload = { ...validPayload(), members: [] };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body.members).toEqual([]);
    });

    it('allows members count equal to partySize - 1', async () => {
        const cookie = await loginAs(ANNA);
        const payload = {
            ...validPayload(), partySize: 3, members: [
                { name: "Marco", phone: "1112223334" },
                { name: "Luca", phone: "4445556667" }
            ]
        };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body.members).toHaveLength(2);
    });

    it('allows members count less than partySize - 1 (partial details)', async () => {
        const cookie = await loginAs(ANNA);
        const payload = {
            ...validPayload(), partySize: 4, members: [
                { name: "Marco", phone: "1112223334" }
            ]
        };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body.members).toHaveLength(1);
        expect(res.body.partySize).toBe(4);
    });

    it('returns 400 PARTY_SIZE_MISMATCH when members count exceeds partySize - 1', async () => {
        const cookie = await loginAs(ANNA);
        const payload = {
            ...validPayload(), partySize: 2, members: [
                { name: "Marco", phone: "1112223334" },
                { name: "Luca", phone: "4445556667" }
            ]
        };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'PARTY_SIZE_MISMATCH' });
    });

    it.each([
        ['members is a string', { members: "aaa" }, 'INVALID_INPUT'],
        ['members is a number', { members: 1 }, 'INVALID_INPUT'],
        ['members is an object', { members: {} }, 'INVALID_INPUT'],
        ['members is null', { members: null }, 'INVALID_INPUT'],
    ])('returns 400 %s when %s', async (_label, override, error) => {
        const cookie = await loginAs(ANNA);

        const res = await request('POST', '/api/hikes', cookie, { ...validPayload(), ...override });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error });
    });

    // Individual member validation
    it.each([
        ["a party member's name is missing", { members: [{ phone: "111222333" }] }],
        ["a party member's name is an empty string", { members: [{ name: "", phone: "111222333" }] }],
        ["a party member's name is a number", { members: [{ name: 2, phone: "11122222" }] }],
    ])('returns 400 INVALID_INPUT when %s', async (_label, override) => {
        const cookie = await loginAs(ANNA);

        const res = await request('POST', '/api/hikes', cookie, { ...validPayload(), ...override });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'INVALID_INPUT' });
    });

    it.each([
        ["a party member's phone number is an empty string", { members: [{ name: "Anna", phone: "" }] }, 'INVALID_INPUT'],
        ["a party member's phone number is a number", { members: [{ name: "Anna", phone: 1 }] }, 'INVALID_INPUT'],
    ])('returns 400 %s when %s', async (_label, override, error) => {
        const cookie = await loginAs(ANNA);

        const res = await request('POST', '/api/hikes', cookie, { ...validPayload(), ...override });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error });
    });

    it('allows member with phone null', async () => {
        const cookie = await loginAs(ANNA);
        const payload = { ...validPayload(), members: [{ name: "Anna", phone: null }] };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body.members).toEqual([{ name: "Anna", phone: null }]);
    });

    it('allows member without phone (omitted)', async () => {
        const cookie = await loginAs(ANNA);
        const payload = { ...validPayload(), members: [{ name: "Anna" }] };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body.members).toEqual([{ name: "Anna", phone: null }]);
    });

    it('allows member with valid phone string', async () => {
        const cookie = await loginAs(ANNA);
        const payload = { ...validPayload(), members: [{ name: "Anna", phone: "3331234567" }] };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body.members).toEqual([{ name: "Anna", phone: "3331234567" }]);
    });

    // ---------- Successful Creation (201) ----------

    it('creates a hike with partySize: 1 and no members', async () => {
        const cookie = await loginAs(ANNA);
        const { members: _removed, ...payload } = validPayload();
        payload.partySize = 1;

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

    it('creates a hike with partySize: 2 and 1 member with phone', async () => {
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

    it('creates a hike with partySize: 2 and 1 member without phone', async () => {
        const cookie = await loginAs(ANNA);
        const payload = { ...validPayload(), members: [{ name: "Anna" }] };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        const expectedMembers = [{ name: "Anna", phone: null }];
        expect(res.body).toEqual({
            hikeId: expect.any(Number),
            userId: userIdOf(ANNA),
            ...payload,
            members: expectedMembers,
            status: 'scheduled',
        });
    });

    it('creates a hike with partySize: 3 and 1 member (partial details)', async () => {
        const cookie = await loginAs(ANNA);
        const payload = { ...validPayload(), partySize: 3, members: [{ name: 'Marco', phone: '1112223334' }] };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body.partySize).toBe(3);
        expect(res.body.members).toHaveLength(1);
        expect(res.body.members[0]).toEqual({ name: 'Marco', phone: '1112223334' });
    });

    it('creates a hike with partySize: 5 and 4 members (full details)', async () => {
        const cookie = await loginAs(ANNA);
        const payload = {
            ...validPayload(),
            partySize: 5,
            members: [
                { name: "Marco", phone: "1112223334" },
                { name: "Luca", phone: "4445556667" },
                { name: "Giulia", phone: "7778889990" },
                { name: "Paolo", phone: "2223334445" }
            ]
        };

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(201);
        expect(res.body.partySize).toBe(5);
        expect(res.body.members).toHaveLength(4);
    });

    it('defaults partySize to 1 when omitted and no members', async () => {
        const cookie = await loginAs(ANNA);
        const { partySize: _p, members: _m, ...payloadWithoutReq } = validPayload();

        const res = await request('POST', '/api/hikes', cookie, payloadWithoutReq);

        expect(res.status).toBe(201);
        expect(res.body.partySize).toBe(1);
        expect(res.body.members).toEqual([]);
    });

    it('returns 400 PARTY_SIZE_MISMATCH when partySize omitted but members provided', async () => {
        const cookie = await loginAs(ANNA);
        const { partySize: _p, ...payload } = validPayload();

        const res = await request('POST', '/api/hikes', cookie, payload);

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'PARTY_SIZE_MISMATCH' });
    });

    // ---------- Database Persistence ----------

    it('persists the hike in the database with correct partySize', async () => {
        const cookie = await loginAs(ANNA);
        const payload = { ...validPayload(), partySize: 4, members: [{ name: 'Marco', phone: '1112223334' }] };

        const res = await request('POST', '/api/hikes', cookie, payload);
        expect(res.status).toBe(201);

        const row = db.prepare('SELECT party_size FROM hikes WHERE hike_id = ?').get(res.body.hikeId);
        expect(row).toBeDefined();
        expect(row.party_size).toBe(4);
    });

    it('persists hike_members rows matching request', async () => {
        const cookie = await loginAs(ANNA);
        const payload = {
            ...validPayload(), partySize: 3, members: [
                { name: "Marco", phone: "1112223334" },
                { name: "Luca", phone: null }
            ]
        };

        const res = await request('POST', '/api/hikes', cookie, payload);
        expect(res.status).toBe(201);

        const members = db.prepare('SELECT name, phone FROM hike_members WHERE hike_id = ? ORDER BY position').all(res.body.hikeId);
        expect(members).toHaveLength(2);
        expect(members[0]).toEqual({ name: "Marco", phone: "1112223334" });
        expect(members[1]).toEqual({ name: "Luca", phone: null });
    });

    it('stores member with phone null correctly in database', async () => {
        const cookie = await loginAs(ANNA);
        const payload = { ...validPayload(), members: [{ name: "Anna", phone: null }] };

        const res = await request('POST', '/api/hikes', cookie, payload);
        expect(res.status).toBe(201);

        const member = db.prepare('SELECT name, phone FROM hike_members WHERE hike_id = ?').get(res.body.hikeId);
        expect(member).toEqual({ name: "Anna", phone: null });
    });

    // ---------- Authorization ----------

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
});