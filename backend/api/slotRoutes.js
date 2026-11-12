import { Router } from 'express';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

import ensureRole from '../middlewares/role-middleware.js';
import {
    getSlotsByDate,
    getSecondsUntilStart,
    setSlotMenu,
    getPreviousMenus
} from '../models/dao/slotDAO.js';
import { checkAvailability } from '../models/dao/reservationDAO.js';
import BadRequestError from '../models/errors/BadRequestError.js';
import NotFoundError from '../models/errors/NotFoundError.js';

dayjs.extend(customParseFormat);

const router = Router();

// only the employee defines the menus
const employeeOnly = ensureRole('employee');

const MAX_MENU_LENGTH = 2000;

const isId = value => Number.isInteger(value) && value > 0;
const parseId = value => (/^\d+$/.test(value) ? Number(value) : NaN);

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

    const slots = await getSlotsByDate(date, req.user?.role === 'employee');

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

    // Hikers book at least 2 hours before the slot starts, an employee until it starts.
    const minimumSeconds = req.user?.role === 'employee' ? 1 : 7200;
    const { available, tableAllocation } = secondsUntilStart >= minimumSeconds
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

/**
 * GET /api/slots/menus
 *
 * Returns the menus already defined, to reuse (and change) them.
 */
router.get('/menus', employeeOnly, async (req, res) => {
    const menus = await getPreviousMenus();

    return res.status(200).json(menus);
});

/**
 * PUT /api/slots/:slotId/menu
 *
 * Sets the menu of a slot: free text with basic Markdown formatting
 * (**bold**, *italic*, lists and sub-items), rendered by the frontend.
 */
router.put('/:slotId/menu', employeeOnly, async (req, res) => {
    const slotId = parseId(req.params.slotId);
    const menu = typeof req.body?.menu === 'string' ? req.body.menu.trim() : '';

    if (!isId(slotId) || menu === '' || menu.length > MAX_MENU_LENGTH) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const slot = await setSlotMenu(slotId, menu);

    return res.status(200).json(slot);
});

/**
 * DELETE /api/slots/:slotId/menu
 *
 * Removes the menu of a slot.
 */
router.delete('/:slotId/menu', employeeOnly, async (req, res) => {
    const slotId = parseId(req.params.slotId);

    if (!isId(slotId)) {
        throw new BadRequestError('INVALID_INPUT');
    }

    await setSlotMenu(slotId, null);

    return res.status(204).end();
});

export default router;
