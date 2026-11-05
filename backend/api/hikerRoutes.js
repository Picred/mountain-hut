import { Router } from 'express';

import ensureRole from '../middlewares/role-middleware.js';
import { searchHikers } from '../models/dao/hikerDAO.js';
import BadRequestError from '../models/errors/BadRequestError.js';

const router = Router();

/**
 * GET /api/hikers?search=text
 *
 * Lets an employee find a registered hiker by name, email or phone.
 */
router.get('/', ensureRole('employee'), async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    if (!search) {
        throw new BadRequestError('INVALID_INPUT');
    }

    return res.status(200).json(await searchHikers(search));
});

export default router;
