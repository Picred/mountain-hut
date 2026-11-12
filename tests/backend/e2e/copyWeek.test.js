import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, it } from 'vitest';

const BACKEND_URL = 'http://localhost:3002';
const BACKEND_DIR = new URL('../../../backend', import.meta.url);

beforeAll(async () => {
  execFileSync('node', ['db/init-db.js', '--reset'], { cwd: BACKEND_DIR });
  await import('../../../backend/index.js');
});

function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekDate(weeksAhead, dayOffset) {
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + weeksAhead * 7);
  monday.setDate(monday.getDate() + dayOffset);
  return monday;
}

function dateTime(date, hour, minute = 0) {
  const value = new Date(date);
  value.setHours(hour, minute, 0, 0);
  return value.toISOString();
}

async function loginAs(email) {
  const agent = request.agent(BACKEND_URL);
  const response = await agent.post('/api/sessions').send({ email, password: 'password' });
  expect(response.status).toBe(201);
  return agent;
}

async function createSlot(employee, date, hour, durationHours = 1) {
  const startAt = dateTime(date, hour);
  const endAt = dateTime(date, hour + durationHours);
  const response = await employee.post('/api/slots').send({ startAt, endAt });
  expect(response.status).toBe(201);
  return response.body;
}

async function addTables(employee, slotId, tableIds) {
  const response = await employee.post(`/api/slots/${slotId}/tables`).send({ tableIds });
  expect(response.status).toBe(201);
  return response.body;
}

function addMenu(slotId, dishIds) {
  const db = new DatabaseSync(process.env.DB_PATH);
  try {
    const insert = db.prepare('INSERT INTO slots_dishes (slot_id, dish_id) VALUES (?, ?)');
    for (const dishId of dishIds) insert.run(slotId, dishId);
  } finally {
    db.close();
  }
}

function getMenu(slotId) {
  const db = new DatabaseSync(process.env.DB_PATH);
  try {
    return db.prepare('SELECT dish_id FROM slots_dishes WHERE slot_id = ? ORDER BY dish_id')
      .all(slotId)
      .map(({ dish_id }) => dish_id);
  } finally {
    db.close();
  }
}

function getSlotsInRange(from, to) {
  const db = new DatabaseSync(process.env.DB_PATH);
  try {
    return db.prepare(`
      SELECT slot_id AS slotId, start_at AS startAt
      FROM slots
      WHERE DATE(start_at, 'localtime') BETWEEN ? AND ?
      ORDER BY start_at
    `).all(from, to);
  } finally {
    db.close();
  }
}

const sameLocalDayAndTime = (left, right) => {
  const a = new Date(left);
  const b = new Date(right);
  return [
    a.getFullYear(), a.getMonth(), a.getDate(), a.getHours(), a.getMinutes(),
  ].join(':') === [
    b.getFullYear(), b.getMonth(), b.getDate(), b.getHours(), b.getMinutes(),
  ].join(':');
};

describe('POST /api/slots/copy-week e2e', () => {
  it('requires an employee session', async () => {
    const anonymous = await request(BACKEND_URL)
      .post('/api/slots/copy-week')
      .send({ fromDate: '2027-01-04', toDate: '2027-01-11' });
    expect(anonymous.status).toBe(401);

    const hiker = await loginAs('anna@mountainhut.test');
    const forbidden = await hiker.post('/api/slots/copy-week')
      .send({ fromDate: '2027-01-04', toDate: '2027-01-11' });
    expect(forbidden.status).toBe(403);
  });

  it('rejects invalid dates, options, identical weeks, and an empty source week', async () => {
    const employee = await loginAs('employee@mountainhut.test');
    const sourceDate = localDate(weekDate(20, 1));
    const nextWeekDate = localDate(weekDate(21, 1));

    const invalidDate = await employee.post('/api/slots/copy-week')
      .send({ fromDate: 'not-a-date', toDate: nextWeekDate });
    expect(invalidDate.status).toBe(400);

    const invalidOption = await employee.post('/api/slots/copy-week')
      .send({ fromDate: sourceDate, toDate: nextWeekDate, copyTables: 'false' });
    expect(invalidOption.status).toBe(400);

    const sameWeek = await employee.post('/api/slots/copy-week')
      .send({ fromDate: sourceDate, toDate: localDate(weekDate(20, 5)) });
    expect(sameWeek.status).toBe(400);
    expect(sameWeek.body.error).toBe('SOURCE_WEEK_IN_TARGET_WEEKS');

    const emptySource = await employee.post('/api/slots/copy-week')
      .send({ fromDate: sourceDate, toDate: nextWeekDate });
    expect(emptySource.status).toBe(400);
    expect(emptySource.body.error).toBe('NO_SLOTS_TO_COPY');
  });

  it('copies a weekly schedule, tables, and menu while replacing an unreserved target week', async () => {
    const employee = await loginAs('employee@mountainhut.test');
    const hiker = await loginAs('anna@mountainhut.test');
    const sourceTuesday = weekDate(24, 1);
    const sourceThursday = weekDate(24, 3);
    const targetTuesday = weekDate(25, 1);
    const targetThursday = weekDate(25, 3);
    const oldTargetWednesday = weekDate(25, 2);

    const sourceLunch = await createSlot(employee, sourceTuesday, 11);
    const sourceDinner = await createSlot(employee, sourceThursday, 18, 2);
    await addTables(employee, sourceLunch.slotId, [1, 2]);
    await addTables(employee, sourceDinner.slotId, [3, 5]);
    addMenu(sourceLunch.slotId, [1, 2]);
    addMenu(sourceDinner.slotId, [3, 6]);

    const oldTarget = await createSlot(employee, oldTargetWednesday, 14);
    await addTables(employee, oldTarget.slotId, [4]);
    addMenu(oldTarget.slotId, [5]);
    const oldReservation = await hiker.post('/api/reservations')
      .send({ slotId: oldTarget.slotId, partySize: 1 });
    expect(oldReservation.status).toBe(201);
    const cancelled = await hiker.delete(`/api/reservations/${oldReservation.body.reservationId}`);
    expect(cancelled.status).toBe(200);

    const response = await employee.post('/api/slots/copy-week').send({
      fromDate: localDate(sourceThursday),
      toDate: localDate(targetTuesday),
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      fromWeek: localDate(weekDate(24, 0)),
      toWeek: localDate(weekDate(25, 0)),
      copyTables: true,
      copyMenu: true,
      skipped: [],
    });
    expect(response.body.created).toHaveLength(2);
    expect(response.body.created.map(({ startAt }) => startAt)).toEqual([
      expect.any(String),
      expect.any(String),
    ]);

    const sourceSlots = [
      { slot: sourceLunch, date: sourceTuesday },
      { slot: sourceDinner, date: sourceThursday },
    ];
    const createdSlots = response.body.created;
    for (const { slot, date } of sourceSlots) {
      const expectedDate = new Date(date);
      expectedDate.setDate(expectedDate.getDate() + 7);
      const matching = createdSlots.find(({ startAt }) =>
        sameLocalDayAndTime(startAt, dateTime(expectedDate, date === sourceTuesday ? 11 : 18))
      );
      expect(matching).toBeDefined();
      expect(matching.tables.map(({ tableId }) => tableId)).toEqual(
        slot.slotId === sourceLunch.slotId ? [1, 2] : [3, 5]
      );
      expect(getMenu(matching.slotId)).toEqual(
        slot.slotId === sourceLunch.slotId ? [1, 2] : [3, 6]
      );
    }

    const targetSlots = getSlotsInRange(
      localDate(weekDate(25, 0)),
      localDate(weekDate(25, 6))
    );
    expect(targetSlots).toHaveLength(2);
    expect(targetSlots.some(({ slotId }) => slotId === oldTarget.slotId)).toBe(false);
    const removedReservation = new DatabaseSync(process.env.DB_PATH);
    try {
      expect(removedReservation.prepare('SELECT COUNT(*) AS count FROM reservations WHERE reservation_id = ?')
        .get(oldReservation.body.reservationId).count).toBe(0);
    } finally {
      removedReservation.close();
    }
  });

  it('can copy slots without copying tables or menu', async () => {
    const employee = await loginAs('employee@mountainhut.test');
    const sourceDate = weekDate(28, 2);
    const targetDate = weekDate(29, 2);
    const source = await createSlot(employee, sourceDate, 12);
    await addTables(employee, source.slotId, [1, 3]);
    addMenu(source.slotId, [2, 4]);

    const response = await employee.post('/api/slots/copy-week').send({
      fromDate: localDate(sourceDate),
      toDate: localDate(targetDate),
      copyTables: false,
      copyMenu: false,
    });

    expect(response.status).toBe(201);
    expect(response.body.copyTables).toBe(false);
    expect(response.body.copyMenu).toBe(false);
    expect(response.body.created).toHaveLength(1);
    expect(response.body.created[0].tables).toEqual([]);
    expect(getMenu(response.body.created[0].slotId)).toEqual([]);
  });

  it('does not replace any target slots when one has an active reservation', async () => {
    const employee = await loginAs('employee@mountainhut.test');
    const hiker = await loginAs('bruno@mountainhut.test');
    const sourceDate = weekDate(32, 1);
    const targetDate = weekDate(33, 1);
    const source = await createSlot(employee, sourceDate, 11);
    const targetWithoutBooking = await createSlot(employee, weekDate(33, 2), 11);
    const targetWithBooking = await createSlot(employee, targetDate, 11);
    await addTables(employee, targetWithBooking.slotId, [1]);

    const booking = await hiker.post('/api/reservations')
      .send({ slotId: targetWithBooking.slotId, partySize: 2 });
    expect(booking.status).toBe(201);

    const targetMonday = localDate(weekDate(33, 0));
    const targetSunday = localDate(weekDate(33, 6));
    const before = getSlotsInRange(targetMonday, targetSunday);

    const response = await employee.post('/api/slots/copy-week').send({
      fromDate: localDate(sourceDate),
      toDate: localDate(targetDate),
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('SLOT_HAS_RESERVATIONS');
    expect(getSlotsInRange(targetMonday, targetSunday)).toEqual(before);
    expect(getSlotsInRange(
      localDate(weekDate(32, 0)),
      localDate(weekDate(32, 6))
    )).toHaveLength(1);
    expect(before.map(({ slotId }) => slotId)).toContain(targetWithoutBooking.slotId);
  });
});
