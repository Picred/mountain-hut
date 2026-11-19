import { describe, it, expect, vi } from 'vitest';
import ensureRole, { hasRole } from '../../../backend/middlewares/role-middleware.js';

/** Runs the middlewares of ensureRole(...roles) for a request of `user` and returns the error passed to next. */
function check(roles, user) {
    const req = { user, isAuthenticated: () => Boolean(user) };
    let error;
    for (const middleware of ensureRole(...roles)) {
        const next = vi.fn();
        middleware(req, {}, next);
        error = next.mock.calls[0][0];
        if (error) break;
    }
    return error?.status;
}

describe('hasRole', () => {
    it.each([
        ['employee', 'employee', true],
        ['warden', 'employee', true],
        ['hiker', 'employee', false],
        ['warden', 'warden', true],
        ['employee', 'warden', false],
        ['hiker', 'hiker', true],
        ['warden', 'hiker', false],
    ])('a %s has the %s role: %s', (userRole, role, expected) => {
        expect(hasRole({ role: userRole }, role)).toBe(expected);
    });

    it('returns false without a user', () => {
        expect(hasRole(undefined, 'employee')).toBe(false);
    });
});

describe('ensureRole', () => {
    it('returns 401 if the user is not logged in', () => {
        expect(check(['employee'], null)).toBe(401);
    });

    it.each([
        [['employee'], 'employee', undefined],
        [['employee'], 'warden', undefined],
        [['employee'], 'hiker', 403],
        [['hiker'], 'hiker', undefined],
        [['hiker'], 'warden', 403],
        [['hiker'], 'employee', 403],
        [['hiker', 'employee'], 'warden', undefined],
    ])('a route for %j answers a %s with %s', (roles, userRole, expected) => {
        expect(check(roles, { role: userRole })).toBe(expected);
    });
});
