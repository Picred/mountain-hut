import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sqlite from 'sqlite3';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, 'db.sqlite');


// Dates in UTC, format ISO 8601
const DAY_MS = 24 * 60 * 60 * 1000;
const TODAY = new Date();
TODAY.setUTCHours(0, 0, 0, 0);

const at = (dayOffset, hour, minute = 0) =>
  new Date(TODAY.getTime() + dayOffset * DAY_MS + (hour * 60 + minute) * 60000).toISOString();
const hoursAgo = h => new Date(Date.now() - h * 3600000).toISOString();

const DEMO_PASSWORD = 'password';

const USERS = [
  { id: 1, name: 'Julia White', email: 'warden@mountainhut.test', phone: '0165123456', role: 'warden' },
  { id: 2, name: 'Carl Smith', email: 'employee@mountainhut.test', phone: '3331234567', role: 'employee' },
  { id: 3, name: 'Anna Winden',     email: 'anna@mountainhut.test',     phone: '+393401234567', role: 'hiker' },
  { id: 4, name: 'Bruno Ryn',    email: 'bruno@mountainhut.test',    phone: '0112345678',    role: 'hiker' },
  { id: 5, name: 'Edward Coles',    email: 'edward@mountainhut.test',    phone: null,            role: 'hiker' },
  { id: 6, name: 'Niccolo Cristoforetti', email: 's359369@studenti.polito.it', phone: '+393401234567', role: 'hiker' },
  { id: 7, name: 'Letizia Pontarolo', email: 's352496@studenti.polito.it', phone: '0112345678', role: 'hiker' },
  { id: 8, name: 'Caterina Maccarini', email: 's336160@studenti.polito.it', phone: null, role: 'hiker' },
];

const TABLES = [
  { id: 1, code: 'T1', seats: 4 },
  { id: 2, code: 'T2', seats: 4 },
  { id: 3, code: 'T3', seats: 6 },
  { id: 4, code: 'T4', seats: 2 },
  { id: 5, code: 'T5', seats: 2 },
];

const SLOTS = [
  { id: 1, start: at(1, 11), end: at(1, 12) },
  { id: 2, start: at(1, 12), end: at(1, 13) },
  { id: 3, start: at(1, 17, 30), end: at(1, 19) },
  { id: 4, start: at(2, 11), end: at(2, 12) },
  { id: 5, start: at(2, 12), end: at(2, 13) },
];

const SLOT_TABLES = {
  1: [1, 2, 3, 4, 5],
  2: [1, 2, 3, 4, 5],
  3: [1, 2, 3, 4, 5],
  4: [1, 3],
};

const DISHES = [
  { id: 1, name: 'Mountain cold cuts', description: 'Local cured meats and lard',     price: 9,  course: 'starter' },
  { id: 2, name: 'Polenta concia', description: 'Polenta with fontina and butter', price: 11, course: 'first' },
  { id: 3, name: 'Barley soup', description: 'Barley, vegetables and speck',   price: 10, course: 'first' },
  { id: 4, name: 'Braised beef with polenta', description: 'Beef braised in red wine',     price: 15, course: 'main' },
  { id: 5, name: 'Alpine pasture cheeses', description: 'Selection with honey and walnuts', price: 13, course: 'main' },
  { id: 6, name: 'Apple strudel', description: 'With vanilla custard',           price: 6,  course: 'dessert' },
  { id: 7, name: 'Hazelnut cake', description: 'Made without wheat flour',       price: 6,  course: 'dessert' },
];

const MENU = {
  1: [1, 2, 4, 6],
  2: [1, 3, 4, 6],
  3: [2, 5, 7],
  4: [1, 2, 5, 6],
};

const RESERVATIONS = [
  { id: 1, slotId: 1, userId: 3, createdBy: 3, partySize: 5, createdAt: hoursAgo(72),
    seats: [[3, 5]], requirements: [[2, 'vegetarian', 0]] },
  { id: 2, slotId: 1, userId: 4, createdBy: 4, partySize: 4, createdAt: hoursAgo(30),
    seats: [[1, 4]] },
//unregistered 
  { id: 3, slotId: 1, guestName: 'Mark Rossi', guestPhone: '0123456789', createdBy: 2, partySize: 2, createdAt: hoursAgo(2),
    seats: [[4, 2]] },
//party splitted in two tables
  { id: 4, slotId: 2, userId: 5, createdBy: 5, partySize: 8, createdAt: hoursAgo(10),
    seats: [[1, 4], [2, 4]], requirements: [[3, 'lactose free', 1]] },
//two partis in same table
  { id: 5, slotId: 2, userId: 3, createdBy: 3, partySize: 2, createdAt: hoursAgo(5),
    seats: [[3, 2]] },
  { id: 6, slotId: 2, userId: 4, createdBy: 4, partySize: 3, createdAt: hoursAgo(4),
    seats: [[3, 3]] },
//cancelled reservation
  { id: 7, slotId: 2, userId: 4, createdBy: 4, partySize: 2, status: 'cancelled', createdAt: hoursAgo(20) },
  { id: 8, slotId: 3, userId: 5, createdBy: 5, partySize: 3, createdAt: hoursAgo(1),
    seats: [[5, 2], [4, 1]], requirements: [[1, 'celiac', 1]] },
];


const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT    NOT NULL,
  salt          TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'hiker'
                CHECK (role IN ('hiker', 'employee', 'warden'))
);

CREATE TABLE slots (
  slot_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  start_at TEXT NOT NULL,
  end_at   TEXT NOT NULL,
  CHECK (end_at > start_at)
);

CREATE INDEX idx_slots_start_at ON slots (start_at);

CREATE TABLE tables (
  table_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  table_code TEXT    NOT NULL,
  seats      INTEGER NOT NULL CHECK (seats > 0),
  -- code can repeat itself (T1 of 4, T1 of 6), but not with same number of seats
  UNIQUE (table_code, seats)
);

CREATE TABLE slot_tables (
  slot_table_id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id       INTEGER NOT NULL REFERENCES slots (slot_id)   ON DELETE CASCADE,
  table_id      INTEGER NOT NULL REFERENCES tables (table_id) ON DELETE RESTRICT,
  UNIQUE (slot_id, table_id)
);

CREATE TABLE dishes (
  dish_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  price       REAL CHECK (price IS NULL OR price >= 0),
  course      TEXT
);

CREATE TABLE slots_dishes (
  slot_id INTEGER NOT NULL REFERENCES slots (slot_id)  ON DELETE CASCADE,
  dish_id INTEGER NOT NULL REFERENCES dishes (dish_id) ON DELETE RESTRICT,
  PRIMARY KEY (slot_id, dish_id)
);

CREATE TABLE reservations (
  reservation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id        INTEGER NOT NULL REFERENCES slots (slot_id) ON DELETE RESTRICT,
  user_id        INTEGER          REFERENCES users (user_id) ON DELETE RESTRICT,
  guest_name     TEXT,
  guest_phone    TEXT,
  created_by     INTEGER NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT,
  party_size     INTEGER NOT NULL CHECK (party_size > 0),
  status         TEXT    NOT NULL DEFAULT 'confirmed'
                 CHECK (status IN ('confirmed', 'cancelled', 'waiting')),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL)
);

CREATE INDEX idx_reservations_slot_status ON reservations (slot_id, status);
CREATE INDEX idx_reservations_user        ON reservations (user_id);

CREATE TABLE reservation_table (
  reservation_id  INTEGER NOT NULL REFERENCES reservations (reservation_id) ON DELETE CASCADE,
  slot_table_id   INTEGER NOT NULL REFERENCES slot_tables (slot_table_id)   ON DELETE RESTRICT,
  allocated_seats INTEGER NOT NULL CHECK (allocated_seats > 0),
  PRIMARY KEY (reservation_id, slot_table_id)
);

CREATE INDEX idx_reservation_table_slot_table ON reservation_table (slot_table_id);

CREATE TABLE reservation_requirements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations (reservation_id) ON DELETE CASCADE,
  people_count   INTEGER NOT NULL CHECK (people_count > 0),
  description    TEXT    NOT NULL,
  is_allergy     INTEGER NOT NULL DEFAULT 0 CHECK (is_allergy IN (0, 1))
);

CREATE INDEX idx_requirements_reservation ON reservation_requirements (reservation_id);
`;


const hashPassword = (password, salt) =>
  crypto.scryptSync(password, salt, 32).toString('hex');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));
}
const all = (db, sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
const exec = (db, sql) =>
  new Promise((resolve, reject) => db.exec(sql, err => (err ? reject(err) : resolve())));
const close = db =>
  new Promise((resolve, reject) => db.close(err => (err ? reject(err) : resolve())));


async function verify(db) {
  const badFk = await all(db, 'PRAGMA foreign_key_check');
  if (badFk.length) throw new Error('foreign_key_check failed');

  const badSum = await all(db, `
    SELECT r.reservation_id
    FROM reservations r
    LEFT JOIN reservation_table rt ON rt.reservation_id = r.reservation_id
    WHERE r.status = 'confirmed'
    GROUP BY r.reservation_id
    HAVING COALESCE(SUM(rt.allocated_seats), 0) <> r.party_size`);
  if (badSum.length)
    throw new Error(`Reservation ${badSum.map(r => r.reservation_id)}: allocated seats differ from party_size`);

  const overbooked = await all(db, `
    SELECT st.slot_table_id
    FROM slot_tables st
    JOIN tables t ON t.table_id = st.table_id
    JOIN reservation_table rt ON rt.slot_table_id = st.slot_table_id
    GROUP BY st.slot_table_id
    HAVING SUM(rt.allocated_seats) > t.seats`);
  if (overbooked.length)
    throw new Error(`Slot table ${overbooked.map(r => r.slot_table_id)} has more seats allocated than it has`);
}


const RESET = process.argv.includes('--reset');

async function main() {
  if (fs.existsSync(DB_PATH)) {
    if (!RESET) {
      console.log(`Database already exists at ${DB_PATH}, nothing to do (use --reset to recreate it)`);
      return;
    }
    fs.unlinkSync(DB_PATH);
  }

  const db = new sqlite.Database(DB_PATH);
  let failed = false;

  try {
    await exec(db, SCHEMA);
    await run(db, 'BEGIN');

    for (const u of USERS) {
      const salt = crypto.randomBytes(16).toString('hex');
      await run(db,
        'INSERT INTO users (user_id, name, email, phone, password_hash, salt, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [u.id, u.name, u.email, u.phone, hashPassword(DEMO_PASSWORD, salt), salt, u.role]);
    }

    for (const t of TABLES)
      await run(db, 'INSERT INTO tables (table_id, table_code, seats) VALUES (?, ?, ?)', [t.id, t.code, t.seats]);

    for (const s of SLOTS)
      await run(db, 'INSERT INTO slots (slot_id, start_at, end_at) VALUES (?, ?, ?)', [s.id, s.start, s.end]);

    for (const [slotId, tableIds] of Object.entries(SLOT_TABLES))
      for (const tableId of tableIds)
        await run(db, 'INSERT INTO slot_tables (slot_id, table_id) VALUES (?, ?)', [slotId, tableId]);

    for (const d of DISHES)
      await run(db,
        'INSERT INTO dishes (dish_id, name, description, price, course) VALUES (?, ?, ?, ?, ?)',
        [d.id, d.name, d.description, d.price, d.course]);

    for (const [slotId, dishIds] of Object.entries(MENU))
      for (const dishId of dishIds)
        await run(db, 'INSERT INTO slots_dishes (slot_id, dish_id) VALUES (?, ?)', [slotId, dishId]);

    for (const r of RESERVATIONS) {
      await run(db,
        `INSERT INTO reservations
           (reservation_id, slot_id, user_id, guest_name, guest_phone, created_by, party_size, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.slotId, r.userId ?? null, r.guestName ?? null, r.guestPhone ?? null,
         r.createdBy, r.partySize, r.status ?? 'confirmed', r.createdAt]);

      for (const [tableId, seats] of r.seats ?? []) {
        const res = await run(db,
          `INSERT INTO reservation_table (reservation_id, slot_table_id, allocated_seats)
           SELECT r.reservation_id, st.slot_table_id, ?
           FROM reservations r
           JOIN slot_tables st ON st.slot_id = r.slot_id
           WHERE r.reservation_id = ? AND st.table_id = ?`,
          [seats, r.id, tableId]);
        if (res.changes !== 1)
          throw new Error(`Reservation ${r.id}: table ${tableId} is not available in slot ${r.slotId}`);
      }

      for (const [people, description, isAllergy] of r.requirements ?? [])
        await run(db,
          'INSERT INTO reservation_requirements (reservation_id, people_count, description, is_allergy) VALUES (?, ?, ?, ?)',
          [r.id, people, description, isAllergy]);
    }

    await verify(db);
    await run(db, 'COMMIT');

    console.log(`Database created at ${DB_PATH}`);
    console.log(`  ${USERS.length} users, ${SLOTS.length} slots, ${TABLES.length} tables, ` +
                `${DISHES.length} dishes, ${RESERVATIONS.length} reservations`);
    console.log(`  All demo users have password "${DEMO_PASSWORD}"`);
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    failed = true;
    console.error('Database creation failed:', err.message);
    process.exitCode = 1;
  } finally {
    await close(db);
  }

  if (failed) fs.rmSync(DB_PATH, { force: true });
}

main();