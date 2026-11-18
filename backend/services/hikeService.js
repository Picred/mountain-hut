import { createHike, getActiveHikes } from '../models/dao/hikeDAO.js';
import BadRequestError from '../models/errors/BadRequestError.js';
import { isNonEmptyString, isPositiveInt, isValidIsoDateTime } from '../utils/validator.js';

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

    if (
        !isNonEmptyString(destination) ||
        !isNonEmptyString(route) ||
        !isNonEmptyString(scheduledDeparture) ||
        !isNonEmptyString(expectedArrival) ||
        !isPositiveInt(partySize)
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    if (
        !isValidIsoDateTime(scheduledDeparture) ||
        !isValidIsoDateTime(expectedArrival)
    ) {
        throw new BadRequestError('INVALID_DATE');
    }

    const departureTime = Date.parse(scheduledDeparture);
    const arrivalTime = Date.parse(expectedArrival);

    if (arrivalTime <= departureTime) {
        throw new BadRequestError('INVALID_TIME_RANGE');
    }

    if (departureTime < Date.now()) {
        throw new BadRequestError('DEPARTURE_IN_THE_PAST');
    }

    if (
        !Array.isArray(passages) ||
        passages.some(passage => !isNonEmptyString(passage))
    ) {
        throw new BadRequestError('INVALID_INPUT');
    }

    return await createHike(userId, {
        destination: destination.trim(),
        route: route.trim(),
        scheduledDeparture: new Date(departureTime).toISOString(),
        expectedArrival: new Date(arrivalTime).toISOString(),
        partySize,
        passages: passages.map(passage => passage.trim())
    });
};

export const listActiveHikes = async () => {
    return await getActiveHikes();
};