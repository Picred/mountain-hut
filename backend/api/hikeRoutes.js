import { Router } from 'express';

import ensureRole from '../middlewares/role-middleware.js';
import { registerHike } from '../services/hikeService.js';

const router = Router();

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