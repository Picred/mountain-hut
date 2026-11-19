import ensureAuthenticated from './auth-middleware.js';
import ForbiddenError from '../models/errors/ForbiddenError.js';

// The warden can also perform the employee functions (see context.md).
export const hasRole = (user, role) =>
    user?.role === role || (role === 'employee' && user?.role === 'warden');

// usage: router.post('/', ensureRole('employee'), handler)
// not authenticated -> 401, wrong role -> 403

const ensureRole = (...roles) => [
    ensureAuthenticated,
    (req, res, next) => {
        if (!roles.some(role => hasRole(req.user, role))) {
            return next(new ForbiddenError('FORBIDDEN'));
        }
        next();
    }
];

export default ensureRole;
