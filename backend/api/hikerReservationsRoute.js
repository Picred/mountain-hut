import { Router } from 'express';
import ensureAuthenticated from '../middlewares/auth-middleware.js';
import { getReservationsByUser } from '../models/dao/hikerReservationsDAO.js';

const router = Router();

// GET /api/reservations
router.get('/reservations', ensureAuthenticated, async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const reservations = await getReservationsByUser(userId);

        return res.status(200).json(reservations);
    } catch (err) {
        next(err);
    }
});

export default router;