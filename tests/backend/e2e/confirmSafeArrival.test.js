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

async function loginAs(email) {
  const agent = request.agent(BACKEND_URL);
  const response = await agent.post('/api/sessions').send({ email, password: 'password' });
  expect(response.status).toBe(201);
  return agent;
}

const loginHiker = (email = 'anna@mountainhut.test') => loginAs(email);
const loginOtherHiker = () => loginAs('bruno@mountainhut.test');
const loginEmployee = () => loginAs('employee@mountainhut.test');

async function createHike(agent, data = {}) {
  const payload = {
    destination: 'Mount Viso Test Peak',
    route: 'South Ridge trail path',
    scheduledDeparture: at(15, 8),
    expectedArrival: at(15, 17),
    partySize: 2,
    passages: ['Refuge Shelter', 'Ridge Overlook'],
    ...data,
  };
  const res = await agent.post('/api/hikes').send(payload);
  expect(res.status).toBe(201);
  return res.body;
}

function getHikeStatusFromDb(hikeId) {
  const db = new DatabaseSync(process.env.DB_PATH);
  try {
    return db.prepare('SELECT status FROM hikes WHERE hike_id = ?').get(hikeId)?.status ?? null;
  } finally {
    db.close();
  }
}

describe('Confirm Safe Arrival e2e', () => {
  describe('Authentication and authorization', () => {
    it('requires authentication to list hikes and to confirm arrival', async () => {
      const anonymous = request(BACKEND_URL);

      const listRes = await anonymous.get('/api/hikes');
      expect(listRes.status).toBe(401);

      const confirmRes = await anonymous.put('/api/hikes/1/confirm-arrival');
      expect(confirmRes.status).toBe(401);
    });

    it('forbids employees and wardens from using hiker hike endpoints', async () => {
      const employee = await loginEmployee();

      const listRes = await employee.get('/api/hikes');
      expect(listRes.status).toBe(403);

      const confirmRes = await employee.put('/api/hikes/1/confirm-arrival');
      expect(confirmRes.status).toBe(403);
    });
  });

  describe('GET /api/hikes', () => {
    it('lists only the hikes belonging to the logged-in hiker in chronological order', async () => {
      const hikerAnna = await loginHiker();
      const hikerBruno = await loginOtherHiker();

      const hikeAnna = await createHike(hikerAnna, {
        destination: 'Lake Chiaretto High Trail',
        scheduledDeparture: at(20, 7),
        expectedArrival: at(20, 16),
      });

      const hikeBruno = await createHike(hikerBruno, {
        destination: 'Pian del Re Forest',
        scheduledDeparture: at(21, 6),
        expectedArrival: at(21, 14),
      });

      const resAnna = await hikerAnna.get('/api/hikes');
      expect(resAnna.status).toBe(200);

      const annaHikeIds = resAnna.body.map((h) => h.hikeId);
      expect(annaHikeIds).toContain(hikeAnna.hikeId);
      expect(annaHikeIds).not.toContain(hikeBruno.hikeId);

      const resBruno = await hikerBruno.get('/api/hikes');
      expect(resBruno.status).toBe(200);
      const brunoHikeIds = resBruno.body.map((h) => h.hikeId);
      expect(brunoHikeIds).toContain(hikeBruno.hikeId);
      expect(brunoHikeIds).not.toContain(hikeAnna.hikeId);

      for (let i = 1; i < resAnna.body.length; i++) {
        const prev = new Date(resAnna.body[i - 1].scheduledDeparture).getTime();
        const curr = new Date(resAnna.body[i].scheduledDeparture).getTime();
        expect(prev).toBeLessThanOrEqual(curr);
      }
    });

    it('returns passages associated with the hikes', async () => {
      const hiker = await loginHiker();
      const newHike = await createHike(hiker, {
        destination: 'Passage Route Peak',
        scheduledDeparture: at(22, 9),
        expectedArrival: at(22, 18),
        passages: ['Pass A', 'Pass B'],
      });

      const res = await hiker.get('/api/hikes');
      expect(res.status).toBe(200);

      const target = res.body.find((h) => h.hikeId === newHike.hikeId);
      expect(target).toBeDefined();
      expect(target.passages).toEqual(['Pass A', 'Pass B']);
      expect(target.partySize).toBe(2);
      expect(target.status).toBe('scheduled');
    });
  });

  describe('PUT /api/hikes/:hikeId/confirm-arrival', () => {
    it('marks a scheduled hike as safely returned', async () => {
      const hiker = await loginHiker();
      const hike = await createHike(hiker, {
        destination: 'Safe Return Hike',
        scheduledDeparture: at(24, 7),
        expectedArrival: at(24, 15),
      });

      expect(getHikeStatusFromDb(hike.hikeId)).toBe('scheduled');

      const confirmRes = await hiker.put(`/api/hikes/${hike.hikeId}/confirm-arrival`);
      expect(confirmRes.status).toBe(200);

      const listRes = await hiker.get('/api/hikes');
      expect(listRes.status).toBe(200);
    });

    it('rejects confirmation if the hike is already marked as returned', async () => {
      const hiker = await loginHiker();
      const hike = await createHike(hiker, {
        destination: 'Already Returned Hike',
        scheduledDeparture: at(25, 8),
        expectedArrival: at(25, 16),
      });

      const firstConfirm = await hiker.put(`/api/hikes/${hike.hikeId}/confirm-arrival`);
      expect(firstConfirm.status).toBe(200);

      const secondConfirm = await hiker.put(`/api/hikes/${hike.hikeId}/confirm-arrival`);
      expect(secondConfirm.status).toBe(409);
    });

    it('returns 404 when trying to confirm a hike that belongs to another hiker', async () => {
      const hikerAnna = await loginHiker();
      const hikerBruno = await loginOtherHiker();

      const annaHike = await createHike(hikerAnna, {
        destination: 'Anna Only Trail',
        scheduledDeparture: at(26, 7),
        expectedArrival: at(26, 17),
      });

      const brunoConfirmRes = await hikerBruno.put(`/api/hikes/${annaHike.hikeId}/confirm-arrival`);
      expect(brunoConfirmRes.status).toBe(404);
    });

    it('returns 404 for a non-existing hike id', async () => {
      const hiker = await loginHiker();
      const res = await hiker.put('/api/hikes/999999/confirm-arrival');

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid hike identifiers in the URL', async () => {
      const hiker = await loginHiker();

      for (const invalidId of ['abc', '0', '-4', '1.5']) {
        const res = await hiker.put(`/api/hikes/${invalidId}/confirm-arrival`);
        expect(res.status).toBe(400);
      }
    });
  });
});
