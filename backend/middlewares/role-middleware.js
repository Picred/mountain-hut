import ensureAuthenticated from './auth-middleware.js';
import ForbiddenError from '../models/errors/ForbiddenError.js';

// usage: router.post('/', ensureRole('employee'), handler)
// not authenticated -> 401, wrong role -> 403

const ensureRole = (...roles) => [
    ensureAuthenticated,
    (req, res, next) => {
        if (!roles.includes(req.user?.role)) {
            return next(new ForbiddenError('FORBIDDEN'));
        }
        next();
    }
];

export default ensureRole;