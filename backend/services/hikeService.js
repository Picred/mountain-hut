import { createHike, getActiveHikes, getMissingHikes, confirmSafeArrival, getHikersHikes } from '../models/dao/hikeDAO.js';
import BadRequestError from '../models/errors/BadRequestError.js';
import { isNonEmptyString, isPositiveInt, isValidIsoDateTime } from '../utils/validator.js';
import { MAX_ALERTS } from '../utils/missingHikeRules.js';

// A party member: { name, phone? }, with a non-empty name and, if given, a non-empty phone
const isValidMember = (member) =>
    member !== null &&
    typeof member === 'object' &&
    !Array.isArray(member) &&
    isNonEmptyString(member.name) &&
    (member.phone == null || isNonEmptyString(member.phone));

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
        passages = [],
        members = []
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

    // the other people of the party, some or all of them (none too): the hiker who registers the hike is the point of contact
    if (!Array.isArray(members) || members.some(member => !isValidMember(member))) {
        throw new BadRequestError('INVALID_INPUT');
    }

    if (members.length > partySize - 1) {
        throw new BadRequestError('PARTY_SIZE_MISMATCH');
    }

    return await createHike(userId, {
        destination: destination.trim(),
        route: route.trim(),
        scheduledDeparture: new Date(departureTime).toISOString(),
        expectedArrival: new Date(arrivalTime).toISOString(),
        partySize,
        passages: passages.map(passage => passage.trim()),
        members: members.map(member => ({
            name: member.name.trim(),
            phone: member.phone == null ? null : member.phone.trim()
        }))
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