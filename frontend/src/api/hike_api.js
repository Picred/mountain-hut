const SERVER_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

const HikeRegistrationErrors = {
    INVALID_INPUT: "Check the hike details and try again.",
    INVALID_DATE: "Enter valid departure and arrival dates.",
    INVALID_TIME_RANGE: "Expected arrival must be after departure.",
    DEPARTURE_IN_THE_PAST: "Departure must be in the future.",
    HIKE_TIME_CONFLICT:
        "You already have another scheduled hike during this period. Choose a different time.",
};

async function registerHike(hike) {
    const response = await fetch(`${SERVER_URL}/api/hikes`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(hike),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        if (response.status === 401) {
            throw new Error("Please log in before registering a hike.");
        }

        if (response.status === 403) {
            throw new Error("Only hikers can register a hike.");
        }

        const errorCode = errorData.error;
        throw new Error(
            HikeRegistrationErrors[errorCode] ||
            (response.status >= 500
                ? "The hike could not be registered because of a server error. Please try again."
                : "The hike could not be registered. Check the details and try again.")
        );
    }

    return await response.json();
}


async function getActiveHikes() {
    const response = await fetch(`${SERVER_URL}/api/hikes/active`, {
        method: "GET",
        credentials: "include",
    });

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error("Please log in to view active hikes.");
        }

        if (response.status === 403) {
            throw new Error("Only employees can view active hikes.");
        }

        throw new Error(
            response.status >= 500
                ? "A server error occurred while loading active hikes. Please try again."
                : "Unable to load active hikes. Please try again."
        );
    }

    return await response.json();
}

async function getHikerHikes() {
    const response = await fetch(`${SERVER_URL}/api/hikes`, {
        method: "GET",
        credentials: "include",
    });

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error("Please log in to view your hikes.");
        }
        if (response.status === 403) {
            throw new Error("Only hikers can view their hikes.");
        }
        throw new Error(
            response.status >= 500
                ? "A server error occurred while loading your hikes. Please try again."
                : "Unable to load your hikes. Please try again."
        );
    }

    return await response.json();
}

async function confirmHikeArrival(hikeId) {
    const response = await fetch(`${SERVER_URL}/api/hikes/${hikeId}/confirm-arrival`, {
        method: "PUT",
        credentials: "include",
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        if (response.status === 401) {
            throw new Error("Please log in to confirm your safe arrival.");
        }
        if (response.status === 403) {
            throw new Error("Only hikers can confirm a hike arrival.");
        }
        if (errorData.error === "HIKE_NOT_FOUND") {
            throw new Error("This hike could not be found.");
        }
        if (errorData.error === "HIKE_ALREADY_CONFIRMED") {
            throw new Error("This hike has already been marked as returned.");
        }

        throw new Error(
            response.status >= 500
                ? "A server error occurred while confirming your arrival. Please try again."
                : "Unable to confirm your safe arrival. Please try again."
        );
    }

    return await response.json();
}

async function getOverdueHikes() {
    const response = await fetch(`${SERVER_URL}/api/hikes/missing`, {
        method: "GET",
        credentials: "include"
    })

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error("Please log in to see the missing hikers")
        }

        if (response.status === 403) {
            throw new Error("Only employees see overdue hikes.")
        }
        throw new Error(
            response.status >= 500
                ? "A server error occurred while loading missing hikers. Please try again."
                : "Unable to load missing hikers. Please try again."
        );
    }
    return await response.json()
}



const hikeAPI = { registerHike, getActiveHikes, getHikerHikes, confirmHikeArrival, getOverdueHikes};

export default hikeAPI;
