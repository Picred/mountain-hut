import { createHike, getActiveHikes, getMissingHikes, confirmSafeArrival, getHikersHikes } from '../models/dao/hikeDAO.js';
import BadRequestError from '../models/errors/BadRequestError.js';
import { isNonEmptyString, isPositiveInt, isValidIsoDateTime } from '../utils/validator.js';
import { MAX_ALERTS } from '../utils/missingHikeRules.js';

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

// Hikers considered missing, each with the number of its last alert and the total number of alerts
export const listMissingHikes = async () => {
    const hikes = await getMissingHikes();

    return hikes.map(hike => ({ ...hike, totalAlerts: MAX_ALERTS }));
};


export const confirmArrival = async (userId, hikeId) => {
    if (!Number.isInteger(Number(userId)) || Number(userId) < 1 ||
        !Number.isInteger(Number(hikeId)) || Number(hikeId) < 1) {
        throw new BadRequestError("INVALID_INPUT")
    }
    return await confirmSafeArrival(Number(userId), Number(hikeId));
}


export const listHikersHikes = async (userId) => {
    if (!Number.isInteger(Number(userId)) || Number(userId) < 1) {
        throw new BadRequestError('INVALID_INPUT');
    }
    return await getHikersHikes(Number(userId));
}