import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// The real backend runs on a temporary copy of the demo database (backend/db/init-db.js):
// routes, passport, session, DAO and SQLite are all real, nothing is mocked.
const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const PORT = 3102;
const BASE_URL = `http://localhost:${PORT}`;

// Demo user (password "password")
const ANNA = { user_id: 3, name: 'Anna Winden', email: 'anna@mountainhut.test', phone: '+393401234567', role: 'hiker' };
const NEW_USER = { name: 'Mario Rossi', email: 'mario@example.com', phone: '3331234567', password: 'secret1' };

let tmpDir;
let db;
let server;
let seedUserId;

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

const login = (email, password) => request('POST', '/api/sessions', { body: { email, password } });
const currentUser = (cookie) => request('GET', '/api/sessions/current', { cookie });

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  execFileSync('node', ['db/init-db.js'], { cwd: BACKEND_DIR, env: { ...process.env, DB_PATH: dbPath } });

  db = new DatabaseSync(dbPath);
  seedUserId = db.prepare('SELECT MAX(user_id) AS id FROM users').get().id;

  server = await startServer(dbPath);
}, 20000);

// Every test starts from the demo data: remove the users registered by the previous test
afterEach(() => {
  db.prepare('DELETE FROM users WHERE user_id > ?').run(seedUserId);
});

afterAll(async () => {
  if (server && server.exitCode === null) {
    await new Promise((resolve) => {
      server.once('exit', resolve);
      server.kill();
    });
  }

  db?.close();

  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('POST /api/users', () => {
  it('registers the user, stores only the password hash and starts a session', async () => {
    const res = await request('POST', '/api/users', { body: NEW_USER });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      user_id: expect.any(Number),
      name: 'Mario Rossi',
      email: 'mario@example.com',
      phone: '3331234567',
      role: 'hiker',
    });
    const saved = db.prepare('SELECT password_hash FROM users WHERE email = ?').get(NEW_USER.email);
    expect(saved.password_hash).not.toBe(NEW_USER.password);
    expect((await currentUser(res.cookie)).body).toEqual(res.body);
  });

  it('returns 409 when the email is already registered', async () => {
    const res = await request('POST', '/api/users', { body: { ...NEW_USER, email: ANNA.email } });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Email already in use' });
  });

  it('lets the registered user log in with the chosen password', async () => {
    await request('POST', '/api/users', { body: NEW_USER });

    const res = await login(NEW_USER.email, NEW_USER.password);

    expect(res.status).toBe(201);
    expect(res.body.email).toBe(NEW_USER.email);
  });
});

describe('POST /api/sessions', () => {
  it('logs in with valid credentials and keeps the user in the session', async () => {
    const res = await login(ANNA.email, 'password');

    expect(res.status).toBe(201);
    const body = res.body;
    expect(body).toEqual({...ANNA, passwordToChange: false});
    expect(await currentUser(res.cookie)).toMatchObject({ status: 200, body: body });
  });

  it('returns 401 with an error message when the password is wrong', async () => {
    const res = await login(ANNA.email, 'wrong-password');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password.' });
  });
});

describe('GET /api/sessions/current', () => {
  it('returns 401 when the user is not logged in', async () => {
    expect((await currentUser()).status).toBe(401);
  });
});

describe('DELETE /api/sessions/current', () => {
  it('logs out and invalidates the session', async () => {
    const { cookie } = await login(ANNA.email, 'password');

    const res = await request('DELETE', '/api/sessions/current', { cookie });

    expect(res.status).toBe(204);
    expect((await currentUser(cookie)).status).toBe(401);
  });
});



describe('PUT /api/users/password', () => {
  // A registered user whose password must be changed, as after a reservation made by an employee
  async function userWhoMustChangePassword() {
    const registered = await request('POST', '/api/users', { body: NEW_USER });
    expect(registered.status).toBe(201);
    db.prepare('UPDATE users SET password_to_change = 1 WHERE email = ?').run(NEW_USER.email);

    const res = await login(NEW_USER.email, NEW_USER.password);
    expect(res.status).toBe(201);
    expect(res.body.passwordToChange).toBe(true);
    return res.cookie;
  }

  const changePassword = (cookie, newPassword) =>
    request('PUT', '/api/users/password', { cookie, body: { newPassword } });
  const savedUser = () =>
    db.prepare('SELECT password_hash, salt, password_to_change FROM users WHERE email = ?').get(NEW_USER.email);

  it('returns 401 when the user is not logged in', async () => {
    const res = await changePassword(undefined, 'new-secret');

    expect(res.status).toBe(401);
  });

  it('blocks every other API with 403 until the password is changed', async () => {
    const cookie = await userWhoMustChangePassword();

    const reservations = await request('GET', '/api/reservations', { cookie });
    const slots = await request('GET', '/api/slots?date=2030-01-01', { cookie });
    const current = await currentUser(cookie);

    expect(reservations.status).toBe(403);
    expect(reservations.body.error).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(slots.status).toBe(403);
    // the frontend still needs to know who is logged in
    expect(current.status).toBe(200);
    expect(current.body.passwordToChange).toBe(true);
  });

  it('still lets the user log out before changing the password', async () => {
    const cookie = await userWhoMustChangePassword();

    const res = await request('DELETE', '/api/sessions/current', { cookie });

    expect(res.status).toBe(204);
  });

  it('rejects a password shorter than 6 characters and keeps the old one', async () => {
    const cookie = await userWhoMustChangePassword();
    const before = savedUser();

    const res = await changePassword(cookie, '12345');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('The password must contain at least 6 characters.');
    expect({ ...savedUser() }).toEqual({ ...before });
  });

  it('saves the new password with a new salt, clears the flag and unblocks the session', async () => {
    const cookie = await userWhoMustChangePassword();
    const before = savedUser();

    const res = await changePassword(cookie, 'new-secret');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: NEW_USER.email, passwordToChange: false });
    const after = savedUser();
    expect(after.password_to_change).toBe(0);
    expect(after.salt).not.toBe(before.salt);
    expect(after.password_hash).not.toBe(before.password_hash);

    // passport regenerates the session at login: the response carries the new cookie,
    // which the browser stores by itself, and the user is now unblocked
    expect(res.cookie).toBeDefined();
    expect((await currentUser(res.cookie)).body.passwordToChange).toBe(false);
    expect((await request('GET', '/api/reservations', { cookie: res.cookie })).status).toBe(200);
  });

  it('accepts only the new password at the next login', async () => {
    const cookie = await userWhoMustChangePassword();
    await changePassword(cookie, 'new-secret');

    const withOld = await login(NEW_USER.email, NEW_USER.password);
    const withNew = await login(NEW_USER.email, 'new-secret');

    expect(withOld.status).toBe(401);
    expect(withNew.status).toBe(201);
    expect(withNew.body.passwordToChange).toBe(false);
  });

  it('lets a user who is not forced to change it change the password too', async () => {
    const registered = await request('POST', '/api/users', { body: NEW_USER });

    const res = await changePassword(registered.cookie, 'new-secret');

    expect(res.status).toBe(200);
    expect(savedUser().password_to_change).toBe(0);
    expect((await login(NEW_USER.email, 'new-secret')).status).toBe(201);
  });
});
