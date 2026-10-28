import { Router } from 'express';

import { makeReservation } from '../models/dao/reservationDAO.js';
import BadRequestError from '../models/errors/BadRequestError.js';
import UnauthorizedError from '../models/errors/UnauthorizedError.js';

const router = Router();

/**
 * POST /api/reservations
 *
 * Creates a confirmed table reservation for an authenticated hiker.
 */
router.post('/', async (req, res) => {
    // The authenticated user is provided by the authentication middleware.
    const userId = req.user?.user_id;

    if (!userId) {
        throw new UnauthorizedError('UNAUTHORIZED');
    }

    const { slotId, partySize } = req.body ?? {};

    // Validate the reservation data.
    if (
        !Number.isInteger(slotId) ||
        slotId <= 0 ||
        !Number.isInteger(partySize) ||
        partySize <= 0
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const reservation = await makeReservation(
        slotId,
        userId,
        partySize
    );

    return res.status(201).json(reservation);
});

export default router;
