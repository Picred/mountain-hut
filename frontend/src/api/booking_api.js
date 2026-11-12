const BASE_URL = `${import.meta.env.VITE_API_URL ?? "http://localhost:3001"}/api`;

const errorMessage = (status, error) => {
    if (status === 400 && error === "INVALID_INPUT") {
        return "Some booking details are invalid. Please review them and try again.";
    }

    if (status === 401) {
        return "Please log in to manage your reservations.";
    }

    if (status === 403) {
        return "You can only change your own reservations.";
    }

    if (status === 404) {
        if (error === "RESERVATION_NOT_FOUND") return "This reservation could not be found.";
        if (error === "REQUIREMENT_NOT_FOUND") return "A party requirement could not be found. Reload and try again.";
        if (error === "SLOT_NOT_FOUND") return "The selected time slot could not be found.";
        if (error === "RESERVATION_NOT_CANCELLABLE") return "This reservation has already been cancelled or can no longer be cancelled.";
    }

    if (status === 409) {
        if (error === "EDIT_WINDOW_EXPIRED") {
            return "This reservation can no longer be changed because it is less than 48 hours before the booked date.";
        }
        if (error === "RESERVATION_NOT_EDITABLE") {
            return "This reservation can no longer be changed.";
        }
        if (error === "BOOKING_TOO_LATE") {
            return "Reservations cannot be changed less than two hours before the time slot.";
        }
        if (error === "NO_AVAILABILITY") {
            return "There is not enough availability for the updated party size.";
        }
        if (error === "ALREADY_BOOKED") {
            return "You already have another reservation for this time slot.";
        }
        // Optional rule: cancellation is not allowed once the booked slot has started.
        // Currently disabled because hikers can cancel a reservation at any time.
        /*
        if (error === "RESERVATION_ALREADY_STARTED") {
            return "This reservation can no longer be cancelled because the booked time slot has already started.";
        }
        */
    }

    return "Something went wrong. Please try again.";
};

const readResponse = async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(errorMessage(response.status, data.error));
    }
    return data;
};

export const getHikerReservations = async () => {
    const response = await fetch(`${BASE_URL}/reservations`, {
        credentials: "include",
    });

    return readResponse(response);
};

export const updateHikerReservation = async (reservationId, changes) => {
    const response = await fetch(`${BASE_URL}/reservations/${Number(reservationId)}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(changes),
    });

    return readResponse(response);
};

export const cancelHikerReservation = async (reservationId) => {
    const response = await fetch(`${BASE_URL}/reservations/${Number(reservationId)}`, {
        method: "DELETE",
        credentials: "include",
    });

    return readResponse(response);
};