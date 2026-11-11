import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every dependency of the unit under test is replaced by a fake: no database, no real passport, no email
vi.mock('../../../backend/db/db.js', () => ({
  default: { get: vi.fn(), run: vi.fn() },
}));
vi.mock('../../../backend/models/dao/authenticationDAO.js', () => ({
  getUser: vi.fn(),
  createUser: vi.fn(),
  changePassword: vi.fn(),
  getHikerByEmail: vi.fn(),
  saveResetToken: vi.fn(),
  getUserByResetToken: vi.fn(),
}));
vi.mock('../../../backend/services/passwordRecovery.js', () => ({
  sendPasswordRecovery: vi.fn(),
  buildPasswordRecoveryEmail: vi.fn(),
}));
vi.mock('../../../backend/services/emailService.js', () => ({
  sendEmail: vi.fn(),
}));
vi.mock('passport', () => ({
  default: { use: vi.fn(), serializeUser: vi.fn(), deserializeUser: vi.fn(), authenticate: vi.fn() },
}));

import db from '../../../backend/db/db.js';
import {
  changePassword as changePasswordMock,
  getHikerByEmail as getHikerByEmailMock,
  saveResetToken as saveResetTokenMock,
  getUserByResetToken as getUserByResetTokenMock,
} from '../../../backend/models/dao/authenticationDAO.js';
import { sendPasswordRecovery as sendPasswordRecoveryMock } from '../../../backend/services/passwordRecovery.js';
import { sendEmail } from '../../../backend/services/emailService.js';
import router from '../../../backend/api/authenticationRoutes.js';
import BadRequestError from '../../../backend/models/errors/BadRequestError.js';

// The DAO and the email service are tested for real: only the db and the transport are fake
const { changePassword, saveResetToken, getUserByResetToken } =
  await vi.importActual('../../../backend/models/dao/authenticationDAO.js');
const { buildPasswordRecoveryEmail, sendPasswordRecovery } =
  await vi.importActual('../../../backend/services/passwordRecovery.js');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const DAY_MS = 24 * 60 * 60 * 1000;

// sqlite3 callbacks: db.get(sql, params, cb(err, row)) and db.run(sql, params, cb(err)) with this.changes
const dbGetReturns = (row) => db.get.mockImplementation((_sql, _params, cb) => cb(null, row));
const dbRunChanges = (changes) => db.run.mockImplementation((_sql, _params, cb) => cb.call({ changes }, null));

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

describe('authenticationDAO - reset token', () => {
  it('saveResetToken saves the hash and the expiration of the token', async () => {
    dbRunChanges(1);

    await expect(saveResetToken(3, 'hash', '2030-01-01T00:00:00.000Z')).resolves.toBe(true);

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toMatch(/SET reset_token_hash = \?, reset_token_expires_at = \?/);
    expect(params).toEqual(['hash', '2030-01-01T00:00:00.000Z', 3]);
  });

  it('getUserByResetToken returns the user only for a token that has not expired', async () => {
    dbGetReturns({ user_id: 3 });
    await expect(getUserByResetToken('hash')).resolves.toEqual({ user_id: 3 });
    expect(db.get.mock.calls[0][0]).toMatch(/WHERE reset_token_hash = \? AND reset_token_expires_at > \?/);

    dbGetReturns(undefined);
    await expect(getUserByResetToken('hash')).resolves.toBeNull();
  });

  it('changePassword invalidates the reset token, so a link works only once', async () => {
    dbRunChanges(1);

    await changePassword(3, 'new-secret');

    expect(db.run.mock.calls[0][0]).toMatch(/reset_token_hash = NULL, reset_token_expires_at = NULL/);
  });
});

describe('passwordRecovery service', () => {
  const link = 'http://localhost:5173/reset-password?token=abc123';

  it('builds an email with the link and its validity', () => {
    const email = buildPasswordRecoveryEmail('Anna Winden', link);

    expect(email.subject).toBe('Mountain Hut - Password recovery');
    expect(email.text).toContain(link);
    expect(email.text).toContain('valid for 24 hours and can be used only once');
    expect(email.html).toContain(`<a href="${link}">`);
  });

  it('never throws: when the email is not sent it returns false', async () => {
    sendEmail.mockRejectedValue(new Error('Invalid login'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sendPasswordRecovery('anna@mountainhut.test', 'Anna Winden', link)).resolves.toBe(false);

    consoleError.mockRestore();
  });
});

describe('POST /api/users/password-reset', () => {
  const requestReset = handler('post', '/api/users/password-reset');
  const anna = { user_id: 3, name: 'Anna Winden', email: 'anna@mountainhut.test', role: 'hiker' };

  it('rejects a missing or blank email with BadRequestError', async () => {
    const next = vi.fn();

    await requestReset({ body: { email: '   ' } }, fakeRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(BadRequestError);
    expect(getHikerByEmailMock).not.toHaveBeenCalled();
  });

  it('saves only the hash of a token valid for 24 hours, emails the link and keeps the password', async () => {
    getHikerByEmailMock.mockResolvedValue(anna);
    saveResetTokenMock.mockResolvedValue(true);
    sendPasswordRecoveryMock.mockResolvedValue(true);
    const res = fakeRes();

    await requestReset({ body: { email: anna.email } }, res, vi.fn());

    const link = new URL(sendPasswordRecoveryMock.mock.calls[0][2]);
    const token = link.searchParams.get('token');
    expect(link.pathname).toBe('/reset-password');

    const [userId, tokenHash, expiresAt] = saveResetTokenMock.mock.calls[0];
    expect(userId).toBe(3);
    expect(tokenHash).toBe(sha256(token));
    expect(Math.abs(new Date(expiresAt) - (Date.now() + DAY_MS))).toBeLessThan(5000);

    // the current password keeps working until the link is used
    expect(changePasswordMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('responds 204 also when the email is not of a hiker, without sending anything', async () => {
    getHikerByEmailMock.mockResolvedValue(null);
    const res = fakeRes();

    await requestReset({ body: { email: 'nobody@example.com' } }, res, vi.fn());

    expect(sendPasswordRecoveryMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });
});

describe('POST /api/users/password-reset/confirm', () => {
  const confirmReset = handler('post', '/api/users/password-reset/confirm');

  it('rejects a missing token or a short password with BadRequestError', async () => {
    const next = vi.fn();

    await confirmReset({ body: { newPassword: 'new-secret' } }, fakeRes(), next);
    await confirmReset({ body: { token: 'abc', newPassword: '12345' } }, fakeRes(), next);

    expect(next.mock.calls[0][0].message).toBe('INVALID_INPUT');
    expect(next.mock.calls[1][0].message).toBe('The password must contain at least 6 characters.');
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it('rejects with INVALID_OR_EXPIRED_TOKEN when no valid token matches', async () => {
    getUserByResetTokenMock.mockResolvedValue(null);
    const next = vi.fn();

    await confirmReset({ body: { token: 'abc', newPassword: 'new-secret' } }, fakeRes(), next);

    expect(next.mock.calls[0][0].message).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it('saves the new password and responds 204', async () => {
    getUserByResetTokenMock.mockResolvedValue({ user_id: 3 });
    changePasswordMock.mockResolvedValue(true);
    const res = fakeRes();

    await confirmReset({ body: { token: 'abc', newPassword: 'new-secret' } }, res, vi.fn());

    expect(getUserByResetTokenMock).toHaveBeenCalledWith(sha256('abc'));
    expect(changePasswordMock).toHaveBeenCalledWith(3, 'new-secret');
    expect(res.status).toHaveBeenCalledWith(204);
  });
});