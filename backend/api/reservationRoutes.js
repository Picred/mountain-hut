import { Router } from 'express';

import { makeReservation, updateReservation } from '../models/dao/reservationDAO.js';
import { sendBookingConfirmation, sendChangesConfirmation } from '../services/confirmation.js';
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

    const { slotId, partySize, requirements } = req.body ?? {};

    // Validate the reservation data.
    if (
        !Number.isInteger(slotId) ||
        slotId <= 0 ||
        !Number.isInteger(partySize) ||
        partySize <= 0
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const reservation = requirements === undefined
        ? await makeReservation(slotId, userId, partySize)
        : await makeReservation(slotId, userId, partySize, requirements);
    // no await!!
    sendBookingConfirmation(reservation.reservationId);
    
    return res.status(201).json(reservation);
});

/**
 * PATCH /api/reservations/:reservationId
 *
 * Updates an authenticated hiker's reservation.
 */
router.patch('/:reservationId', async (req, res) => {
    const userId = req.user?.user_id;
    const reservationId = Number(req.params.reservationId);

    if (!userId) {
        throw new UnauthorizedError('UNAUTHORIZED');
    }

    if (!Number.isInteger(reservationId) || reservationId <= 0) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const { slotId, partySize, requirements } = req.body ?? {};

    if (
        slotId !== undefined &&
        (!Number.isInteger(slotId) || slotId <= 0)
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    if (
        partySize !== undefined &&
        (!Number.isInteger(partySize) || partySize <= 0)
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    if (requirements !== undefined) {
        if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) {
            throw new BadRequestError('INVALID_INPUT');
        }

        const { add, update, remove } = requirements;

        if (
            (add !== undefined && !Array.isArray(add)) ||
            (update !== undefined && !Array.isArray(update)) ||
            (remove !== undefined && !Array.isArray(remove))
        ) {
            throw new BadRequestError('INVALID_INPUT');
        }
    }

    if (
        slotId === undefined &&
        partySize === undefined &&
        requirements === undefined
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const reservation = await updateReservation(
        reservationId,
        userId,
        { slotId, partySize, requirements }
    );

    // Email failures are handled and logged by the confirmation service.
    sendChangesConfirmation(reservation.reservationId);

    return res.status(200).json(reservation);
});

export default router;
