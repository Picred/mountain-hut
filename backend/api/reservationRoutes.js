import { Router } from 'express';

import { makeReservation, updateReservation } from '../models/dao/reservationDAO.js';
import { hashPassword } from '../models/dao/authenticationDAO.js';
import { sendBookingConfirmation, sendChangesConfirmation } from '../services/confirmation.js';
import BadRequestError from '../models/errors/BadRequestError.js';
import UnauthorizedError from '../models/errors/UnauthorizedError.js';

const router = Router();

const isText = value => typeof value === 'string' && value.trim().length > 0;

/**
 * Reads the hiker an employee is booking for:
 * - { userId }: a registered hiker
 * - { name, email, phone, password }: a new hiker, registered with the reservation
 * - { name, phone? }: a temporary hiker, who cannot log in
 */
const readHiker = async (hiker, employeeId) => {
    if (!hiker || typeof hiker !== 'object' || Array.isArray(hiker)) {
        throw new BadRequestError('INVALID_INPUT');
    }

    if (hiker.userId !== undefined) {
        if (!Number.isInteger(hiker.userId) || hiker.userId <= 0) {
            throw new BadRequestError('INVALID_INPUT');
        }
        return { userId: hiker.userId, byEmployee: { employeeId } };
    }

    if (hiker.email !== undefined || hiker.password !== undefined) {
        const { name, email, phone, password } = hiker;
        if (![name, email, phone, password].every(isText) || password.length < 6) {
            throw new BadRequestError('INVALID_INPUT');
        }
        const { salt, passwordHash } = await hashPassword(password);
        return {
            userId: null,
            byEmployee: {
                employeeId,
                newHiker: { name: name.trim(), email: email.trim(), phone: phone.trim(), salt, passwordHash }
            }
        };
    }

    if (!isText(hiker.name) || (hiker.phone !== undefined && typeof hiker.phone !== 'string')) {
        throw new BadRequestError('INVALID_INPUT');
    }
    return {
        userId: null,
        byEmployee: { employeeId, guest: { name: hiker.name.trim(), phone: hiker.phone?.trim() || null } }
    };
};

/**
 * POST /api/reservations
 *
 * Creates a confirmed table reservation for an authenticated hiker,
 * or for the hiker given in the body when the user is an employee.
 */
router.post('/', async (req, res) => {
    // The authenticated user is provided by the authentication middleware.
    const userId = req.user?.user_id;

    if (!userId) {
        throw new UnauthorizedError('UNAUTHORIZED');
    }

    const { slotId, partySize, requirements, hiker } = req.body ?? {};

    // Validate the reservation data.
    if (
        !Number.isInteger(slotId) ||
        slotId <= 0 ||
        !Number.isInteger(partySize) ||
        partySize <= 0
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    let reservation;
    if (req.user.role === 'employee') {
        const booking = await readHiker(hiker, userId);
        reservation = await makeReservation(slotId, booking.userId, partySize, requirements, booking.byEmployee);
    } else {
        reservation = requirements === undefined
            ? await makeReservation(slotId, userId, partySize)
            : await makeReservation(slotId, userId, partySize, requirements);
    }
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
