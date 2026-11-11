import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every dependency of the unit under test is replaced by a fake: no database, no real passport
vi.mock('../../../backend/db/db.js', () => ({
  default: { get: vi.fn(), run: vi.fn() },
}));
vi.mock('../../../backend/models/dao/authenticationDAO.js', () => ({
  getUser: vi.fn(),
  createUser: vi.fn(),
  changePassword: vi.fn(),
  getHikerByEmail: vi.fn(),
}));
vi.mock('passport', () => ({
  default: { use: vi.fn(), serializeUser: vi.fn(), deserializeUser: vi.fn(), authenticate: vi.fn() },
}));

import db from '../../../backend/db/db.js';
import { changePassword as changePasswordMock } from '../../../backend/models/dao/authenticationDAO.js';
import ensureAuthenticated from '../../../backend/middlewares/auth-middleware.js';
import blockUntilPasswordChanged from '../../../backend/middlewares/changePassword-middleware.js';
import router from '../../../backend/api/authenticationRoutes.js';
import BadRequestError from '../../../backend/models/errors/BadRequestError.js';
import ForbiddenError from '../../../backend/models/errors/ForbiddenError.js';
import UnauthorizedError from '../../../backend/models/errors/UnauthorizedError.js';

// The DAO itself is tested for real, only its db is fake
const { getUser, changePassword } = await vi.importActual('../../../backend/models/dao/authenticationDAO.js');

const SALT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

// sqlite3 callbacks: db.get(sql, params, cb(err, row)) and db.run(sql, params, cb(err)) with this.changes
const dbGetReturns = (row) => db.get.mockImplementation((_sql, _params, cb) => cb(null, row));
const dbRunChanges = (changes) => db.run.mockImplementation((_sql, _params, cb) => cb.call({ changes }, null));
const dbRunFails = (message) => db.run.mockImplementation((_sql, _params, cb) => cb(new Error(message)));

const route = () => router.stack.find((l) => l.route?.path === '/api/users/password' && l.route.methods.put).route;

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

describe('authenticationDAO - password change', () => {
  describe('getUser', () => {
    it('tells that the password must be changed when the flag is set', async () => {
      dbGetReturns({
        user_id: 9,
        name: 'Giovanni Giorgio',
        email: 'giovanni@example.com',
        phone: '1234321',
        role: 'hiker',
        salt: SALT,
        password_hash: crypto.scryptSync('temporary1', SALT, 32).toString('hex'),
        password_to_change: 1,
      });

      const user = await getUser('giovanni@example.com', 'temporary1');

      expect(user.passwordToChange).toBe(true);
    });
  });

  describe('changePassword', () => {
    it('stores a new salted scrypt hash, never the plain password, and clears the flag', async () => {
      dbRunChanges(1);

      await expect(changePassword(3, 'new-secret')).resolves.toBe(true);

      const [sql, [salt, hash, flag, userId]] = db.run.mock.calls[0];
      expect(sql).toMatch(/UPDATE users/);
      expect(sql).toMatch(/salt = \?, password_hash = \?, password_to_change = \?/);
      expect(userId).toBe(3);
      expect(flag).toBe(0);
      expect(salt).toMatch(/^[0-9a-f]{32}$/);
      expect(hash).not.toBe('new-secret');
      expect(hash).toBe(crypto.scryptSync('new-secret', salt, 32).toString('hex'));
    });

    it('uses a different salt every time', async () => {
      dbRunChanges(1);

      await changePassword(3, 'new-secret');
      await changePassword(3, 'new-secret');

      const firstSalt = db.run.mock.calls[0][1][0];
      const secondSalt = db.run.mock.calls[1][1][0];
      expect(firstSalt).not.toBe(secondSalt);
    });

    it('can set the flag, to force a change at the next login', async () => {
      dbRunChanges(1);

      await changePassword(3, 'temporary1', 1);

      expect(db.run.mock.calls[0][1][2]).toBe(1);
    });

    it('returns false when no user has that id', async () => {
      dbRunChanges(0);

      await expect(changePassword(999, 'new-secret')).resolves.toBe(false);
    });

    it('rejects on a database error', async () => {
      dbRunFails('SQLITE_IOERR');

      await expect(changePassword(3, 'new-secret')).rejects.toThrow('SQLITE_IOERR');
    });
  });
});

describe('PUT /api/users/password', () => {
  const user = { user_id: 9, name: 'Giovanni Giorgio', email: 'giovanni@example.com', role: 'hiker', passwordToChange: true };

  it('is reserved to logged-in users', () => {
    const [first, last] = [route().stack[0], route().stack.at(-1)];

    expect(route().stack).toHaveLength(2);
    expect(first.handle).toBe(ensureAuthenticated);
    expect(last.handle).not.toBe(ensureAuthenticated);
  });

  it.each([
    ['missing', {}],
    ['shorter than 6 characters', { newPassword: '12345' }],
    ['not a string', { newPassword: 123456 }],
  ])('rejects with BadRequestError when the new password is %s, without touching the DAO', async (_, body) => {
    const changeRoute = route().stack.at(-1).handle;
    const next = vi.fn();

    await changeRoute({ user, body }, fakeRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(BadRequestError);
    expect(next.mock.calls[0][0].message).toBe('The password must contain at least 6 characters.');
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it('saves the new password, updates the session and responds 200 with the user', async () => {
    const changeRoute = route().stack.at(-1).handle;
    changePasswordMock.mockResolvedValue(true);
    const req = { user, body: { newPassword: 'new-secret' }, login: vi.fn((_user, cb) => cb()) };
    const res = fakeRes();

    await changeRoute(req, res, vi.fn());

    expect(changePasswordMock).toHaveBeenCalledWith(9, 'new-secret');
    // the session must hold the new flag, otherwise the user stays blocked
    expect(req.login.mock.calls[0][0]).toEqual({ ...user, passwordToChange: false });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ...user, passwordToChange: false });
  });

  it('rejects with UnauthorizedError when the user no longer exists', async () => {
    const changeRoute = route().stack.at(-1).handle;
    changePasswordMock.mockResolvedValue(false);
    const req = { user, body: { newPassword: 'new-secret' }, login: vi.fn() };
    const next = vi.fn();

    await changeRoute(req, fakeRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
    expect(req.login).not.toHaveBeenCalled();
  });

  it('passes the error on when the session cannot be updated', async () => {
    const changeRoute = route().stack.at(-1).handle;
    changePasswordMock.mockResolvedValue(true);
    const sessionError = new Error('session store down');
    const req = { user, body: { newPassword: 'new-secret' }, login: vi.fn((_user, cb) => cb(sessionError)) };
    const res = fakeRes();
    const next = vi.fn();

    await changeRoute(req, res, next);

    expect(next).toHaveBeenCalledWith(sessionError);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('blockUntilPasswordChanged', () => {
  const mustChange = { user_id: 9, role: 'hiker', passwordToChange: true };

  it.each([
    ['nobody is logged in', undefined],
    ['the password does not need to be changed', { user_id: 3, role: 'hiker', passwordToChange: false }],
    ['the session user has no flag (registered from the site)', { user_id: 3, role: 'hiker' }],
  ])('lets every request through when %s', (_, user) => {
    const next = vi.fn();

    blockUntilPasswordChanged({ user, method: 'GET', path: '/api/reservations' }, fakeRes(), next);

    expect(next).toHaveBeenCalledWith();
  });

  it.each([
    ['GET', '/api/reservations'],
    ['POST', '/api/reservations'],
    ['GET', '/api/slots'],
    ['GET', '/api/users/password'],
    ['PUT', '/api/sessions/current'],
  ])('blocks %s %s with 403 PASSWORD_CHANGE_REQUIRED when the password must be changed', (method, path) => {
    const next = vi.fn();

    blockUntilPasswordChanged({ user: mustChange, method, path }, fakeRes(), next);

    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it.each([
    ['POST', '/api/sessions'],
    ['GET', '/api/sessions/current'],
    ['DELETE', '/api/sessions/current'],
    ['PUT', '/api/users/password'],
  ])('still allows %s %s, to log in or out and change the password', (method, path) => {
    const next = vi.fn();

    blockUntilPasswordChanged({ user: mustChange, method, path }, fakeRes(), next);

    expect(next).toHaveBeenCalledWith();
  });
});