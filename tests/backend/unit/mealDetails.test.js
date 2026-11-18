import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../backend/utils/dbHelpers.js', () => ({
  dbAll: vi.fn(),
  dbGet: vi.fn(),
}));

vi.mock('../../../backend/models/dao/slotDAO.js', () => ({
  getSlotsByDate: vi.fn(),
  getSecondsUntilStart: vi.fn(),
  setSlotMenu: vi.fn(),
  getPreviousMenus: vi.fn(),
}));

vi.mock('../../../backend/models/dao/reservationDAO.js', () => ({
  checkAvailability: vi.fn(),
}));

import { dbAll, dbGet } from '../../../backend/utils/dbHelpers.js';
import {
  getMealBySlotId,
  getMealsByDate,
} from '../../../backend/models/dao/mealDAO.js';

import router from '../../../backend/api/slotRoutes.js';

function handler(method, path) {
  const layer = router.stack.find(
    (item) => item.route?.path === path && item.route.methods[method]
  );
  return layer.route.stack.at(-1).handle;
}

function fakeRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.end = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('meal details DAO', () => {
  it('gets meal details for an existing slot and preserves Markdown menu', async () => {
    dbGet.mockResolvedValue({
      slotId: 12,
      date: '2028-06-01',
      startAt: '2028-06-01T11:00:00.000Z',
      endAt: '2028-06-01T12:00:00.000Z',
      startTime: '11:00',
      endTime: '12:00',
      menu: '**Lunch**\n- Polenta',
    });

    await expect(getMealBySlotId(12)).resolves.toEqual({
      slotId: 12,
      date: '2028-06-01',
      startAt: '2028-06-01T11:00:00.000Z',
      endAt: '2028-06-01T12:00:00.000Z',
      startTime: '11:00',
      endTime: '12:00',
      menu: '**Lunch**\n- Polenta',
    });

    expect(dbGet).toHaveBeenCalledWith(
      expect.stringContaining('WHERE slot_id = ?'),
      [12]
    );
  });

  it('returns null for a missing slot', async () => {
    dbGet.mockResolvedValue(undefined);

    await expect(getMealBySlotId(999)).resolves.toBeNull();
  });

  it('returns null menu as null instead of undefined', async () => {
    dbGet.mockResolvedValue({
      slotId: 12,
      date: '2028-06-01',
      menu: null,
    });

    await expect(getMealBySlotId(12)).resolves.toMatchObject({ menu: null });
  });

  it('gets meals for a date and normalizes missing menus', async () => {
    dbAll.mockResolvedValue([
      { slotId: 12, date: '2028-06-01', menu: '**Lunch**' },
      { slotId: 13, date: '2028-06-01', menu: null },
    ]);

    await expect(getMealsByDate('2028-06-01')).resolves.toEqual([
      { slotId: 12, date: '2028-06-01', menu: '**Lunch**' },
      { slotId: 13, date: '2028-06-01', menu: null },
    ]);

    expect(dbAll).toHaveBeenCalledWith(
      expect.stringContaining('WHERE DATE(start_at, \'localtime\') = ?'),
      ['2028-06-01']
    );
  });

  it('returns an empty array when no meals exist', async () => {
    dbAll.mockResolvedValue([]);

    await expect(getMealsByDate('2028-06-01')).resolves.toEqual([]);
  });
});

describe('meal details routes', () => {
  it('returns meals for a valid public date', async () => {
    const meals = [{ slotId: 12, date: '2028-06-01', menu: '**Lunch**' }];
    const getMeals = handler('get', '/meals');
    const res = fakeRes();

    vi.mocked(dbAll).mockResolvedValue(meals);

    await getMeals({ query: { date: '2028-06-01' } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(meals);
  });

  it('rejects missing or invalid dates', async () => {
    const getMeals = handler('get', '/meals');

    for (const date of [undefined, '', '25-06-2028', '2028-02-30', 'tomorrow']) {
      await expect(getMeals({ query: { date } }, fakeRes())).rejects.toMatchObject({
        message: 'INVALID_DATE',
        status: 400,
      });
    }
  });

  it('returns meal details for a valid slot id', async () => {
    const meal = { slotId: 12, menu: '**Lunch**' };
    dbGet.mockResolvedValue(meal);

    const getMeal = handler('get', '/:slotId/menu');
    const res = fakeRes();

    await getMeal({ params: { slotId: '12' } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(meal);
  });

  it('rejects invalid slot ids', async () => {
    const getMeal = handler('get', '/:slotId/menu');

    await expect(getMeal({ params: { slotId: '12x' } }, fakeRes())).rejects.toMatchObject({
      message: 'INVALID_INPUT',
      status: 400,
    });
  });

  it('returns 404 when the slot does not exist', async () => {
    dbGet.mockResolvedValue(undefined);

    const getMeal = handler('get', '/:slotId/menu');

    await expect(getMeal({ params: { slotId: '999' } }, fakeRes())).rejects.toMatchObject({
      message: 'SLOT_NOT_FOUND',
      status: 404,
    });
  });
});
