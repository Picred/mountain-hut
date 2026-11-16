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

const at = (offsetDays, hours, minutes = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
};

const hoursAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString();

async function loginAs(email) {
  const agent = request.agent(BACKEND_URL);
  const response = await agent.post('/api/sessions').send({ email, password: 'password' });
  expect(response.status).toBe(201);
  return agent;
}

const loginEmployee = () => loginAs('employee@mountainhut.test');
const loginHiker = () => loginAs('anna@mountainhut.test');

async function createSlot(employee, startAt, endAt) {
  const response = await employee.post('/api/slots').send({ startAt, endAt });
  expect(response.status).toBe(201);
  return response.body;
}

function insertPastSlot(startAt, endAt, menu = null) {
  const db = new DatabaseSync(process.env.DB_PATH);
  try {
    const result = db.prepare('INSERT INTO slots (start_at, end_at, menu) VALUES (?, ?, ?)')
      .run(startAt, endAt, menu);
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

function getSlotMenuFromDb(slotId) {
  const db = new DatabaseSync(process.env.DB_PATH);
  try {
    return db.prepare('SELECT menu FROM slots WHERE slot_id = ?').get(slotId)?.menu ?? null;
  } finally {
    db.close();
  }
}

describe('Slot Menu e2e', () => {
  const sampleMenu = '**Lunch menu**\n- First course\n  - *Polenta concia*\n- Apple strudel';

  describe('Authentication and authorization', () => {
    it('requires authentication for menu endpoints', async () => {
      const anonymous = request(BACKEND_URL);

      const getMenusRes = await anonymous.get('/api/slots/menus');
      expect(getMenusRes.status).toBe(401);

      const putMenuRes = await anonymous.put('/api/slots/1/menu').send({ menu: sampleMenu });
      expect(putMenuRes.status).toBe(401);

      const deleteMenuRes = await anonymous.delete('/api/slots/1/menu');
      expect(deleteMenuRes.status).toBe(401);
    });

    it('forbids hikers from managing slot menus', async () => {
      const hiker = await loginHiker();

      const getMenusRes = await hiker.get('/api/slots/menus');
      expect(getMenusRes.status).toBe(403);

      const putMenuRes = await hiker.put('/api/slots/1/menu').send({ menu: sampleMenu });
      expect(putMenuRes.status).toBe(403);

      const deleteMenuRes = await hiker.delete('/api/slots/1/menu');
      expect(deleteMenuRes.status).toBe(403);
    });
  });

  describe('PUT /api/slots/:slotId/menu', () => {
    it('sets and updates the menu of an upcoming slot, trimming whitespace', async () => {
      const employee = await loginEmployee();
      const slot = await createSlot(employee, at(25, 12), at(25, 13));

      const setRes = await employee.put(`/api/slots/${slot.slotId}/menu`)
        .send({ menu: `  ${sampleMenu}\n ` });

      expect(setRes.status).toBe(200);
      expect(setRes.body).toEqual({
        slotId: slot.slotId,
        menu: sampleMenu,
      });
      expect(getSlotMenuFromDb(slot.slotId)).toBe(sampleMenu);

      const updatedMenu = '**Updated Dinner**\n- *Braised beef*';
      const updateRes = await employee.put(`/api/slots/${slot.slotId}/menu`)
        .send({ menu: updatedMenu });

      expect(updateRes.status).toBe(200);
      expect(getSlotMenuFromDb(slot.slotId)).toBe(updatedMenu);
    });

    it('rejects invalid inputs and boundary violations', async () => {
      const employee = await loginEmployee();
      const slot = await createSlot(employee, at(26, 12), at(26, 13));

      const invalidSlotIds = ['abc', '0', '-5', '1.5'];
      for (const invalidId of invalidSlotIds) {
        const res = await employee.put(`/api/slots/${invalidId}/menu`).send({ menu: sampleMenu });
        expect(res.status).toBe(400);
      }

      const invalidBodies = [
        {},
        { menu: '' },
        { menu: '   \n\t ' },
        { menu: 12345 },
        { menu: ['some menu'] },
        { menu: 'a'.repeat(2001) },
      ];
      for (const body of invalidBodies) {
        const res = await employee.put(`/api/slots/${slot.slotId}/menu`).send(body);
        expect(res.status).toBe(400);
      }

      const validMaxMenu = 'a'.repeat(2000);
      const validMaxRes = await employee.put(`/api/slots/${slot.slotId}/menu`).send({ menu: ` ${validMaxMenu} ` });
      expect(validMaxRes.status).toBe(200);
      expect(validMaxRes.body.menu).toBe(validMaxMenu);
    });

    it('returns 404 for a non-existing slot', async () => {
      const employee = await loginEmployee();
      const res = await employee.put('/api/slots/999999/menu').send({ menu: sampleMenu });

      expect(res.status).toBe(404);
    });

    it('rejects changing the menu of a slot that has already started', async () => {
      const employee = await loginEmployee();
      const pastSlotId = insertPastSlot(hoursAgo(2), hoursAgo(1), '**Past menu**');

      const res = await employee.put(`/api/slots/${pastSlotId}/menu`).send({ menu: sampleMenu });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/slots/:slotId/menu', () => {
    it('removes the menu from an upcoming slot', async () => {
      const employee = await loginEmployee();
      const slot = await createSlot(employee, at(27, 12), at(27, 13));

      await employee.put(`/api/slots/${slot.slotId}/menu`).send({ menu: sampleMenu });
      expect(getSlotMenuFromDb(slot.slotId)).toBe(sampleMenu);

      const deleteRes = await employee.delete(`/api/slots/${slot.slotId}/menu`);
      expect(deleteRes.status).toBe(204);
      expect(getSlotMenuFromDb(slot.slotId)).toBeNull();
    });

    it('rejects invalid slot IDs and returns 404 if slot does not exist', async () => {
      const employee = await loginEmployee();

      const invalidSlotIds = ['abc', '0', '-1'];
      for (const invalidId of invalidSlotIds) {
        const res = await employee.delete(`/api/slots/${invalidId}/menu`);
        expect(res.status).toBe(400);
      }

      const missingRes = await employee.delete('/api/slots/999999/menu');
      expect(missingRes.status).toBe(404);
    });

    it('rejects deleting the menu of a slot that has already started', async () => {
      const employee = await loginEmployee();
      const pastSlotId = insertPastSlot(hoursAgo(3), hoursAgo(2), '**Past menu**');

      const deleteRes = await employee.delete(`/api/slots/${pastSlotId}/menu`);
      expect(deleteRes.status).toBe(400);
      expect(getSlotMenuFromDb(pastSlotId)).toBe('**Past menu**');
    });
  });

  describe('GET /api/slots/menus', () => {
    it('retrieves distinct previous menus ordered by most recently used', async () => {
      const employee = await loginEmployee();
      const menuOne = '**Menu Alpha**\n- Polenta';
      const menuTwo = '**Menu Beta**\n- Risotto';

      const slot1 = await createSlot(employee, at(28, 12), at(28, 13));
      const slot2 = await createSlot(employee, at(29, 12), at(29, 13));
      const slot3 = await createSlot(employee, at(30, 12), at(30, 13));

      await employee.put(`/api/slots/${slot1.slotId}/menu`).send({ menu: menuOne });
      await employee.put(`/api/slots/${slot2.slotId}/menu`).send({ menu: menuTwo });
      await employee.put(`/api/slots/${slot3.slotId}/menu`).send({ menu: menuOne });

      const res = await employee.get('/api/slots/menus');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const menus = res.body;
      expect(menus[0].menu).toBe(menuOne);
      expect(menus[0].lastUsedAt).toBe(slot3.startAt);

      expect(menus[1].menu).toBe(menuTwo);
      expect(menus[1].lastUsedAt).toBe(slot2.startAt);

      const returnedTexts = menus.map((m) => m.menu);
      expect(returnedTexts).not.toContain(null);
      expect(new Set(returnedTexts).size).toBe(returnedTexts.length);
      expect(menus.length).toBeLessThanOrEqual(50);
    });

    it('changing a reused menu on a slot affects only that specific slot', async () => {
      const employee = await loginEmployee();
      const commonMenu = '**Base Menu**\n- Bread';
      const modifiedMenu = '**Base Menu**\n- Bread\n- Butter';

      const firstSlot = await createSlot(employee, at(31, 12), at(31, 13));
      const secondSlot = await createSlot(employee, at(32, 12), at(32, 13));

      await employee.put(`/api/slots/${firstSlot.slotId}/menu`).send({ menu: commonMenu });
      await employee.put(`/api/slots/${secondSlot.slotId}/menu`).send({ menu: commonMenu });

      expect(getSlotMenuFromDb(firstSlot.slotId)).toBe(commonMenu);
      expect(getSlotMenuFromDb(secondSlot.slotId)).toBe(commonMenu);

      await employee.put(`/api/slots/${secondSlot.slotId}/menu`).send({ menu: modifiedMenu });

      expect(getSlotMenuFromDb(firstSlot.slotId)).toBe(commonMenu);
      expect(getSlotMenuFromDb(secondSlot.slotId)).toBe(modifiedMenu);
    });
  });

  describe('Capacity view integration with menus', () => {
    it('reflects menu configuration in GET /api/slots/capacity', async () => {
      const employee = await loginEmployee();
      const slotWithMenu = await createSlot(employee, at(35, 12), at(35, 13));
      const slotWithoutMenu = await createSlot(employee, at(35, 14), at(35, 15));

      await employee.put(`/api/slots/${slotWithMenu.slotId}/menu`).send({ menu: sampleMenu });

      const dateStr = at(35, 12).slice(0, 10);
      const capacityRes = await employee.get(`/api/slots/capacity?from=${dateStr}&to=${dateStr}`);

      expect(capacityRes.status).toBe(200);
      const configuredSlot = capacityRes.body.find((s) => s.slotId === slotWithMenu.slotId);
      const unconfiguredSlot = capacityRes.body.find((s) => s.slotId === slotWithoutMenu.slotId);

      expect(configuredSlot).toBeDefined();
      expect(configuredSlot.menu).toBe(sampleMenu);

      expect(unconfiguredSlot).toBeDefined();
      expect(unconfiguredSlot.menu).toBeNull();
    });
  });
});
