const BASE_URL = "http://localhost:3001/api";

const errorMessage = (status, error) => {
    if (status === 400 && error === "INVALID_INPUT") {
        return "Some booking details are invalid. Please review them and try again.";
    }

    if (status === 401) {
        return "Please log in to view or change your reservations.";
    }

    if (status === 403) {
        return "You can only change your own reservations.";
    }

    if (status === 404) {
        if (error === "RESERVATION_NOT_FOUND") return "This reservation could not be found.";
        if (error === "REQUIREMENT_NOT_FOUND") return "A party requirement could not be found. Reload and try again.";
        if (error === "SLOT_NOT_FOUND") return "The selected time slot could not be found.";
    }

    if (status === 409) {
        if (error === "EDIT_WINDOW_EXPIRED") {
            return "This reservation can no longer be changed because the 48-hour change window has expired.";
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