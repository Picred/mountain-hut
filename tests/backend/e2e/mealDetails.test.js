import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

const BACKEND_URL = 'http://localhost:3002';
const BACKEND_DIR = new URL('../../../backend', import.meta.url);

// Demo tables
const T1 = 1; // 4 seats
const T2 = 2; // 4 seats
const T3 = 3; // 6 seats

// Demo menus
const DEMO_LUNCH_MENU = `**Lunch menu**
- Starter
  - Mountain cold cuts
- First course
  - *Polenta concia* with fontina and butter
- Dessert
  - Apple strudel`;

const DEMO_DINNER_MENU = `**Dinner menu**
- First course
  - Barley soup with speck
- Main course
  - *Braised beef* with polenta
  - Alpine pasture cheeses
- Dessert
  - Hazelnut cake (*gluten free*)`;

function localDate(dayOffset = 1) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function at(dayOffset, hours, minutes = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function localDateFromIso(iso) {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function loginAs(email, password = 'password') {
  const agent = request.agent(BACKEND_URL);
  const res = await agent.post('/api/sessions').send({ email, password });
  expect(res.status).toBe(201);
  return agent;
}

const loginEmployee = () => loginAs('employee@mountainhut.test');
const loginHiker = () => loginAs('anna@mountainhut.test');

async function waitForServer(url = BACKEND_URL, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

beforeAll(async () => {
  execFileSync('node', ['db/init-db.js', '--reset'], { cwd: BACKEND_DIR });
  try {
    await import('../../../backend/index.js');
  } catch {
    // Backend may already be running if started by another test file
  }
  await waitForServer();
});

describe('Meal times and menu e2e', () => {
  describe('GET /api/slots/meals?date=YYYY-MM-DD', () => {
    it('allows unauthenticated users to view meal times and menus for a given date', async () => {
      const anonymous = request(BACKEND_URL);
      const tomorrow = localDate(1);

      const res = await anonymous.get(`/api/slots/meals?date=${tomorrow}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(3);

      // Demo slots 1, 2, 3 are scheduled for day +1 with tables and menus
      expect(res.body.map((s) => s.slotId)).toEqual([1, 2, 3]);
      expect(res.body[0]).toMatchObject({
        slotId: 1,
        date: tomorrow,
        startAt: expect.any(String),
        endAt: expect.any(String),
        startTime: expect.stringMatching(/^\d{2}:\d{2}$/),
        endTime: expect.stringMatching(/^\d{2}:\d{2}$/),
        menu: DEMO_LUNCH_MENU,
      });
      expect(res.body[1].menu).toBe(DEMO_DINNER_MENU);
      expect(res.body[2].menu).toBe(DEMO_LUNCH_MENU);
    });

    it('also works for an authenticated hiker', async () => {
      const hiker = await loginHiker();
      const tomorrow = localDate(1);

      const res = await hiker.get(`/api/slots/meals?date=${tomorrow}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
    });

    it('returns slots ordered chronologically by startAt and includes slots with null menu', async () => {
      const anonymous = request(BACKEND_URL);
      // Day +8 in demo data has slots 6, 7, 8 with tables assigned and menu = null
      const day8 = localDate(8);

      const res = await anonymous.get(`/api/slots/meals?date=${day8}`);

      expect(res.status).toBe(200);
      expect(res.body.map((s) => s.slotId)).toEqual([6, 7, 8]);

      for (let i = 1; i < res.body.length; i += 1) {
        expect(new Date(res.body[i].startAt).getTime())
          .toBeGreaterThan(new Date(res.body[i - 1].startAt).getTime());
      }

      for (const meal of res.body) {
        expect(meal.date).toBe(day8);
        expect(meal.menu).toBeNull();
      }
    });

    it('excludes slots that have no tables assigned', async () => {
      const anonymous = request(BACKEND_URL);
      // Day +2 in demo data has slot 4 (with tables [1, 3]) and slot 5 (with NO tables)
      const day2 = localDate(2);

      const res = await anonymous.get(`/api/slots/meals?date=${day2}`);

      expect(res.status).toBe(200);
      expect(res.body.map((s) => s.slotId)).toEqual([4]);
      expect(res.body[0].menu).toBe(DEMO_DINNER_MENU);
    });

    it('returns an empty array when no bookable slots exist on the requested date', async () => {
      const anonymous = request(BACKEND_URL);
      const emptyDate = localDate(365);

      const res = await anonymous.get(`/api/slots/meals?date=${emptyDate}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it.each([
      ['date query parameter is missing', '/api/slots/meals'],
      ['date query parameter is empty', '/api/slots/meals?date='],
      ['date format is DD-MM-YYYY', '/api/slots/meals?date=25-12-2026'],
      ['date format is YYYY/MM/DD', '/api/slots/meals?date=2026/12/25'],
      ['date is an ISO datetime instead of YYYY-MM-DD', '/api/slots/meals?date=2026-12-25T12:00:00Z'],
      ['date is an impossible calendar day', '/api/slots/meals?date=2026-02-30'],
      ['date is non-numeric text', '/api/slots/meals?date=tomorrow'],
      ['date parameter is passed multiple times', '/api/slots/meals?date=2026-12-25&date=2026-12-26'],
    ])('returns 400 INVALID_DATE when %s', async (_label, url) => {
      const anonymous = request(BACKEND_URL);

      const res = await anonymous.get(url);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_DATE');
    });
  });

  describe('GET /api/slots/:slotId/menu', () => {
    it('returns meal times and Markdown menu for an existing slot without authentication', async () => {
      const anonymous = request(BACKEND_URL);

      const res = await anonymous.get('/api/slots/1/menu');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        slotId: 1,
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        startAt: expect.any(String),
        endAt: expect.any(String),
        startTime: expect.stringMatching(/^\d{2}:\d{2}$/),
        endTime: expect.stringMatching(/^\d{2}:\d{2}$/),
        menu: DEMO_LUNCH_MENU,
      });
    });

    it('returns menu: null when the slot has no menu configured yet', async () => {
      const anonymous = request(BACKEND_URL);

      const res = await anonymous.get('/api/slots/6/menu');

      expect(res.status).toBe(200);
      expect(res.body.slotId).toBe(6);
      expect(res.body.menu).toBeNull();
      expect(typeof res.body.startTime).toBe('string');
      expect(typeof res.body.endTime).toBe('string');
    });

    it('returns details for a slot even if it has no tables assigned', async () => {
      const anonymous = request(BACKEND_URL);

      // Slot 5 in demo data exists in slots table, with no entries in slot_tables
      const res = await anonymous.get('/api/slots/5/menu');

      expect(res.status).toBe(200);
      expect(res.body.slotId).toBe(5);
      expect(res.body.menu).toBeNull();
    });

    it.each(['abc', '0', '-1', '1.5', '1abc'])('returns 400 INVALID_INPUT for invalid slotId "%s"', async (invalidId) => {
      const anonymous = request(BACKEND_URL);

      const res = await anonymous.get(`/api/slots/${invalidId}/menu`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_INPUT');
    });

    it('returns 404 SLOT_NOT_FOUND when the slot does not exist', async () => {
      const anonymous = request(BACKEND_URL);

      const res = await anonymous.get('/api/slots/999999/menu');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('SLOT_NOT_FOUND');
    });
  });

  describe('End-to-end lifecycle: employee configures meals/menus and user consults & books', () => {
    it('reflects slot creation, table assignment, menu updates, and menu deletion in real time', async () => {
      const employee = await loginEmployee();
      const anonymous = request(BACKEND_URL);

      const startAt = at(70, 12, 30);
      const endAt = at(70, 14, 0);
      const targetDate = localDateFromIso(startAt);

      // 1. Employee creates a slot without tables yet
      const createdSlot = await employee.post('/api/slots').send({ startAt, endAt });
      expect(createdSlot.status).toBe(201);
      const { slotId } = createdSlot.body;

      // Slot is NOT listed in /api/slots/meals until at least one table is assigned
      const beforeTables = await anonymous.get(`/api/slots/meals?date=${targetDate}`);
      expect(beforeTables.status).toBe(200);
      expect(beforeTables.body.find((s) => s.slotId === slotId)).toBeUndefined();

      // 2. Employee assigns tables to make the slot bookable
      const assignRes = await employee.post(`/api/slots/${slotId}/tables`).send({ tableIds: [T1, T2] });
      expect(assignRes.status).toBe(201);

      // Now the slot appears in /api/slots/meals with menu: null
      const afterTables = await anonymous.get(`/api/slots/meals?date=${targetDate}`);
      expect(afterTables.status).toBe(200);
      const listedInitial = afterTables.body.find((s) => s.slotId === slotId);
      expect(listedInitial).toBeDefined();
      expect(listedInitial.menu).toBeNull();
      expect(listedInitial.startAt).toBe(startAt);
      expect(listedInitial.endAt).toBe(endAt);

      // 3. Employee sets a Markdown menu for the slot
      const initialMenu = '**Special Mountain Lunch**\n- *Pizzoccheri*\n- Blueberry tart';
      const setMenuRes = await employee.put(`/api/slots/${slotId}/menu`).send({ menu: initialMenu });
      expect(setMenuRes.status).toBe(200);

      // Both endpoints immediately expose the new menu
      const mealsWithMenu = await anonymous.get(`/api/slots/meals?date=${targetDate}`);
      expect(mealsWithMenu.body.find((s) => s.slotId === slotId).menu).toBe(initialMenu);

      const singleMenu = await anonymous.get(`/api/slots/${slotId}/menu`);
      expect(singleMenu.status).toBe(200);
      expect(singleMenu.body.menu).toBe(initialMenu);

      // 4. Employee updates the menu
      const revisedMenu = '**Special Mountain Lunch (Updated)**\n- *Risotto with porcini*\n- Blueberry tart';
      const updateMenuRes = await employee.put(`/api/slots/${slotId}/menu`).send({ menu: revisedMenu });
      expect(updateMenuRes.status).toBe(200);

      const singleMenuUpdated = await anonymous.get(`/api/slots/${slotId}/menu`);
      expect(singleMenuUpdated.body.menu).toBe(revisedMenu);

      // 5. Employee removes the menu -> slot stays visible in meals list with menu: null
      const deleteMenuRes = await employee.delete(`/api/slots/${slotId}/menu`);
      expect(deleteMenuRes.status).toBe(204);

      const mealsAfterDelete = await anonymous.get(`/api/slots/meals?date=${targetDate}`);
      const listedAfterDelete = mealsAfterDelete.body.find((s) => s.slotId === slotId);
      expect(listedAfterDelete).toBeDefined();
      expect(listedAfterDelete.menu).toBeNull();

      const singleMenuDeleted = await anonymous.get(`/api/slots/${slotId}/menu`);
      expect(singleMenuDeleted.status).toBe(200);
      expect(singleMenuDeleted.body.menu).toBeNull();
    });

    it('exposes copied meal times and menus after employee copies a week schedule', async () => {
      const employee = await loginEmployee();
      const anonymous = request(BACKEND_URL);

      // Create a source slot on day +77 (11 weeks from today) with tables and menu
      const sourceStart = at(77, 19, 0);
      const sourceEnd = at(77, 21, 0);
      const sourceDate = localDateFromIso(sourceStart);
      const targetDate = localDateFromIso(at(84, 19, 0));

      const sourceSlot = (await employee.post('/api/slots').send({
        startAt: sourceStart,
        endAt: sourceEnd,
      })).body;
      await employee.post(`/api/slots/${sourceSlot.slotId}/tables`).send({ tableIds: [T1, T3] });

      const weeklyMenu = '**Weekly Hut Dinner**\n- Polenta and venison\n- Homemade tiramisu';
      await employee.put(`/api/slots/${sourceSlot.slotId}/menu`).send({ menu: weeklyMenu });

      // Copy schedule + tables + menu to the following week
      const copyRes = await employee.post('/api/slots/copy-week').send({
        fromDate: sourceDate,
        toDate: targetDate,
        copyTables: true,
        copyMenu: true,
      });
      expect(copyRes.status).toBe(201);

      // User queries /api/slots/meals on the target week's date and finds the copied meal and menu
      const targetMeals = await anonymous.get(`/api/slots/meals?date=${targetDate}`);
      expect(targetMeals.status).toBe(200);
      expect(targetMeals.body).toHaveLength(1);
      expect(targetMeals.body[0].menu).toBe(weeklyMenu);

      const copiedSlotId = targetMeals.body[0].slotId;
      const targetSingleMenu = await anonymous.get(`/api/slots/${copiedSlotId}/menu`);
      expect(targetSingleMenu.status).toBe(200);
      expect(targetSingleMenu.body.menu).toBe(weeklyMenu);
    });

    it('supports the full user discovery-to-booking journey (inspect meals & menu -> check availability -> book with party requirements)', async () => {
      const employee = await loginEmployee();
      const hiker = await loginHiker();

      const startAt = at(90, 12, 0);
      const endAt = at(90, 13, 30);
      const date = localDateFromIso(startAt);

      // Setup two slots on the same day with different menus
      const lunchSlot = (await employee.post('/api/slots').send({ startAt, endAt })).body;
      await employee.post(`/api/slots/${lunchSlot.slotId}/tables`).send({ tableIds: [T1, T2] }); // 8 seats
      await employee.put(`/api/slots/${lunchSlot.slotId}/menu`).send({
        menu: '**Polenta Day**\n- *Polenta concia*\n- Vegetarian option available',
      });

      const dinnerStart = at(90, 19, 30);
      const dinnerEnd = at(90, 21, 0);
      const dinnerSlot = (await employee.post('/api/slots').send({
        startAt: dinnerStart,
        endAt: dinnerEnd,
      })).body;
      await employee.post(`/api/slots/${dinnerSlot.slotId}/tables`).send({ tableIds: [T3] }); // 6 seats
      await employee.put(`/api/slots/${dinnerSlot.slotId}/menu`).send({
        menu: '**Grill Night**\n- Mixed grilled meats\n- Gluten-free dessert',
      });

      // Step 1: User browses all meal times and menus for the chosen date
      const mealsRes = await hiker.get(`/api/slots/meals?date=${date}`);
      expect(mealsRes.status).toBe(200);
      expect(mealsRes.body).toHaveLength(2);

      const chosenMeal = mealsRes.body.find((m) => m.menu.includes('Gluten-free dessert'));
      expect(chosenMeal).toBeDefined();
      expect(chosenMeal.slotId).toBe(dinnerSlot.slotId);

      // Step 2: User opens the specific slot menu endpoint to confirm details
      const menuDetailRes = await hiker.get(`/api/slots/${chosenMeal.slotId}/menu`);
      expect(menuDetailRes.status).toBe(200);
      expect(menuDetailRes.body.menu).toContain('Grill Night');

      // Step 3: User checks availability for their party of 4
      const availRes = await hiker.get(`/api/slots/${chosenMeal.slotId}/availability?partySize=4`);
      expect(availRes.status).toBe(200);
      expect(availRes.body.available).toBe(true);

      // Step 4: User books the slot with dietary requirements suited to their party
      const bookRes = await hiker.post('/api/reservations').send({
        slotId: chosenMeal.slotId,
        partySize: 4,
        requirements: [
          { peopleCount: 1, description: 'celiac - needs gluten-free dessert', isAllergy: true },
        ],
      });
      expect(bookRes.status).toBe(201);
      expect(bookRes.body.slotId).toBe(chosenMeal.slotId);
      expect(bookRes.body.partySize).toBe(4);
    });
  });
  describe('Additional edge cases & integration checks', () => {
    it('keeps a fully booked slot (0 seats left) visible in GET /api/slots/meals', async () => {
      const employee = await loginEmployee();
      const hiker = await loginHiker();
      const anonymous = request(BACKEND_URL);

      const startAt = at(95, 12, 0);
      const endAt = at(95, 13, 0);
      const date = localDateFromIso(startAt);

      // Create slot with only T4 (2 seats) and book all 2 seats
      const slot = (await employee.post('/api/slots').send({ startAt, endAt })).body;
      await employee.post(`/api/slots/${slot.slotId}/tables`).send({ tableIds: [4] });
      await employee.put(`/api/slots/${slot.slotId}/menu`).send({ menu: '**Full Slot Menu**\n- Soup' });

      const booking = await hiker.post('/api/reservations').send({ slotId: slot.slotId, partySize: 2 });
      expect(booking.status).toBe(201);

      // Even with 0 available seats, meal times and menu remain visible to users
      const res = await anonymous.get(`/api/slots/meals?date=${date}`);
      expect(res.status).toBe(200);
      const found = res.body.find((s) => s.slotId === slot.slotId);
      expect(found).toBeDefined();
      expect(found.menu).toBe('**Full Slot Menu**\n- Soup');
    });

    it('makes a slot visible in GET /api/slots/meals after tables are copied via copy-tables', async () => {
      const employee = await loginEmployee();
      const anonymous = request(BACKEND_URL);

      const sourceSlot = (await employee.post('/api/slots').send({
        startAt: at(96, 12, 0),
        endAt: at(96, 13, 0),
      })).body;
      await employee.post(`/api/slots/${sourceSlot.slotId}/tables`).send({ tableIds: [T1] });

      const targetStart = at(96, 19, 0);
      const targetSlot = (await employee.post('/api/slots').send({
        startAt: targetStart,
        endAt: at(96, 20, 0),
      })).body;
      const date = localDateFromIso(targetStart);

      // Before copy-tables: only sourceSlot is returned
      const before = await anonymous.get(`/api/slots/meals?date=${date}`);
      expect(before.body.map((s) => s.slotId)).toEqual([sourceSlot.slotId]);

      // Copy tables to targetSlot
      const copyRes = await employee.post(`/api/slots/${targetSlot.slotId}/copy-tables`)
        .send({ fromSlotId: sourceSlot.slotId });
      expect(copyRes.status).toBe(201);

      // After copy-tables: both slots are returned in chronological order
      const after = await anonymous.get(`/api/slots/meals?date=${date}`);
      expect(after.body.map((s) => s.slotId)).toEqual([sourceSlot.slotId, targetSlot.slotId]);
    });

    it('returns past slots and their menus for historical dates', async () => {
      const anonymous = request(BACKEND_URL);
      const pastStart = at(-10, 12, 0);
      const pastEnd = at(-10, 13, 0);
      const pastDate = localDateFromIso(pastStart);

      const db = new DatabaseSync(process.env.DB_PATH);
      let pastSlotId;
      try {
        const res = db.prepare('INSERT INTO slots (start_at, end_at, menu) VALUES (?, ?, ?)')
          .run(pastStart, pastEnd, '**Past Lunch**\n- *Canederli*');
        pastSlotId = Number(res.lastInsertRowid);
        db.prepare('INSERT INTO slot_tables (slot_id, table_id) VALUES (?, ?)').run(pastSlotId, T1);
      } finally {
        db.close();
      }

      const mealsRes = await anonymous.get(`/api/slots/meals?date=${pastDate}`);
      expect(mealsRes.status).toBe(200);
      expect(mealsRes.body).toHaveLength(1);
      expect(mealsRes.body[0]).toMatchObject({
        slotId: pastSlotId,
        date: pastDate,
        menu: '**Past Lunch**\n- *Canederli*',
      });

      const menuRes = await anonymous.get(`/api/slots/${pastSlotId}/menu`);
      expect(menuRes.status).toBe(200);
      expect(menuRes.body.menu).toBe('**Past Lunch**\n- *Canederli*');
    });

    it('blocks a hiker with passwordToChange=true with 403 until they change their temporary password', async () => {
      const employee = await loginEmployee();

      const hikerData = {
        name: 'Temp Pass Hiker',
        email: `temppass.${Date.now()}@example.com`,
        phone: '3335556677',
      };
      const booking = await employee.post('/api/reservations').send({
        slotId: 6,
        partySize: 1,
        hiker: hikerData,
      });
      expect(booking.status).toBe(201);

      const tempHiker = request.agent(BACKEND_URL);
      const loginRes = await tempHiker.post('/api/sessions').send({
        email: hikerData.email,
        password: booking.body.temporaryPassword,
      });
      expect(loginRes.status).toBe(201);
      expect(loginRes.body.passwordToChange).toBe(true);

      // While passwordToChange is true, even meal/menu endpoints are blocked with 403
      const blockedMeals = await tempHiker.get(`/api/slots/meals?date=${localDate(1)}`);
      expect(blockedMeals.status).toBe(403);
      expect(blockedMeals.body.error).toBe('PASSWORD_CHANGE_REQUIRED');

      const blockedMenu = await tempHiker.get('/api/slots/1/menu');
      expect(blockedMenu.status).toBe(403);
      expect(blockedMenu.body.error).toBe('PASSWORD_CHANGE_REQUIRED');

      // Once the temporary password is changed, access is restored
      const changeRes = await tempHiker.put('/api/users/password').send({ newPassword: 'new-secret-password' });
      expect(changeRes.status).toBe(200);

      expect((await tempHiker.get(`/api/slots/meals?date=${localDate(1)}`)).status).toBe(200);
      expect((await tempHiker.get('/api/slots/1/menu')).status).toBe(200);
    });

    it('allows employee and warden roles to query meal times and slot menus', async () => {
      const employee = await loginEmployee();
      const warden = await loginAs('warden@mountainhut.test');
      const tomorrow = localDate(1);

      expect((await employee.get(`/api/slots/meals?date=${tomorrow}`)).status).toBe(200);
      expect((await employee.get('/api/slots/1/menu')).status).toBe(200);

      expect((await warden.get(`/api/slots/meals?date=${tomorrow}`)).status).toBe(200);
      expect((await warden.get('/api/slots/1/menu')).status).toBe(200);
    });

    it('preserves rich Markdown, accents, and special characters in menu responses', async () => {
      const employee = await loginEmployee();
      const anonymous = request(BACKEND_URL);

      const startAt = at(97, 12, 0);
      const date = localDateFromIso(startAt);
      const slot = (await employee.post('/api/slots').send({
        startAt,
        endAt: at(97, 13, 30),
      })).body;
      await employee.post(`/api/slots/${slot.slotId}/tables`).send({ tableIds: [T1] });

      const richMenu = `**Menù Tipico d'Alta Quota** 🏔️\n- Antipasti\n  - *Lardo d'Arnad* & miele di castagno\n- Piatti caldi\n  - Zuppa à la Valpellinentze (100% locale)`;
      await employee.put(`/api/slots/${slot.slotId}/menu`).send({ menu: richMenu });

      const singleRes = await anonymous.get(`/api/slots/${slot.slotId}/menu`);
      expect(singleRes.status).toBe(200);
      expect(singleRes.body.menu).toBe(richMenu);

      const listRes = await anonymous.get(`/api/slots/meals?date=${date}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body[0].menu).toBe(richMenu);
    });
  });
});

  