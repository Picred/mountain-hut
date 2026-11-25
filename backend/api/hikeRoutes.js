import { Router } from 'express';

import ensureRole from '../middlewares/role-middleware.js';
import { registerHike, listActiveHikes, listMissingHikes, confirmArrival, listHikersHikes} from '../services/hikeService.js';

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
 * GET /api/hikes/missing
 *
 * Allows an employee to see the hikers considered missing (not back 2 hours after the expected
 * return time), with the number of the last alert sent. The web application asks for it to show the pop-up.
 */
router.get('/missing', ensureRole('employee'), async (req, res) => {
    const hikes = await listMissingHikes();

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


/**
 * PUT /api/hikes/:hikeId/confirm-arrival
 *
 */

router.put('/:hikeId/confirm-arrival',ensureRole('hiker'), async (req,res) => {
    const confirmed = await confirmArrival(
            req.user.user_id,
            req.params.hikeId
        );
    return res.status(200).json(confirmed);
})

/**
 * GET /api/hikes
 */

router.get('/', ensureRole('hiker'), async(req,res) => {
    const hikes = await listHikersHikes(req.user.user_id)

    return res.status(200).json(hikes);
})

export default router;
