import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// The real backend runs on a temporary copy of the demo database (backend/db/init-db.js):
// routes, DAO and SQLite are all real. Without SMTP credentials the emails are printed
// on the backend output, where the tests read the reset link.
const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const PORT = 3103;
const BASE_URL = `http://localhost:${PORT}`;

// Demo users (password "password")
const ANNA = { user_id: 3, email: 'anna@mountainhut.test' };
const BRUNO = { user_id: 4, email: 'bruno@mountainhut.test' };

let tmpDir;
let db;
let server;
let output = '';

function startServer(dbPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['index.js'], {
      cwd: BACKEND_DIR,
      // MAIL_USER empty: emails are printed, never sent
      env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), MAIL_USER: '' },
    });
    proc.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (chunk.toString().includes('backend running')) resolve(proc);
    });
    proc.on('exit', (code) => reject(new Error(`backend exited with code ${code}`)));
  });
}

async function request(method, url, body) {
  const res = await fetch(`${BASE_URL}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

const login = (email, password) => request('POST', '/api/sessions', { email, password });
const requestReset = (email) => request('POST', '/api/users/password-reset', { email });
const confirmReset = (token, newPassword) => request('POST', '/api/users/password-reset/confirm', { token, newPassword });

// The email is printed asynchronously: wait until a new link appears in the output
async function nextResetToken(previousOutputLength) {
  for (let i = 0; i < 50; i++) {
    const match = output.slice(previousOutputLength).match(/reset-password\?token=([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return null;
}

async function resetLinkFor(email) {
  const before = output.length;
  const res = await requestReset(email);
  expect(res.status).toBe(204);
  return nextResetToken(before);
}

const tokenColumns = (userId) =>
  db.prepare('SELECT reset_token_hash, reset_token_expires_at FROM users WHERE user_id = ?').get(userId);

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  execFileSync('node', ['db/init-db.js'], { cwd: BACKEND_DIR, env: { ...process.env, DB_PATH: dbPath } });

  db = new DatabaseSync(dbPath);
  server = await startServer(dbPath);
}, 20000);

// Every test starts from the demo password and without reset tokens
afterEach(() => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync('password', salt, 32).toString('hex');
  db.prepare(`
    UPDATE users
    SET salt = ?, password_hash = ?, password_to_change = 0, reset_token_hash = NULL, reset_token_expires_at = NULL
  `).run(salt, hash);
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

describe('Password recovery with a reset link', () => {
  it('emails a link, saves only the hash of its token for 24 hours and keeps the current password', async () => {
    const token = await resetLinkFor(ANNA.email);

    const saved = tokenColumns(ANNA.user_id);
    expect(saved.reset_token_hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    const hoursLeft = (new Date(saved.reset_token_expires_at) - Date.now()) / 3600000;
    expect(hoursLeft).toBeGreaterThan(23.9);
    expect((await login(ANNA.email, 'password')).status).toBe(201);
  });

  it('sets the new password with the link, which then cannot be used again', async () => {
    const token = await resetLinkFor(ANNA.email);

    expect((await confirmReset(token, 'new-secret')).status).toBe(204);

    expect((await login(ANNA.email, 'password')).status).toBe(401);
    expect((await login(ANNA.email, 'new-secret')).status).toBe(201);
    const again = await confirmReset(token, 'other-secret');
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('rejects an expired link and keeps the old password', async () => {
    const token = await resetLinkFor(BRUNO.email);
    db.prepare('UPDATE users SET reset_token_expires_at = ? WHERE user_id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), BRUNO.user_id);

    const res = await confirmReset(token, 'new-secret');

    expect(res.body.error).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect((await login(BRUNO.email, 'password')).status).toBe(201);
  });

  it('answers 204 without sending anything when the email is not registered', async () => {
    const before = output.length;

    expect((await requestReset('nobody@example.com')).status).toBe(204);

    expect(await nextResetToken(before)).toBeNull();
  });
});