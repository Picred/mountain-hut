import { Router } from 'express';
import crypto from 'node:crypto';
import { makeReservation, updateReservation, cancelReservation } from '../models/dao/reservationDAO.js';
import { hashPassword } from '../models/dao/authenticationDAO.js';
import { sendBookingConfirmation, sendChangesConfirmation, sendCancellationConfirmation } from '../services/confirmation.js';
import BadRequestError from '../models/errors/BadRequestError.js';
import UnauthorizedError from '../models/errors/UnauthorizedError.js';
import ensureRole, { hasRole } from '../middlewares/role-middleware.js';
import {
    employeeUpdateReservation,
    employeeCancelReservation,
    getReservationDetail
} from '../models/dao/employeeReservationDAO.js';

const router = Router();

const isText = value => typeof value === 'string' && value.trim().length > 0;

/**
 * Reads the hiker an employee is booking for:
 * - { userId }: a registered hiker
 * - { name, email, phone }: a new hiker, registered with the reservation with a random
 *   password, that must be changed at the first login
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

    if (hiker.email !== undefined) {
        const { name, email, phone } = hiker;
        if (![name, email, phone].every(isText)) {
            throw new BadRequestError('INVALID_INPUT');
        }
        const password = crypto.randomBytes(9).toString('base64url');
        const { salt, passwordHash } = await hashPassword(password);
        return {
            userId: null,
            temporaryPassword: password,
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
    if (hasRole(req.user, 'employee')) {
        const booking = await readHiker(hiker, userId);
        reservation = await makeReservation(slotId, booking.userId, partySize, requirements, booking.byEmployee);
        if (booking.temporaryPassword) {
            reservation.temporaryPassword = booking.temporaryPassword;
        }
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
 * GET /api/reservations/:reservationId
 *
 * Employee only: full detail of a reservation (hiker, contacts, requirements, tables).
 */
router.get('/:reservationId', ensureRole('employee'), async (req, res) => {
    const reservationId = Number(req.params.reservationId);

    if (!Number.isInteger(reservationId) || reservationId <= 0) {
        throw new BadRequestError('INVALID_INPUT');
    }

    return res.status(200).json(await getReservationDetail(reservationId));
});

/**
 * PATCH /api/reservations/:reservationId
 *
 * Hiker: updates their own reservation (slotId, partySize, requirements).
 * Employee: updates any confirmed reservation (partySize, requirements, allocation).
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

    const { slotId, partySize, requirements, allocation } = req.body ?? {};
    const isEmployee = hasRole(req.user, 'employee');

    if (slotId !== undefined && (!Number.isInteger(slotId) || slotId <= 0)) {
        throw new BadRequestError('INVALID_INPUT');
    }

    if (partySize !== undefined && (!Number.isInteger(partySize) || partySize <= 0)) {
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

    // The allocation (which table each person sits at) is decided by the employee only.
    if (allocation !== undefined && (!isEmployee || !Array.isArray(allocation))) {
        throw new BadRequestError('INVALID_INPUT');
    }

    // The employee cannot change slot for now (to be confirmed with the product owner).
    if (isEmployee && slotId !== undefined) {
        throw new BadRequestError('SLOT_CHANGE_NOT_ALLOWED');
    }

    if (
        slotId === undefined &&
        partySize === undefined &&
        requirements === undefined &&
        allocation === undefined
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const reservation = isEmployee
        ? await employeeUpdateReservation(reservationId, { partySize, requirements, allocation })
        : await updateReservation(reservationId, userId, { slotId, partySize, requirements });

    // Email failures are handled and logged by the confirmation service
    // (guests have no email: nothing is sent).
    sendChangesConfirmation(reservation.reservationId);

    return res.status(200).json(reservation);
});

/**
 * DELETE /api/reservations/:reservationId
 *
 * Cancels a reservation: the owner's own one, or any confirmed one for an employee.
 */
router.delete('/:reservationId', async (req, res) => {
    const userId = req.user?.user_id;
    const reservationId = Number(req.params.reservationId);

    if (!userId) {
        throw new UnauthorizedError('UNAUTHORIZED');
    }

    if (!Number.isInteger(reservationId) || reservationId <= 0) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const reservation = hasRole(req.user, 'employee')
        ? await employeeCancelReservation(reservationId)
        : await cancelReservation(reservationId, userId);

    // Email failures are handled and logged by the confirmation service.
    sendCancellationConfirmation(reservation.reservationId);

    return res.status(200).json(reservation);
});

export default router;
