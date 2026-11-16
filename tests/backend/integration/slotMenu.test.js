import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';

// The real backend runs on a temporary copy of the demo database (backend/db/init-db.js):
// routes, passport, session, DAO and SQLite are all real, nothing is mocked.
const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const PORT = 3108;
const BASE_URL = `http://localhost:${PORT}`;

const EMPLOYEE = 'employee@mountainhut.test';
const HIKER = 'anna@mountainhut.test';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MENU = '**Lunch**\n- Starter\n  - *Polenta* with fontina';

let tmpDir;
let db;
let server;
let lastSeedSlotId;
let today;

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

async function loginAs(email) {
  const res = await fetch(`${BASE_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password' }),
  });
  expect(res.status).toBe(201);
  return res.headers.getSetCookie()[0].split(';')[0];
}

// YYYY-MM-DD in the server's timezone, as used by the API
function localDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// a two-hour slot starting at the given time (ms)
function insertSlotAt(start, menu) {
  const startAt = new Date(start).toISOString();
  const endAt = new Date(start + 2 * HOUR_MS).toISOString();
  const { lastInsertRowid } = db.prepare('INSERT INTO slots (start_at, end_at, menu) VALUES (?, ?, ?)')
    .run(startAt, endAt, menu);
  return { slotId: Number(lastInsertRowid), startAt };
}

// a slot at noon UTC, daysFromNow days after today
const insertSlot = (daysFromNow, menu = null) => insertSlotAt(today.getTime() + daysFromNow * DAY_MS, menu);

// a slot that started an hour ago and is not over yet
const insertStartedSlot = (menu) => insertSlotAt(Date.now() - HOUR_MS, menu);

const menuOf = (slotId) => db.prepare('SELECT menu FROM slots WHERE slot_id = ?').get(slotId).menu;

async function putMenu(cookie, slotId, body) {
  return fetch(`${BASE_URL}/api/slots/${slotId}/menu`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
    body: JSON.stringify(body),
  });
}

async function deleteMenu(cookie, slotId) {
  return fetch(`${BASE_URL}/api/slots/${slotId}/menu`, {
    method: 'DELETE',
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function getMenus(cookie) {
  return fetch(`${BASE_URL}/api/slots/menus`, { headers: cookie ? { Cookie: cookie } : {} });
}

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  execFileSync('node', ['db/init-db.js'], { cwd: BACKEND_DIR, env: { ...process.env, DB_PATH: dbPath } });

  db = new DatabaseSync(dbPath);
  lastSeedSlotId = db.prepare('SELECT MAX(slot_id) AS slotId FROM slots').get().slotId;
  today = new Date();
  today.setUTCHours(12, 0, 0, 0);

  server = await startServer(dbPath);
}, 20000);

// Every test starts from the demo data: remove the slots the previous test created
afterEach(() => {
  db.prepare('DELETE FROM slots WHERE slot_id > ?').run(lastSeedSlotId);
});

afterAll(async () => {
  db?.close();
  if (server) {
    server.kill();
    await once(server, 'exit');
  }
  rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
});

describe('PUT /api/slots/:slotId/menu', () => {
  it('sets the menu of a slot, replacing the old one, keeping its formatting and trimming the spaces around it', async () => {
    const cookie = await loginAs(EMPLOYEE);
    const { slotId } = insertSlot(30, 'Old menu');

    const res = await putMenu(cookie, slotId, { menu: `  ${MENU}\n ` });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slotId, menu: MENU });
    expect(menuOf(slotId)).toBe(MENU);
  });

  it('accepts a menu of 2000 characters without the spaces around it', async () => {
    const cookie = await loginAs(EMPLOYEE);
    const { slotId } = insertSlot(30);
    const menu = 'a'.repeat(2000);

    const res = await putMenu(cookie, slotId, { menu: ` ${menu} ` });

    expect(res.status).toBe(200);
    expect(menuOf(slotId)).toBe(menu);
  });

  it.each([
    ['no menu', {}],
    ['a menu that is not a string', { menu: 42 }],
    ['an empty menu', { menu: '' }],
    ['a menu of only spaces', { menu: ' \n\t ' }],
    ['a menu longer than 2000 characters', { menu: 'a'.repeat(2001) }],
  ])('returns 400 for %s', async (_, body) => {
    const cookie = await loginAs(EMPLOYEE);
    const { slotId } = insertSlot(30);

    const res = await putMenu(cookie, slotId, body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'INVALID_INPUT' });
  });

  it.each(['abc', '0', '1e1'])('returns 400 for the invalid slot id %s', async (slotId) => {
    const cookie = await loginAs(EMPLOYEE);

    const res = await putMenu(cookie, slotId, { menu: MENU });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'INVALID_INPUT' });
  });

  it('returns 404 if the slot does not exist', async () => {
    const cookie = await loginAs(EMPLOYEE);

    const res = await putMenu(cookie, 999999, { menu: MENU });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'SLOT_NOT_FOUND' });
  });

  it('returns 400 if the slot has already started and keeps its menu', async () => {
    const cookie = await loginAs(EMPLOYEE);
    const { slotId } = insertStartedSlot('Old menu');

    const res = await putMenu(cookie, slotId, { menu: MENU });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'SLOT_IN_THE_PAST' });
    expect(menuOf(slotId)).toBe('Old menu');
  });

  it('returns 401 if the user is not logged in', async () => {
    const { slotId } = insertSlot(30);

    const res = await putMenu(null, slotId, { menu: MENU });

    expect(res.status).toBe(401);
  });

  it('returns 403 if a hiker tries to set the menu', async () => {
    const cookie = await loginAs(HIKER);
    const { slotId } = insertSlot(30);

    const res = await putMenu(cookie, slotId, { menu: MENU });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/slots/:slotId/menu', () => {
  it('removes the menu of a slot', async () => {
    const cookie = await loginAs(EMPLOYEE);
    const { slotId } = insertSlot(30, MENU);

    const res = await deleteMenu(cookie, slotId);

    expect(res.status).toBe(204);
    expect(menuOf(slotId)).toBeNull();
  });

  it.each(['abc', '0'])('returns 400 for the invalid slot id %s', async (slotId) => {
    const cookie = await loginAs(EMPLOYEE);

    const res = await deleteMenu(cookie, slotId);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'INVALID_INPUT' });
  });

  it('returns 404 if the slot does not exist', async () => {
    const cookie = await loginAs(EMPLOYEE);

    const res = await deleteMenu(cookie, 999999);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'SLOT_NOT_FOUND' });
  });

  it('returns 400 if the slot has already started and keeps its menu', async () => {
    const cookie = await loginAs(EMPLOYEE);
    const { slotId } = insertStartedSlot(MENU);

    const res = await deleteMenu(cookie, slotId);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'SLOT_IN_THE_PAST' });
    expect(menuOf(slotId)).toBe(MENU);
  });

  it('returns 401 if the user is not logged in', async () => {
    const { slotId } = insertSlot(30);

    const res = await deleteMenu(null, slotId);

    expect(res.status).toBe(401);
  });

  it('returns 403 if a hiker tries to remove the menu', async () => {
    const cookie = await loginAs(HIKER);
    const { slotId } = insertSlot(30);

    const res = await deleteMenu(cookie, slotId);

    expect(res.status).toBe(403);
  });
});

describe('GET /api/slots/menus', () => {
  it('returns each menu once, from the most recently used, without the slots with no menu', async () => {
    const cookie = await loginAs(EMPLOYEE);
    insertSlot(30, 'Menu A');
    const reused = insertSlot(31, 'Menu B');
    const { startAt } = insertSlot(32, 'Menu A');

    const res = await getMenus(cookie);
    const menus = await res.json();

    expect(res.status).toBe(200);
    expect(menus.slice(0, 2)).toEqual([
      { menu: 'Menu A', lastUsedAt: startAt },
      { menu: 'Menu B', lastUsedAt: reused.startAt },
    ]);
    // the demo menus follow, each once
    const texts = menus.map(({ menu }) => menu);
    expect(texts).not.toContain(null);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('returns at most the 50 most recently used menus', async () => {
    const cookie = await loginAs(EMPLOYEE);
    for (let i = 1; i <= 51; i++) insertSlot(30 + i, `Menu ${i}`);

    const menus = await (await getMenus(cookie)).json();

    expect(menus).toHaveLength(50);
    expect(menus[0].menu).toBe('Menu 51');
    expect(menus[49].menu).toBe('Menu 2');
  });

  it('returns 401 if the user is not logged in', async () => {
    const res = await getMenus(null);

    expect(res.status).toBe(401);
  });

  it('returns 403 if a hiker asks for the menus', async () => {
    const cookie = await loginAs(HIKER);

    const res = await getMenus(cookie);

    expect(res.status).toBe(403);
  });
});

describe('menu of the slots in the capacity view and in the weekly copy', () => {
  it('returns the menu of each slot, null if not defined', async () => {
    const cookie = await loginAs(EMPLOYEE);
    const withMenu = insertSlot(30, MENU);
    const withoutMenu = insertSlot(31);
    const params = new URLSearchParams({ from: localDate(withMenu.startAt), to: localDate(withoutMenu.startAt) });

    const res = await fetch(`${BASE_URL}/api/slots/capacity?${params}`, { headers: { Cookie: cookie } });

    expect(res.status).toBe(200);
    expect((await res.json()).map(({ slotId, menu }) => ({ slotId, menu }))).toEqual([
      { slotId: withMenu.slotId, menu: MENU },
      { slotId: withoutMenu.slotId, menu: null },
    ]);
  });

  it.each([
    [true, MENU],
    [false, null],
  ])('copies the menu to the next week only if copyMenu is %s', async (copyMenu, expected) => {
    const cookie = await loginAs(EMPLOYEE);
    const source = insertSlot(70, MENU);

    const res = await fetch(`${BASE_URL}/api/slots/copy-week`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ fromDate: localDate(source.startAt), toDate: localDate(new Date(Date.parse(source.startAt) + 7 * DAY_MS)), copyMenu }),
    });

    expect(res.status).toBe(201);
    const { created } = await res.json();
    expect(created).toHaveLength(1);
    expect(menuOf(created[0].slotId)).toBe(expected);
  });
});
