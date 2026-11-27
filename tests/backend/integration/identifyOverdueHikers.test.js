import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const PORT = 3113;
const BASE_URL = `http://localhost:${PORT}`;

// Seed users (see db/init-db.js)
const JULIA = 'warden@mountainhut.test'; // warden
const CARL = 'employee@mountainhut.test'; // employee
const ANNA = 'anna@mountainhut.test'; // hiker
const BRUNO = 'bruno@mountainhut.test'; // hiker

const HOUR = 60 * 60 * 1000;
// Expected return time of the hikes of the tests: days ago, so that the seed hikes are never overdue at the checked times
const RETURN = Date.now() - 10 * 24 * HOUR;
/** Date `hours` hours after the expected return time. */
const after = (hours) => new Date(RETURN + hours * HOUR);

let tmpDir;
let db;
let server;
let seed;
let checkMissingHikes;

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

async function getMissingHikes(cookie) {
    const res = await fetch(`${BASE_URL}/api/hikes/missing`, {
        headers: cookie ? { Cookie: cookie } : {},
    });
    return { status: res.status, body: await res.json().catch(() => null) };
}

const userIdOf = (email) => db.prepare('SELECT user_id FROM users WHERE email = ?').get(email).user_id;

/** Inserts a hike directly in the database (the API does not accept departures in the past). */
function insertHike({ email = ANNA, arrival = after(0), status = 'scheduled' } = {}) {
    const { lastInsertRowid } = db
        .prepare(
            `INSERT INTO hikes (user_id, destination, route, scheduled_departure, expected_arrival, party_size, status)
             VALUES (?, 'Monte Viso', 'Via the Chiaretto lake', ?, ?, 2, ?)`,
        )
        .run(userIdOf(email), new Date(arrival.getTime() - 6 * HOUR).toISOString(), arrival.toISOString(), status);
    return Number(lastInsertRowid);
}

const alertsOf = (hikeId) =>
    db.prepare('SELECT alert_number, created_at, email_sent_at FROM hike_alerts WHERE hike_id = ? ORDER BY alert_number')
        .all(hikeId);

/** Runs the check at each of the given times, with a mocked sendEmail: returns the mock. */
async function runChecks(...times) {
    const sendEmail = vi.fn().mockResolvedValue();
    for (const now of times) {
        await checkMissingHikes(now, { sendEmail });
    }
    return sendEmail;
}

const subjects = (sendEmail) => sendEmail.mock.calls.map(([email]) => email.subject);

beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-us24-'));
    const dbPath = path.join(tmpDir, 'test.sqlite');
    execFileSync('node', ['db/init-db.js'], { cwd: BACKEND_DIR, env: { ...process.env, DB_PATH: dbPath } });

    db = new DatabaseSync(dbPath);
    seed = db.prepare('SELECT MAX(hike_id) AS hikeId FROM hikes').get();

    // The job and the DAOs open the database of DB_PATH when they are imported
    vi.stubEnv('DB_PATH', dbPath);
    ({ checkMissingHikes } = await import('../../../backend/services/missingHikeJob.js'));

    server = await startServer(dbPath);
}, 20000);

afterEach(() => {
    db.prepare('DELETE FROM hike_alerts').run();
    db.prepare('DELETE FROM hikes WHERE hike_id > ?').run(seed.hikeId);
});

afterAll(async () => {
    vi.unstubAllEnvs();
    db?.close();
    if (server) {
        server.kill();
        await once(server, 'exit');
    }
    try {
        rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
    } catch {
        // Windows: the DAO imported by the test still holds the sqlite file open
    }
});

describe('check of the missing hikers', () => {
    it('does not alert before 2 hours from the expected return time', async () => {
        const hikeId = insertHike();

        const sendEmail = await runChecks(new Date(after(2).getTime() - 60 * 1000));

        expect(alertsOf(hikeId)).toEqual([]);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('creates the first alert 2 hours after the expected return time and emails it to the warden', async () => {
        const hikeId = insertHike();
        const now = after(2);

        const sendEmail = await runChecks(now);

        expect(alertsOf(hikeId)).toEqual([
            { alert_number: 1, created_at: now.toISOString(), email_sent_at: now.toISOString() },
        ]);
        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(sendEmail).toHaveBeenCalledWith({
            to: JULIA,
            subject: '[Mountain Hut] Missing Hiker Alert #1 - Anna Winden',
            text: expect.stringContaining('Alert number: 1 of 5'),
        });
    });

    it('sends a new alert after each following hour, once, until 6 hours are reached', async () => {
        const hikeId = insertHike();

        const sendEmail = await runChecks(after(2), after(2.5), after(3), after(4), after(5), after(6), after(7), after(8));

        expect(alertsOf(hikeId).map((a) => a.alert_number)).toEqual([1, 2, 3, 4, 5]);
        expect(subjects(sendEmail)).toEqual([1, 2, 3, 4, 5].map((n) => `[Mountain Hut] Missing Hiker Alert #${n} - Anna Winden`));
    });

    it('sends a single notification, for the current hour, when the check could not run for hours', async () => {
        const hikeId = insertHike();

        const sendEmail = await runChecks(after(2), after(5.5));

        expect(alertsOf(hikeId).map((a) => a.alert_number)).toEqual([1, 4]);
        expect(subjects(sendEmail)).toEqual([
            '[Mountain Hut] Missing Hiker Alert #1 - Anna Winden',
            '[Mountain Hut] Missing Hiker Alert #4 - Anna Winden',
        ]);
    });

    it('sends the email of an alert again at the next check when it could not be sent', async () => {
        const hikeId = insertHike();
        const failingSendEmail = vi.fn().mockRejectedValue(new Error('SMTP unavailable'));
        await checkMissingHikes(after(2), { sendEmail: failingSendEmail });

        expect(alertsOf(hikeId)).toEqual([
            { alert_number: 1, created_at: after(2).toISOString(), email_sent_at: null },
        ]);

        const sendEmail = await runChecks(after(2.5));

        expect(alertsOf(hikeId)).toEqual([
            { alert_number: 1, created_at: after(2).toISOString(), email_sent_at: after(2.5).toISOString() },
        ]);
        expect(subjects(sendEmail)).toEqual(['[Mountain Hut] Missing Hiker Alert #1 - Anna Winden']);
    });

    it.each(['returned', 'cancelled'])('does not alert a hike that is %s', async (status) => {
        const hikeId = insertHike({ status });

        const sendEmail = await runChecks(after(3));

        expect(alertsOf(hikeId)).toEqual([]);
        expect(sendEmail).not.toHaveBeenCalled();
    });
});

describe('GET `/api/hikes/missing`', () => {
    it('returns the missing hikers with their last alert, the oldest return first', async () => {
        const cookie = await loginAs(CARL);
        const anna = insertHike({ email: ANNA });
        const bruno = insertHike({ email: BRUNO, arrival: after(-1) });
        insertHike({ email: ANNA, arrival: after(2) }); // not missing yet
        await runChecks(after(2), after(3));

        const res = await getMissingHikes(cookie);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject([
            { hikeId: bruno, alertNumber: 3, lastAlertAt: after(3).toISOString(), totalAlerts: 5, hiker: { name: 'Bruno Ryn' } },
            { hikeId: anna, alertNumber: 2, lastAlertAt: after(3).toISOString(), totalAlerts: 5, hiker: { name: 'Anna Winden' } },
        ]);
    });

    it('does not return a hiker who recorded the end of the hike after an alert', async () => {
        const cookie = await loginAs(CARL);
        const hikeId = insertHike();
        await runChecks(after(2));
        db.prepare("UPDATE hikes SET status = 'returned' WHERE hike_id = ?").run(hikeId);

        const res = await getMissingHikes(cookie);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('lets a warden see the missing hikers, as an employee', async () => {
        const cookie = await loginAs(JULIA);
        const hikeId = insertHike();
        await runChecks(after(2));

        const res = await getMissingHikes(cookie);

        expect(res.status).toBe(200);
        expect(res.body.map((h) => h.hikeId)).toEqual([hikeId]);
    });

    it('returns 401 if the user is not logged in', async () => {
        const res = await getMissingHikes(null);

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'UNAUTHORIZED' });
    });

    it('returns 403 if the authenticated user is a hiker', async () => {
        const cookie = await loginAs(ANNA);

        const res = await getMissingHikes(cookie);

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'FORBIDDEN' });
    });
});
