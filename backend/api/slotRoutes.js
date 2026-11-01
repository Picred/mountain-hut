import { Router } from 'express';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

import { getSlotsByDate, getSecondsUntilStart } from '../models/dao/slotDAO.js';
import { checkAvailability } from '../models/dao/reservationDAO.js';
import BadRequestError from '../models/errors/BadRequestError.js';
import NotFoundError from '../models/errors/NotFoundError.js';

dayjs.extend(customParseFormat);

const router = Router();

/**
 * GET /api/slots?date=YYYY-MM-DD
 *
 * Returns the slots for the selected date, including
 * whether each slot can still be booked.
 */
router.get('/', async (req, res) => {
    const { date } = req.query;

    // Validate the date using the expected YYYY-MM-DD format.
    if (
        typeof date !== 'string' ||
        !dayjs(date, 'YYYY-MM-DD', true).isValid()
    ) {
        throw new BadRequestError('INVALID_DATE');
    }

    const slots = await getSlotsByDate(date);

    return res.status(200).json(slots);
});

/**
 * GET /api/slots/:slotId/availability?partySize=N
 *
 * Public check: tells whether a party can book the slot, based on the
 * free seats and the table layout, and how it would be seated.
 */
router.get('/:slotId/availability', async (req, res) => {
    const slotId = Number(req.params.slotId);
    const partySize = Number(req.query.partySize);

    if (
        !Number.isInteger(slotId) ||
        slotId <= 0 ||
        !Number.isInteger(partySize) ||
        partySize <= 0
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const secondsUntilStart = await getSecondsUntilStart(slotId);

    if (secondsUntilStart === null) {
        throw new NotFoundError('SLOT_NOT_FOUND');
    }

    // Bookings must be made at least 2 hours before the slot starts.
    const { available, tableAllocation } = secondsUntilStart >= 7200
        ? await checkAvailability(slotId, partySize)
        : { available: false, tableAllocation: [] };

    return res.status(200).json({
        slotId,
        partySize,
        available,
        tableAllocation: tableAllocation.map(table => ({
            tableId: table.tableId,
            tableCode: table.tableCode,
            allocatedSeats: table.allocatedSeats
        }))
    });
});

export default router;
