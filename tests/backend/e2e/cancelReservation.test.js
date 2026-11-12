import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, it } from 'vitest';

const BACKEND_URL = 'http://localhost:3002';

beforeAll(async () => {
  execFileSync('node', ['db/init-db.js', '--reset'], { cwd: new URL('../../../backend', import.meta.url) });
  await import('../../../backend/index.js');
});

async function loginAs(agent, email) {
  const res = await agent.post('/api/sessions').send({ email, password: 'password' });
  expect(res.status).toBe(201);
}

describe('Cancel reservation e2e', () => {
  it('rejects unauthenticated cancellation', async () => {
    const res = await request(BACKEND_URL).delete('/api/reservations/1');

    expect(res.status).toBe(401);
  });

  it('rejects invalid reservation IDs and returns 404 for a missing reservation', async () => {
    const agent = request.agent(BACKEND_URL);
    await loginAs(agent, 'anna@mountainhut.test');

    for (const id of ['0', '-1', 'abc', '1.5']) {
      const res = await agent.delete(`/api/reservations/${id}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_INPUT');
    }

    const missing = await agent.delete('/api/reservations/99999');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('RESERVATION_NOT_FOUND');
  });

  it('does not allow another hiker to cancel the reservation', async () => {
    const agent = request.agent(BACKEND_URL);
    await loginAs(agent, 'bruno@mountainhut.test');

    const res = await agent.delete('/api/reservations/1');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  it('cancels the owned reservation, retains its cancelled status, releases seats, and rejects recancellation', async () => {
    const agent = request.agent(BACKEND_URL);
    await loginAs(agent, 'anna@mountainhut.test');

    const before = await agent.get('/api/slots/1/availability').query({ partySize: 6 });
    expect(before.status).toBe(200);
    expect(before.body.tableAllocation).not.toEqual([
      { tableId: 3, tableCode: 'T3', allocatedSeats: 6 },
    ]);

    const cancelled = await agent.delete('/api/reservations/1');

    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toEqual({ reservationId: 1, status: 'cancelled' });

    const reservations = await agent.get('/api/reservations');
    expect(reservations.status).toBe(200);
    expect(reservations.body.find(({ reservationId }) => reservationId === 1)).toMatchObject({
      status: 'cancelled',
      tableAllocation: [],
    });

    const after = await agent.get('/api/slots/1/availability').query({ partySize: 6 });
    expect(after.status).toBe(200);
    expect(after.body.tableAllocation).toEqual([
      { tableId: 3, tableCode: 'T3', allocatedSeats: 6 },
    ]);

    const repeated = await agent.delete('/api/reservations/1');
    expect(repeated.status).toBe(409);
    expect(repeated.body.error).toBe('RESERVATION_NOT_CANCELLABLE');
  });

  it('allows cancellation after the reservation time has started', async () => {
    const db = new DatabaseSync(process.env.DB_PATH);
    db.prepare('UPDATE slots SET start_at = ? WHERE slot_id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), 2);
    db.close();

    const agent = request.agent(BACKEND_URL);
    await loginAs(agent, 'edward@mountainhut.test');

    const res = await agent.delete('/api/reservations/4');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reservationId: 4, status: 'cancelled' });
  });
});
