import { Router } from 'express';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

import ensureRole from '../middlewares/role-middleware.js';
import {
    listSlots,
    createSlot,
    addTablesToSlot,
    copyTablesToSlot
} from '../models/dao/capacityDAO.js';
import { listTables, createTable } from '../models/dao/tableDAO.js';
import BadRequestError from '../models/errors/BadRequestError.js';

dayjs.extend(customParseFormat);

const router = Router();

// only the employee defines slots and capacity
const employeeOnly = ensureRole('employee');

const MAX_TABLES_PER_REQUEST = 100;

const isId = value => Number.isInteger(value) && value > 0;

// date in the YYYY-MM-DD format
const isDate = value =>
    typeof value === 'string' && dayjs(value, 'YYYY-MM-DD', true).isValid();

// ISO 8601
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const isDateTime = value =>
    typeof value === 'string' &&
    ISO_DATE_TIME.test(value) &&
    isDate(value.slice(0, 10)) &&
    !Number.isNaN(Date.parse(value));

const parseId = value => (/^\d+$/.test(value) ? Number(value) : NaN);


// GET /api/slots/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/api/slots/capacity', employeeOnly, async (req, res) => {
    const { from, to } = req.query;

    if ((from !== undefined && !isDate(from)) || (to !== undefined && !isDate(to))) {
        throw new BadRequestError('INVALID_DATE');
    }
    if (from && to && from > to) {
        throw new BadRequestError('INVALID_DATE_RANGE');
    }

    const slots = await listSlots({ from, to });

    return res.status(200).json(slots);
});

// POST /api/slots
router.post('/api/slots', employeeOnly, async (req, res) => {
    const { startAt, endAt } = req.body ?? {};

    if (!isDateTime(startAt) || !isDateTime(endAt)) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const slot = await createSlot(startAt, endAt);

    return res.status(201).json(slot);
});

// POST /api/slots/:id/tables
router.post('/api/slots/:id/tables', employeeOnly, async (req, res) => {
    const slotId = parseId(req.params.id);
    const { tableIds } = req.body ?? {};

    if (
        !isId(slotId) ||
        !Array.isArray(tableIds) ||
        tableIds.length === 0 ||
        tableIds.length > MAX_TABLES_PER_REQUEST ||
        !tableIds.every(isId)
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const slot = await addTablesToSlot(slotId, tableIds);

    return res.status(201).json(slot);
});

// POST /api/slots/:id/copy-tables
router.post('/api/slots/:id/copy-tables', employeeOnly, async (req, res) => {
    const slotId = parseId(req.params.id);
    const { fromSlotId } = req.body ?? {};

    if (!isId(slotId) || !isId(fromSlotId)) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const slot = await copyTablesToSlot(slotId, fromSlotId);

    return res.status(201).json(slot);
});

// GET /api/tables
router.get('/api/tables', employeeOnly, async (req, res) => {
    const tables = await listTables();

    return res.status(200).json(tables);
});

// POST /api/tables
router.post('/api/tables', employeeOnly, async (req, res) => {
    const { seats } = req.body ?? {};
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

    if (code === '' || code.length > 20 || !isId(seats) || seats > 100) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const table = await createTable(code, seats);

    return res.status(201).json(table);
});

export default router;