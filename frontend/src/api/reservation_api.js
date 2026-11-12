const BASE_URL = `${import.meta.env.VITE_API_URL ?? "http://localhost:3001"}/api`;

export const listAvailableSlots = async (date) => {
    if (!date) return [];

    const response = await fetch(`${BASE_URL}/slots?date=${encodeURIComponent(date)}`, {
        credentials: "include"
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        if (response.status === 400) {
            throw new Error(errorData.message || 'Invalid date format.');
        }

        throw new Error('Server error while fetching available slots.');
    }

    // [{ slotId, startTime, endTime, bookingAllowed, restrictionReason }]
    return await response.json();
};

// Public check: no login is needed.
export const checkAvailability = async (slotId, partySize) => {
    const response = await fetch(
        `${BASE_URL}/slots/${Number(slotId)}/availability?partySize=${Number(partySize)}`,
        { credentials: "include" }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Selected time slot was not found.');
        }

        if (response.status === 400) {
            throw new Error('Invalid availability request.');
        }

        throw new Error('Server error while checking availability.');
    }

    // { slotId, partySize, available, tableAllocation: [{ tableId, tableCode, allocatedSeats }] }
    return data;
};

// Message shown for an error returned when a reservation is created.
// The employee flow has its own wording for some errors.
const reservationError = (status, data, byEmployee) => {
    if (status === 401) return 'You must be logged in to book a table.';
    if (status === 403) return 'You are not allowed to do this.';

    if (status === 400 && data.error === 'INVALID_INPUT') {
        return 'Some booking details are invalid. Please review them and try again.';
    }

    if (status === 404) {
        if (data.error === 'HIKER_NOT_FOUND') return 'The selected hiker could not be found.';
        return 'Selected time slot was not found.';
    }

    if (status === 409) {
        if (data.error === 'ALREADY_BOOKED') {
            return byEmployee
                ? 'This hiker already has a reservation for this time slot.'
                : 'You already have a reservation for this time slot.';
        }
        if (data.error === 'BOOKING_TOO_LATE') {
            return byEmployee
                ? 'This time slot has already started.'
                : 'Booking is no longer available (less than 2 hours remaining).';
        }
        if (data.error === 'NO_AVAILABILITY') return 'Not enough seats available for this party size.';
        if (data.error === 'EMAIL_ALREADY_USED') {
            return 'A hiker with this email already exists. Search for them with "Existing hiker".';
        }
        return data.message || 'Slot no longer available.';
    }

    return data.message || 'Failed to create reservation.';
};

const postReservation = async (body, byEmployee) => {
    const response = await fetch(`${BASE_URL}/reservations`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(reservationError(response.status, data, byEmployee));
    }

    return data;
};

export const createReservation = (slotId, partySize, requirements = []) =>
    postReservation({
        slotId: Number(slotId),
        partySize: Number(partySize),
        requirements,
    }, false);

// Employee only. hiker is { userId } | { name, email, phone } | { name, phone? }.
// With { name, email, phone } the backend registers the hiker with a random password and
// returns it in the response as temporaryPassword: the hiker must change it at the first login.
export const createReservationForHiker = (slotId, partySize, requirements = [], hiker) =>
    postReservation({
        slotId: Number(slotId),
        partySize: Number(partySize),
        requirements,
        hiker,
    }, true);

// Employee only: registered hikers whose name, email or phone contains the text.
// [{ userId, name, email, phone }]
export const searchHikers = async (text) => {
    const response = await fetch(
        `${BASE_URL}/hikers?search=${encodeURIComponent(text)}`,
        { credentials: 'include' }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new Error('Only employees can search hikers.');
        }
        throw new Error('Unable to search hikers.');
    }

    return data;
};