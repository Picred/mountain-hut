import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll } from 'vitest';

const BACKEND_URL = 'http://localhost:3002'; // PORT, see backend/vitest.config.js

// Demo tables (backend/db/init-db.js)
const T1 = 1; // 4 seats
const T2 = 2; // 4 seats
const T3 = 3; // 6 seats
const T4 = 4; // 2 seats

// Recreate the e2e database (DB_PATH, see backend/vitest.config.js) from the demo data, then start the backend
beforeAll(async () => {
  execFileSync('node', ['db/init-db.js', '--reset'], { cwd: new URL('../../../backend', import.meta.url) });
  await import('../../../backend/index.js');
});

// ISO timestamp of a local time, far enough in the future not to overlap the demo slots
function at(dayOffset, hours, minutes = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

async function loginAs(email) {
  const agent = request.agent(BACKEND_URL);
  const res = await agent.post('/api/sessions').send({ email, password: 'password' });
  expect(res.status).toBe(201);
  return agent;
}

const loginEmployee = () => loginAs('employee@mountainhut.test');
const loginHiker = () => loginAs('anna@mountainhut.test');

async function createSlot(employee, startAt, endAt) {
  return employee.post('/api/slots').send({ startAt, endAt });
}

describe('Capacity e2e', () => {
  it('only employees can manage slots and tables', async () => {
    const anonymous = request(BACKEND_URL);
    expect((await anonymous.get('/api/slots/capacity')).status).toBe(401);

    const hiker = await loginHiker();
    expect((await hiker.get('/api/slots/capacity')).status).toBe(403);
    expect((await hiker.get('/api/tables')).status).toBe(403);
    expect((await createSlot(hiker, at(40, 12), at(40, 13))).status).toBe(403);
  });

  it('accepts customers only up to the seats defined for the slot', async () => {
    const employee = await loginEmployee();
    const hiker = await loginHiker();

    // A new slot has no tables: nobody can book it
    const created = await createSlot(employee, at(40, 12), at(40, 13));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ hasTables: false, totalSeats: 0, tables: [] });
    const { slotId } = created.body;

    const noTables = await hiker.post('/api/reservations').send({ slotId, partySize: 2 });
    expect(noTables.status).toBe(409);
    expect(noTables.body.error).toBe('NO_AVAILABILITY');

    // T1 (4) + T4 (2) = 6 seats
    const assigned = await employee.post(`/api/slots/${slotId}/tables`).send({ tableIds: [T1, T4] });
    expect(assigned.status).toBe(201);
    expect(assigned.body.totalSeats).toBe(6);

    const tooMany = await hiker.post('/api/reservations').send({ slotId, partySize: 7 });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error).toBe('NO_AVAILABILITY');

    const fits = await hiker.post('/api/reservations').send({ slotId, partySize: 6 });
    expect(fits.status).toBe(201);
  });

  it('allows slots of any start time and duration in the same meal service, but not overlapping', async () => {
    const employee = await loginEmployee();

    const first = await createSlot(employee, at(41, 12), at(41, 13));
    const second = await createSlot(employee, at(41, 13), at(41, 14, 30));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const overlapping = await createSlot(employee, at(41, 12, 30), at(41, 13, 30));
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.error).toBe('SLOT_OVERLAP');

    const date = at(41, 12).slice(0, 10);
    const listed = await employee.get(`/api/slots/capacity?from=${date}&to=${date}`);
    expect(listed.body.map((s) => s.slotId)).toEqual([first.body.slotId, second.body.slotId]);
  });

  it('reuses the tables of a previous slot without entering them again', async () => {
    const employee = await loginEmployee();
    const lunch = (await createSlot(employee, at(42, 12), at(42, 13))).body;
    const dinner = (await createSlot(employee, at(42, 19), at(42, 20))).body;
    const lunchTables = (await employee.post(`/api/slots/${lunch.slotId}/tables`).send({ tableIds: [T2, T3] })).body;

    const copied = await employee.post(`/api/slots/${dinner.slotId}/copy-tables`).send({ fromSlotId: lunch.slotId });

    expect(copied.status).toBe(201);
    expect(copied.body.tables).toEqual(lunchTables.tables);
    expect(copied.body.totalSeats).toBe(10);
  });

  it('lets each slot have its own set of tables, including new ones', async () => {
    const employee = await loginEmployee();
    const code = 'T6';

    const newTable = await employee.post('/api/tables').send({ code, seats: 8 });
    expect(newTable.status).toBe(201);
    expect((await employee.get('/api/tables')).body).toContainEqual(newTable.body);

    const sunny = (await createSlot(employee, at(43, 12), at(43, 13))).body;
    const rainy = (await createSlot(employee, at(44, 12), at(44, 13))).body;
    const sunnyTables = await employee.post(`/api/slots/${sunny.slotId}/tables`).send({ tableIds: [T1, newTable.body.tableId] });
    const rainyTables = await employee.post(`/api/slots/${rainy.slotId}/tables`).send({ tableIds: [T4] });

    expect(sunnyTables.body.tables.map((t) => t.code)).toEqual(['T1', code]);
    expect(sunnyTables.body.totalSeats).toBe(12);
    expect(rainyTables.body.tables.map((t) => t.code)).toEqual(['T4']);
    expect(rainyTables.body.totalSeats).toBe(2);
  });
});
