import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../backend');

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
let lastSeedSlotId;

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

function localDate(timestamp) {
  const date = new Date(timestamp);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function localTime(timestamp) {
  const date = new Date(timestamp);

  return [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
  ].join(':');
}

function insertSlot(daysFromNow, hour, menu = null) {
  const start = new Date(TODAY);
  start.setDate(start.getDate() + daysFromNow);
  start.setHours(hour, 0, 0, 0);

  const end = new Date(start.getTime() + 2 * HOUR);

  const startAt = start.toISOString();
  const endAt = end.toISOString();

  const result = db.prepare(`
    INSERT INTO slots (start_at, end_at, menu)
    VALUES (?, ?, ?)
  `).run(startAt, endAt, menu);

  return {
    slotId: Number(result.lastInsertRowid),
    date: localDate(startAt),
    startAt,
    endAt,
    startTime: localTime(startAt),
    endTime: localTime(endAt),
    menu,
  };
}

function assignTable(slotId, tableId = 1) {
  db.prepare(`
    INSERT INTO slot_tables (slot_id, table_id)
    VALUES (?, ?)
  `).run(slotId, tableId);
}

async function getMealsByDate(date) {
  const response = await fetch(
    `${BASE_URL}/api/slots/meals?date=${encodeURIComponent(date)}`
  );

  return {
    status: response.status,
    body: await response.json(),
  };
}

async function getMealBySlotId(slotId) {
  const response = await fetch(
    `${BASE_URL}/api/slots/${slotId}/menu`
  );

  return {
    status: response.status,
    body: await response.json(),
  };
}

function expectedMeal(slot) {
  return {
    slotId: slot.slotId,
    date: slot.date,
    startAt: slot.startAt,
    endAt: slot.endAt,
    startTime: slot.startTime,
    endTime: slot.endTime,
    menu: slot.menu,
  };
}

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-us11-'));

  const dbPath = path.join(tmpDir, 'test.sqlite');

  execFileSync('node', ['db/init-db.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DB_PATH: dbPath },
  });

  db = new DatabaseSync(dbPath);

  lastSeedSlotId = db.prepare(`
    SELECT COALESCE(MAX(slot_id), 0) AS slotId
    FROM slots
  `).get().slotId;

  server = await startServer(dbPath);
}, 20000);

afterEach(() => {

  db.prepare(`
    DELETE FROM slot_tables
    WHERE slot_id > ?
  `).run(lastSeedSlotId);

  db.prepare(`
    DELETE FROM slots
    WHERE slot_id > ?
  `).run(lastSeedSlotId);
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

describe('GET /api/slots/meals', () => {
  it('returns meal times and menus without authentication', async () => {
    const slot = insertSlot(30, 12, MENU);
    assignTable(slot.slotId);

    const res = await getMealsByDate(slot.date);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([expectedMeal(slot)]);
  });

  it('returns only the meals of the selected date', async () => {
    const first = insertSlot(30, 12, 'Menu A');
    const second = insertSlot(31, 12, 'Menu B');

    assignTable(first.slotId);
    assignTable(second.slotId);

    const res = await getMealsByDate(first.date);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([expectedMeal(first)]);
  });

  it('returns meals ordered by their starting time', async () => {
    const evening = insertSlot(30, 19, 'Dinner menu');
    const morning = insertSlot(30, 8, 'Breakfast menu');
    const lunch = insertSlot(30, 12, 'Lunch menu');

    assignTable(evening.slotId);
    assignTable(morning.slotId);
    assignTable(lunch.slotId);

    const res = await getMealsByDate(lunch.date);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expectedMeal(morning),
      expectedMeal(lunch),
      expectedMeal(evening),
    ]);
  });

  it('excludes slots without assigned tables', async () => {
    const bookable = insertSlot(30, 12, 'Bookable menu');
    const notBookable = insertSlot(30, 19, 'Other menu');

    assignTable(bookable.slotId);

    const res = await getMealsByDate(bookable.date);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([expectedMeal(bookable)]);
    expect(res.body.some(meal => meal.slotId === notBookable.slotId))
      .toBe(false);
  });

  it('returns each slot only once when multiple tables are assigned', async () => {
    const slot = insertSlot(30, 12, MENU);

    assignTable(slot.slotId, 1);
    assignTable(slot.slotId, 2);

    const res = await getMealsByDate(slot.date);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([expectedMeal(slot)]);
  });

  it('returns null when a bookable slot has no published menu', async () => {
    const slot = insertSlot(30, 12);
    assignTable(slot.slotId);

    const res = await getMealsByDate(slot.date);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([expectedMeal(slot)]);
    expect(res.body[0].menu).toBeNull();
  });

  it('returns an empty array when no meals are available', async () => {
    const date = localDate(
      new Date(TODAY.getTime() + 365 * DAY).toISOString()
    );

    const res = await getMealsByDate(date);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it.each([
    ['invalid text', 'not-a-date'],
    ['invalid month', '2026-13-01'],
    ['invalid day', '2026-02-30'],
    ['incorrect format', '18-11-2026'],
    ['empty date', ''],
  ])('returns 400 INVALID_DATE for %s', async (_label, date) => {
    const res = await getMealsByDate(date);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_DATE' });
  });

  it('returns 400 INVALID_DATE when the date is missing', async () => {
    const response = await fetch(`${BASE_URL}/api/slots/meals`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'INVALID_DATE',
    });
  });
});

describe('GET /api/slots/:slotId/menu', () => {
  it('returns the meal details without authentication', async () => {
    const slot = insertSlot(30, 12, MENU);

    const res = await getMealBySlotId(slot.slotId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expectedMeal(slot));
  });

  it('preserves the original Markdown formatting of the menu', async () => {
    const markdown = '**Dinner**\n- *Polenta*\n- Soup';
    const slot = insertSlot(30, 19, markdown);

    const res = await getMealBySlotId(slot.slotId);

    expect(res.status).toBe(200);
    expect(res.body.menu).toBe(markdown);
  });

  it('returns null when the menu has not been published', async () => {
    const slot = insertSlot(30, 12);

    const res = await getMealBySlotId(slot.slotId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expectedMeal(slot));
    expect(res.body.menu).toBeNull();
  });

  it('returns a slot even when no tables are assigned', async () => {
    const slot = insertSlot(30, 12, MENU);

    const res = await getMealBySlotId(slot.slotId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expectedMeal(slot));
  });

  it('returns 404 when the slot does not exist', async () => {
    const res = await getMealBySlotId(999999);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: 'SLOT_NOT_FOUND',
    });
  });

  it.each([
    ['non-numeric ID', 'abc'],
    ['zero ID', '0'],
    ['negative ID', '-1'],
    ['decimal ID', '1.5'],
    ['scientific notation', '1e2'],
  ])('returns 400 INVALID_INPUT for %s', async (_label, slotId) => {
    const res = await getMealBySlotId(slotId);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'INVALID_INPUT',
    });
  });
});
