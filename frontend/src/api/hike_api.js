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


const hikeAPI = { registerHike, getActiveHikes };

export default hikeAPI;
