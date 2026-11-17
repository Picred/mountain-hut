import { createHike } from '../models/dao/hikeDAO.js';
import BadRequestError from '../models/errors/BadRequestError.js';

export const registerHike = async (userId, data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const {
        destination,
        route,
        scheduledDeparture,
        expectedArrival,
        partySize,
        passages = []
    } = data;

    const isNonEmptyString = value =>
        typeof value === 'string' && value.trim().length > 0;

    if (
        !isNonEmptyString(destination) ||
        !isNonEmptyString(route) ||
        !isNonEmptyString(scheduledDeparture) ||
        !isNonEmptyString(expectedArrival) ||
        !Number.isInteger(partySize) ||
        partySize <= 0
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const isValidCalendarDate = value => {
        const [year, month, day] = value.slice(0, 10).split('-').map(Number);

        const date = new Date(0);
        date.setUTCFullYear(year, month - 1, day);

        return (
            date.getUTCFullYear() === year &&
            date.getUTCMonth() === month - 1 &&
            date.getUTCDate() === day
        );
    };

    const isValidTime = value => {
        const match = value.match(
            /T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/
        );

        if (!match) return false;

        const [, hours, minutes, seconds, timezone] = match;

        if (
            Number(hours) > 23 ||
            Number(minutes) > 59 ||
            Number(seconds) > 59
        ) {
            return false;
        }

        if (timezone !== 'Z') {
            const offsetHours = Number(timezone.slice(1, 3));
            const offsetMinutes = Number(timezone.slice(4, 6));

            if (
                offsetHours > 14 ||
                offsetMinutes > 59 ||
                (offsetHours === 14 && offsetMinutes !== 0)
            ) {
                return false;
            }
        }

        return true;
    };

    const isoDateTimeRegex =
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

    if (
        !isoDateTimeRegex.test(scheduledDeparture) ||
        !isoDateTimeRegex.test(expectedArrival) ||
        !isValidCalendarDate(scheduledDeparture) ||
        !isValidCalendarDate(expectedArrival) ||
        !isValidTime(scheduledDeparture) ||
        !isValidTime(expectedArrival)
    ) {
        throw new BadRequestError('INVALID_DATE');
    }

    const departureTime = Date.parse(scheduledDeparture);
    const arrivalTime = Date.parse(expectedArrival);

    if (
        !Number.isFinite(departureTime) ||
        !Number.isFinite(arrivalTime)
    ) {
        throw new BadRequestError('INVALID_DATE');
    }

    if (arrivalTime <= departureTime) {
        throw new BadRequestError('INVALID_TIME_RANGE');
    }

    if (departureTime < Date.now()) {
        throw new BadRequestError('DEPARTURE_IN_THE_PAST');
    }

    const normalizedDeparture = new Date(departureTime).toISOString();
    const normalizedArrival = new Date(arrivalTime).toISOString();

    if (
        !Array.isArray(passages) ||
        passages.some(passage => !isNonEmptyString(passage))
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    const normalizedPassages = passages.map(passage => passage.trim());

    return await createHike(userId, {
        destination: destination.trim(),
        route: route.trim(),
        scheduledDeparture: normalizedDeparture,
        expectedArrival: normalizedArrival,
        partySize,
        passages: normalizedPassages
    });
};