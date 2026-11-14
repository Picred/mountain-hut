import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../backend/utils/dbHelpers.js', () => ({
  dbAll: vi.fn(),
  dbGet: vi.fn(),
  dbRun: vi.fn(),
}));

vi.mock('../../../backend/models/dao/slotDAO.js', () => ({
  getSlotsByDate: vi.fn(),
  getSecondsUntilStart: vi.fn(),
  setSlotMenu: vi.fn(),
  getPreviousMenus: vi.fn(),
}));

import { dbAll, dbGet, dbRun } from '../../../backend/utils/dbHelpers.js';
import {
  setSlotMenu as setSlotMenuMock,
  getPreviousMenus as getPreviousMenusMock,
} from '../../../backend/models/dao/slotDAO.js';
import BadRequestError from '../../../backend/models/errors/BadRequestError.js';
import NotFoundError from '../../../backend/models/errors/NotFoundError.js';

const { setSlotMenu, getPreviousMenus } = await vi.importActual(
  '../../../backend/models/dao/slotDAO.js'
);

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

describe('slotMenuDAO', () => {
  describe('setSlotMenu', () => {
    it('sets the menu for a future slot', async () => {
      dbRun.mockResolvedValue({ changes: 1 });

      await expect(setSlotMenu(12, '**Lunch**')).resolves.toEqual({
        slotId: 12,
        menu: '**Lunch**',
      });

      expect(dbRun).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE slots'),
        ['**Lunch**', 12, expect.any(String)]
      );
    });

    it('reports a missing slot', async () => {
      dbRun.mockResolvedValue({ changes: 0 });
      dbGet.mockResolvedValue(undefined);

      await expect(setSlotMenu(99, 'Menu')).rejects.toMatchObject({
        constructor: NotFoundError,
        message: 'SLOT_NOT_FOUND',
        status: 404,
      });
    });

    it('rejects changing the menu of a slot that has already started', async () => {
      dbRun.mockResolvedValue({ changes: 0 });
      dbGet.mockResolvedValue({ slot_id: 12 });

      await expect(setSlotMenu(12, 'Menu')).rejects.toMatchObject({
        constructor: BadRequestError,
        message: 'SLOT_IN_THE_PAST',
        status: 400,
      });
    });
  });

  describe('getPreviousMenus', () => {
    it('returns previous menus with the requested limit', async () => {
      const menus = [
        { menu: '**Dinner**', lastUsedAt: '2027-01-02T18:00:00.000Z' },
      ];
      dbAll.mockResolvedValue(menus);

      await expect(getPreviousMenus(10)).resolves.toEqual(menus);

      expect(dbAll).toHaveBeenCalledWith(
        expect.stringContaining('GROUP BY menu'),
        [10]
      );
    });
  });
});

describe('slot menu routes', () => {
  describe('GET /api/slots/menus', () => {
    it('returns previous menus', async () => {
      const menus = [{ menu: '**Lunch**', lastUsedAt: '2027-01-02T12:00:00Z' }];
      getPreviousMenusMock.mockResolvedValue(menus);
      const res = fakeRes();

      await handler('get', '/menus')({}, res);

      expect(getPreviousMenusMock).toHaveBeenCalledOnce();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(menus);
    });
  });

  describe('PUT /api/slots/:slotId/menu', () => {
    const saveMenu = handler('put', '/:slotId/menu');

    it('saves trimmed free-text Markdown for the slot', async () => {
      const savedMenu = { slotId: 12, menu: '**Lunch**' };
      setSlotMenuMock.mockResolvedValue(savedMenu);
      const res = fakeRes();

      await saveMenu(
        { params: { slotId: '12' }, body: { menu: '  **Lunch**  ' } },
        res
      );

      expect(setSlotMenuMock).toHaveBeenCalledWith(12, '**Lunch**');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(savedMenu);
    });

    it('rejects invalid slot IDs, empty menus, and menus over the limit', async () => {
      const invalidInputs = [
        { params: { slotId: '0' }, body: { menu: 'Menu' } },
        { params: { slotId: '12x' }, body: { menu: 'Menu' } },
        { params: { slotId: '12' }, body: { menu: '  ' } },
        { params: { slotId: '12' }, body: { menu: 'x'.repeat(2001) } },
      ];

      for (const req of invalidInputs) {
        await expect(saveMenu(req, fakeRes())).rejects.toMatchObject({
          constructor: BadRequestError,
          message: 'INVALID_INPUT',
          status: 400,
        });
      }

      expect(setSlotMenuMock).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/slots/:slotId/menu', () => {
    const deleteMenu = handler('delete', '/:slotId/menu');

    it('removes a menu and returns no content', async () => {
      setSlotMenuMock.mockResolvedValue({ slotId: 12, menu: null });
      const res = fakeRes();

      await deleteMenu({ params: { slotId: '12' } }, res);

      expect(setSlotMenuMock).toHaveBeenCalledWith(12, null);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalledOnce();
    });

    it('rejects an invalid slot ID', async () => {
      await expect(
        deleteMenu({ params: { slotId: '0' } }, fakeRes())
      ).rejects.toMatchObject({
        constructor: BadRequestError,
        message: 'INVALID_INPUT',
        status: 400,
      });

      expect(setSlotMenuMock).not.toHaveBeenCalled();
    });
  });
});
