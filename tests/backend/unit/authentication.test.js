import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every dependency of the unit under test is replaced by a fake: no database, no real passport
vi.mock('../../../backend/db/db.js', () => ({
  default: { get: vi.fn(), run: vi.fn() },
}));
vi.mock('../../../backend/models/dao/authenticationDAO.js', () => ({
  getUser: vi.fn(),
  createUser: vi.fn(),
}));
vi.mock('passport', () => ({
  default: { use: vi.fn(), serializeUser: vi.fn(), deserializeUser: vi.fn(), authenticate: vi.fn() },
}));

import db from '../../../backend/db/db.js';
import passport from 'passport';
import { getUser as getUserMock, createUser as createUserMock } from '../../../backend/models/dao/authenticationDAO.js';
import ensureAuthenticated from '../../../backend/middlewares/auth-middleware.js';
import router from '../../../backend/api/authenticationRoutes.js';
import BadRequestError from '../../../backend/models/errors/BadRequestError.js';
import ConflictError from '../../../backend/models/errors/ConflictError.js';
import UnauthorizedError from '../../../backend/models/errors/UnauthorizedError.js';

// The DAO itself is tested for real, only its db is fake
const { getUser, createUser } = await vi.importActual('../../../backend/models/dao/authenticationDAO.js');

// LocalStrategy registered by authenticationRoutes.js at import time
const verify = passport.use.mock.calls[0][0]._verify;

const SALT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

function userRow(password) {
  return {
    user_id: 3,
    name: 'Anna Winden',
    email: 'anna@mountainhut.test',
    phone: '+393401234567',
    role: 'hiker',
    salt: SALT,
    password_hash: crypto.scryptSync(password, SALT, 32).toString('hex'),
  };
}

// sqlite3 callbacks: db.get(sql, params, cb(err, row)) and db.run(sql, params, cb(err)) with this.lastID
const dbGetReturns = (row) => db.get.mockImplementation((_sql, _params, cb) => cb(null, row));
const dbRunInserts = (lastID) => db.run.mockImplementation((_sql, _params, cb) => cb.call({ lastID }, null));
const dbRunFails = (message) => db.run.mockImplementation((_sql, _params, cb) => cb(new Error(message)));

// Last handler of a route (the one after ensureAuthenticated, if present)
function handler(method, path) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
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

describe('ensureAuthenticated', () => {
  it('calls next() without errors when the user is authenticated', () => {
    const next = vi.fn();

    ensureAuthenticated({ isAuthenticated: () => true }, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() with a 401 UnauthorizedError when the user is not authenticated', () => {
    const next = vi.fn();

    ensureAuthenticated({ isAuthenticated: () => false }, {}, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
    expect(next.mock.calls[0][0].status).toBe(401);
  });
});

describe('authenticationDAO', () => {
  describe('getUser', () => {
    it('returns the user, without password hash and salt, when the password is correct', async () => {
      dbGetReturns(userRow('password'));

      const user = await getUser('anna@mountainhut.test', 'password');

      expect(db.get.mock.calls[0][1]).toEqual(['anna@mountainhut.test']);
      expect(user).toMatchObject({ user_id: 3, email: 'anna@mountainhut.test', role: 'hiker' });
      expect(user).not.toHaveProperty('password_hash');
      expect(user).not.toHaveProperty('salt');
    });

    it('returns false when the password is wrong', async () => {
      dbGetReturns(userRow('password'));

      await expect(getUser('anna@mountainhut.test', 'wrong-password')).resolves.toBe(false);
    });

    it('returns false when the email does not exist', async () => {
      dbGetReturns(undefined);

      await expect(getUser('nobody@mountainhut.test', 'password')).resolves.toBe(false);
    });
  });

  describe('createUser', () => {
    it('stores a salted scrypt hash, never the plain password, and returns the new user', async () => {
      dbRunInserts(6);

      const user = await createUser('Mario Rossi', 'mario@example.com', '3331234567', 'secret1');

      const [name, email, phone, hash, salt, role] = db.run.mock.calls[0][1];
      expect([name, email, phone, role]).toEqual(['Mario Rossi', 'mario@example.com', '3331234567', 'hiker']);
      expect(hash).not.toBe('secret1');
      expect(hash).toBe(crypto.scryptSync('secret1', salt, 32).toString('hex'));
      expect(user).toEqual({ user_id: 6, name: 'Mario Rossi', email: 'mario@example.com', phone: '3331234567', role: 'hiker' });
    });

    it('returns isDuplicate when the email is already registered', async () => {
      dbRunFails('SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email');

      await expect(createUser('Mario', 'anna@mountainhut.test', '333', 'secret1')).resolves.toEqual({ isDuplicate: true });
    });

    it('rejects on any other database error', async () => {
      dbRunFails('SQLITE_IOERR');

      await expect(createUser('Mario', 'mario@example.com', '333', 'secret1')).rejects.toThrow('SQLITE_IOERR');
    });
  });
});

describe('authenticationRoutes', () => {
  const user = { user_id: 3, email: 'anna@mountainhut.test', role: 'hiker' };
  const newUser = { user_id: 6, name: 'Mario Rossi', email: 'mario@example.com', phone: '3331234567', role: 'hiker' };
  const validBody = { name: 'Mario Rossi', email: 'mario@example.com', phone: '3331234567', password: 'secret1' };

  describe('LocalStrategy verify', () => {
    it('passes the user to passport when the credentials are valid', async () => {
      getUserMock.mockResolvedValue(user);
      const callback = vi.fn();

      await verify('anna@mountainhut.test', 'password', callback);

      expect(getUserMock).toHaveBeenCalledWith('anna@mountainhut.test', 'password');
      expect(callback).toHaveBeenCalledWith(null, user);
    });

    it('passes false and an error message when the credentials are invalid', async () => {
      getUserMock.mockResolvedValue(false);
      const callback = vi.fn();

      await verify('anna@mountainhut.test', 'wrong', callback);

      expect(callback).toHaveBeenCalledWith(null, false, { message: 'Email o password non valide.' });
    });
  });

  describe('POST /api/users', () => {
    const register = handler('post', '/api/users');

    it('rejects with BadRequestError when a field is missing, without touching the DAO', async () => {
      const next = vi.fn();

      await register({ body: { ...validBody, phone: '' } }, fakeRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(BadRequestError);
      expect(createUserMock).not.toHaveBeenCalled();
    });

    it('rejects with BadRequestError when the password is shorter than 6 characters', async () => {
      const next = vi.fn();

      await register({ body: { ...validBody, password: '12345' } }, fakeRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(BadRequestError);
      expect(next.mock.calls[0][0].message).toBe('La password deve contenere almeno 6 caratteri');
    });

    it('rejects with ConflictError when the email is already in use', async () => {
      createUserMock.mockResolvedValue({ isDuplicate: true });
      const next = vi.fn();

      await register({ body: validBody }, fakeRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(ConflictError);
    });

    it('logs the new user in and responds 201 with the user', async () => {
      createUserMock.mockResolvedValue(newUser);
      const req = { body: validBody, login: vi.fn((_user, cb) => cb()) };
      const res = fakeRes();

      await register(req, res, vi.fn());

      expect(createUserMock).toHaveBeenCalledWith('Mario Rossi', 'mario@example.com', '3331234567', 'secret1');
      expect(req.login.mock.calls[0][0]).toEqual(newUser);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(newUser);
    });
  });

  describe('POST /api/sessions', () => {
    const login = handler('post', '/api/sessions');

    // passport.authenticate('local', cb) returns a middleware that calls cb(err, user, info)
    const authenticateWith = (err, authUser, info) =>
      passport.authenticate.mockImplementation((_strategy, cb) => () => cb(err, authUser, info));

    it('rejects with UnauthorizedError carrying the strategy message when authentication fails', () => {
      authenticateWith(null, false, { message: 'Email o password non valide.' });
      const next = vi.fn();

      login({}, fakeRes(), next);

      expect(passport.authenticate.mock.calls[0][0]).toBe('local');
      expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
      expect(next.mock.calls[0][0].message).toBe('Email o password non valide.');
    });

    it('logs the user in and responds 201 with the session user', () => {
      authenticateWith(null, user);
      const req = { login: vi.fn((authUser, cb) => { req.user = authUser; cb(); }) };
      const res = fakeRes();

      login(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(user);
    });
  });

  describe('DELETE /api/sessions/current', () => {
    it('logs the user out and responds 204', () => {
      const logout = handler('delete', '/api/sessions/current');
      const req = { logout: vi.fn((cb) => cb()) };
      const res = fakeRes();

      logout(req, res, vi.fn());

      expect(req.logout).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
    });
  });
});
