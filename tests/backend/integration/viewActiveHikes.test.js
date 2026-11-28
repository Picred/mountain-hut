import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');

const EDWARD = 'edward@mountainhut.test';
const EMPLOYEE = 'employee@mountainhut.test';

const PORT = 3109;
const BASE_URL = `http://localhost:${PORT}`;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const TODAY = new Date();
TODAY.setHours(12, 0, 0, 0);

const MENU = '**Lunch**\n- Polenta\n- Soup';

let tmpDir;
let db;
let server;
let lastSeedHikeId;


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
            if (chunk.toString().includes('backend running')) {
                started = true;
                resolve(proc);
            }
        });

        proc.once('exit', (code) => {
            if (!started) {
                reject(new Error(`backend exited with code ${code}`));
            }
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
        body: body && JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}


beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-us11-'));

    const dbPath = path.join(tmpDir, 'test.sqlite');

    execFileSync('node', ['db/init-db.js'], {
        cwd: BACKEND_DIR,
        env: { ...process.env, DB_PATH: dbPath },
    });

    db = new DatabaseSync(dbPath);

    lastSeedHikeId = db.prepare(`
        SELECT COALESCE(MAX(hike_id), 0) AS hikeId
        FROM hikes
    `).get().hikeId;

    server = await startServer(dbPath);
}, 20000);

afterEach(() => {

    db.prepare(`
    DELETE FROM hikes
    WHERE hike_id > ?
  `).run(lastSeedHikeId);
});

afterAll(async () => {
    db?.close();

    if (server && server.exitCode === null) {
        const exited = once(server, 'exit');
        server.kill();
        await exited;
    }

    if (tmpDir) {
        rmSync(tmpDir, {
            recursive: true,
            force: true,
            maxRetries: 5,
        });
    }
});

describe("GET /api/hikes/active", () => {

    it("returns all hikes currently active, with the hiker performing it and all details", async () => {
        const cookie = await loginAs(EMPLOYEE);

        const res = await request('GET', `/api/hikes/active`, cookie);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0]).toEqual({
            "hikeId": 4,
            "destination": "Viso Mozzo",
            "route": "Ridge route, return through the Vallanta valley",
            "passages": [
                "Vallanta pass"
            ],
            "scheduledDeparture": expect.any(String),
            "expectedArrival": expect.any(String),
            "partySize": 1,
            "members": [],
            "status": "scheduled",
            "createdAt": expect.any(String),
            "isOverdue": expect.any(Boolean),
            "hiker": {
                "userId": 5,
                "name": "Edward Coles",
                "email": "edward@mountainhut.test",
                "phone": "+393451234567",
                "notes": null,
                "emergencyContact": null
            }
        });
    });

    it("returns active hikes ordered by expectedArrival ascending", async () => {
        const cookie = await loginAs(EMPLOYEE);

        const res = await request('GET', `/api/hikes/active`, cookie);

        expect(res.status).toBe(200);
        if (res.body.length > 1) {
            for (let i = 0; i < res.body.length - 1; i++) {
                const current = new Date(res.body[i].expectedArrival).getTime();
                const next = new Date(res.body[i + 1].expectedArrival).getTime();
                expect(current).toBeLessThanOrEqual(next);
            }
        }
    });

    it("returns an empty array when no active hikes are available", async () => {
        const cookie = await loginAs(EMPLOYEE);

        db.prepare('DELETE FROM hikes').run();

        const res = await request('GET', '/api/hikes/active', cookie);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);

        execFileSync('node', ['db/init-db.js'], {
            cwd: BACKEND_DIR,
            env: { ...process.env, DB_PATH: db.name },
        });
    });

    it("returns 401 UNAUTHORIZED if the user is not authenticated", async () => {
        const res = await request('GET', `/api/hikes/active`);

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'UNAUTHORIZED' }); 
    });

    it("returns 403 FORBIDDEN if a hiker tries to call the endpoint", async () => {
        const cookie = await loginAs(EDWARD);

        const res = await request('GET', `/api/hikes/active`, cookie);

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'FORBIDDEN' });
    });
});