const SERVER_URL = "http://localhost:3001";

// Recupera gli slot in un intervallo di date
async function getSlots(from, to) {
    const params = new URLSearchParams();

    if (from) params.append("from", from);
    if (to) params.append("to", to);

    const response = await fetch(
        `${SERVER_URL}/api/slots/capacity?${params}`,
        {
            method: "GET",
            credentials: "include",
        }
    );

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        throw new Error(
            errorData.message ||
            errorData.error ||
            "Unable to retrieve slots"
        );
    }

    return await response.json();
}

// Crea un nuovo slot
async function createSlot(startAt, endAt) {
    const response = await fetch(`${SERVER_URL}/api/slots`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ startAt, endAt }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        throw new Error(
            errorData.message ||
            errorData.error ||
            "Unable to create slot"
        );
    }

    return await response.json();
}

// Recupera i tavoli disponibili
async function getTables() {
    const response = await fetch(`${SERVER_URL}/api/tables`, {
        method: "GET",
        credentials: "include",
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        throw new Error(
            errorData.message ||
            errorData.error ||
            "Unable to retrieve tables"
        );
    }

    return await response.json();
}

// Assegna i tavoli selezionati a uno slot
async function addTablesToSlot(slotId, tableIds) {
    const response = await fetch(
        `${SERVER_URL}/api/slots/${slotId}/tables`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({ tableIds }),
        }
    );

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        throw new Error(
            errorData.message ||
            errorData.error ||
            "Unable to assign tables to slot"
        );
    }

    return await response.json();
}

// Copia la configurazione dei tavoli da uno slot a un altro
async function copyTablesToSlot(slotId, fromSlotId) {
    const response = await fetch(
        `${SERVER_URL}/api/slots/${slotId}/copy-tables`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({ fromSlotId }),
        }
    );

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        throw new Error(
            errorData.message ||
            errorData.error ||
            "Unable to copy tables"
        );
    }

    return await response.json();
}

async function createTable(code, seats) {
    const response = await fetch(`${SERVER_URL}/api/tables`, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ code, seats }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
            errorData.message ||
            errorData.error ||
            "Unable to create table"
        );
    }

    return await response.json();
}

const capacityAPI = { getSlots, createSlot, getTables, addTablesToSlot, copyTablesToSlot, createTable };

export default capacityAPI;