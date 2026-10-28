import { Router } from 'express';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

import { getSlotsByDate } from '../models/dao/slotDAO.js';
import BadRequestError from '../models/errors/BadRequestError.js';

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

export default router;
