import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const PORT = 3114;
const BASE_URL = `http://localhost:${PORT}`;
const EMPLOYEE = 'employee@mountainhut.test';
const HIKER = 'anna@mountainhut.test';
const OVERDUE_SEED_HIKE = 4;
const MINUTE = 60 * 1000;

let tmpDir;
let db;
let server;
let createdHikeIds = [];

function startServer(dbPath) {
    return new Promise((resolve, reject) => {
        const proc = spawn('node', ['index.js'], {
            cwd: BACKEND_DIR,
            env: {
                ...process.env,
                DB_PATH: dbPath,
                PORT: String(PORT),
                MISSING_HIKE_TIME_SCALE: '60',
                MAIL_USER: '',
                MAIL_PASS: '',
            },
        });
        let started = false;
        proc.stdout.on('data', (chunk) => {
            if (chunk.toString().includes('backend running')) {
                started = true;
                resolve(proc);
            }
        });
        proc.once('error', reject);
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

async function getMissingHikes(cookie) {
    const res = await fetch(`${BASE_URL}/api/hikes/missing`, {
        headers: cookie ? { Cookie: cookie } : {},
    });
    return { status: res.status, body: await res.json().catch(() => null) };
}

const userIdOf = (email) => db.prepare('SELECT user_id FROM users WHERE email = ?').get(email).user_id;

function insertHike({ email, arrival }) {
    const departure = new Date(Date.parse(arrival) - 4 * 60 * MINUTE).toISOString();
    const { lastInsertRowid } = db
        .prepare(
            `INSERT INTO hikes (user_id, destination, route, scheduled_departure, expected_arrival, party_size)
             VALUES (?, 'Monte Viso', 'Via the Chiaretto lake', ?, ?, 2)`,
        )
        .run(userIdOf(email), departure, arrival);
    const hikeId = Number(lastInsertRowid);
    createdHikeIds.push(hikeId);
    return hikeId;
}

async function waitForAlert(cookie, hikeId, alertNumber) {
    const deadline = Date.now() + 15000;
    let lastAlerts = [];

    while (Date.now() < deadline) {
        const res = await getMissingHikes(cookie);
        if (res.status !== 200) {
            throw new Error(`GET /api/hikes/missing returned ${res.status}`);
        }

        lastAlerts = res.body;
        const hike = lastAlerts.find((item) => item.hikeId === hikeId);
        const email = db
            .prepare('SELECT email_sent_at FROM hike_alerts WHERE hike_id = ? AND alert_number = ?')
            .get(hikeId, alertNumber);
        if (hike?.alertNumber >= alertNumber && email?.email_sent_at) {
            return hike;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Alert #${alertNumber} was not visible for hike ${hikeId}: ${JSON.stringify(lastAlerts)}`);
}

beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-'));
    const dbPath = path.join(tmpDir, 'test.sqlite');
    execFileSync('node', ['db/init-db.js'], { cwd: BACKEND_DIR, env: { ...process.env, DB_PATH: dbPath } });

    db = new DatabaseSync(dbPath);
    db.prepare("UPDATE hikes SET status = 'returned' WHERE hike_id = ?").run(OVERDUE_SEED_HIKE);
    server = await startServer(dbPath);
}, 20000);

afterAll(async () => {
    if (server) {
        server.kill();
        await once(server, 'exit');
    }
    db?.close();
    if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
    }
});

afterEach(() => {
    for (const hikeId of createdHikeIds) {
        db.prepare('DELETE FROM hike_alerts WHERE hike_id = ?').run(hikeId);
        db.prepare('DELETE FROM hikes WHERE hike_id = ?').run(hikeId);
    }
    createdHikeIds = [];
});

describe('US24 missing hiker alerts', () => {
    describe('GET `/api/hikes/missing` authorization', () => {
        it('returns 401 when the user is not logged in', async () => {
            const res = await getMissingHikes(null);
            expect(res.status).toBe(401);
            expect(res.body).toEqual({ error: 'UNAUTHORIZED' });
        });

        it('returns 403 when the user is a hiker', async () => {
            const hikerCookie = await loginAs(HIKER);
            const res = await getMissingHikes(hikerCookie);
            expect(res.status).toBe(403);
            expect(res.body).toEqual({ error: 'FORBIDDEN' });
        });
    });

    describe('missing hiker alerts', () => {
        it('exposes an overdue hiker after an alert is created and emailed to wardens', async () => {
            const employeeCookie = await loginAs(EMPLOYEE);
            const overdueHikeId = insertHike({
                email: HIKER,
                arrival: new Date(Date.now() - 150 * 1000).toISOString(),
            });
            const notYetMissingHikeId = insertHike({
                email: HIKER,
                arrival: new Date(Date.now() - 50 * 1000).toISOString(),
            });

            const beforeThreshold = await getMissingHikes(employeeCookie);
            expect(beforeThreshold.status).toBe(200);
            expect(beforeThreshold.body.map((hike) => hike.hikeId)).not.toContain(notYetMissingHikeId);

            const firstAlert = await waitForAlert(employeeCookie, overdueHikeId, 1);
            expect(firstAlert).toMatchObject({
                hikeId: overdueHikeId,
                alertNumber: 1,
                totalAlerts: 5,
                hiker: { name: 'Anna Winden', email: HIKER },
            });

            const firstAlertRow = db
                .prepare('SELECT alert_number AS alertNumber, email_sent_at AS emailSentAt FROM hike_alerts WHERE hike_id = ?')
                .get(overdueHikeId);
            expect(firstAlertRow).toMatchObject({ alertNumber: 1, emailSentAt: expect.any(String) });
        });

        it('creates hourly alerts and stops after the fifth alert', async () => {
            const employeeCookie = await loginAs(EMPLOYEE);
            const hikeId = insertHike({
                email: HIKER,
                arrival: new Date(Date.now() - 150 * 1000).toISOString(),
            });

            await waitForAlert(employeeCookie, hikeId, 1);

            for (let alertNumber = 2; alertNumber <= 5; alertNumber += 1) {
                const expectedArrival = new Date(Date.now() - (alertNumber + 1.5) * MINUTE).toISOString();
                db.prepare('UPDATE hikes SET expected_arrival = ? WHERE hike_id = ?').run(expectedArrival, hikeId);

                const alert = await waitForAlert(employeeCookie, hikeId, alertNumber);
                expect(alert.alertNumber).toBe(alertNumber);
            }

            db.prepare('UPDATE hikes SET expected_arrival = ? WHERE hike_id = ?')
                .run(new Date(Date.now() - 12 * MINUTE).toISOString(), hikeId);
            await new Promise((resolve) => setTimeout(resolve, 2200));

            const alerts = db
                .prepare('SELECT alert_number, email_sent_at FROM hike_alerts WHERE hike_id = ? ORDER BY alert_number')
                .all(hikeId);
            expect(alerts.map((row) => row.alert_number)).toEqual([1, 2, 3, 4, 5]);
            expect(alerts.every((row) => row.email_sent_at)).toBe(true);

            const res = await getMissingHikes(employeeCookie);
            expect(res.body.find((hike) => hike.hikeId === hikeId).alertNumber).toBe(5);
        }, 30000);
    });
});
