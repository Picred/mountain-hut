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

export const createReservation = async (slotId, partySize) => {
    const response = await fetch(`${BASE_URL}/reservations`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
            slotId: Number(slotId),
            partySize: Number(partySize),
        }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        let errorMsg = 'Failed to create reservation.';

        if (response.status === 401) {
            errorMsg = 'You must be logged in to book a table.';
        } else if (response.status === 409) {
            if (data.error === 'ALREADY_BOOKED') {
                errorMsg = 'You already have a reservation for this time slot.';
            } else if (data.error === 'BOOKING_TOO_LATE') {
                errorMsg = 'Booking is no longer available (less than 2 hours remaining).';
            } else if (data.error === 'NO_AVAILABILITY') {
                errorMsg = 'Not enough seats available for this party size.';
            } else {
                errorMsg = data.message || 'Slot no longer available.';
            }
        } else if (response.status === 404) {
            errorMsg = 'Selected time slot was not found.';
        } else if (data.message) {
            errorMsg = data.message;
        }

        throw new Error(errorMsg);
    }

    return data;
};