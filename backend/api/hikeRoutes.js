import { Router } from 'express';

import ensureRole from '../middlewares/role-middleware.js';
import { registerHike, listActiveHikes } from '../services/hikeService.js';

const router = Router();

/**
 * GET /api/hikes/active
 *
 * Allows an employee to view all hikers currently registered as being on a hike, ordered by expected return time.
 */
router.get('/active', ensureRole('employee'), async (req, res) => {
    const hikes = await listActiveHikes();

    return res.status(200).json(hikes);
});

/**
 * POST /api/hikes
 *
 * Allows an authenticated hiker to register a planned hike.
 */
router.post('/', ensureRole('hiker'), async (req, res) => {
    const hike = await registerHike(req.user.user_id, req.body);

    return res.status(201).json(hike);
});

export default router;