const BASE_URL = `${import.meta.env.VITE_API_URL ?? "http://localhost:3001"}/api`;

const readResponse = async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(
            response.status === 400
                ? "The selected date is not valid."
                : "Could not load the meal details. Please try again."
        );
    }
    return data;
};

// Public: meal times and menus of the given day (YYYY-MM-DD).
// [{ slotId, date, startAt, endAt, startTime, endTime, menu }]
export const getMealsByDate = async (date) => {
    const response = await fetch(`${BASE_URL}/slots/meals?date=${encodeURIComponent(date)}`)
        .catch(() => ({ ok: false, status: 0, json: async () => ({}) }));
    return readResponse(response);
};
