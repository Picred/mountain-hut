import { useEffect, useMemo, useState } from "react";
import capacityAPI from "../api/capacity_api";
import Calendar from "../components/Calendar";

// Convert a Date to a local YYYY-MM-DD key for calendar grouping.
const dateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

// Display slot times using a consistent 24-hour format.
const formatTime = (value) =>
    new Date(value).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
    });

export const CapacityPage = () => {
    // Data fetched from the capacity API and request status.
    const [slots, setSlots] = useState([]);
    const [availableTables, setAvailableTables] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    // Calendar selection and form visibility.
    const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [startTime, setStartTime] = useState("");
    const [endTime, setEndTime] = useState("");
    // Expanded slot and table assignment/copy selections.
    const [selectedSlotId, setSelectedSlotId] = useState(null);
    const [selectedTableIds, setSelectedTableIds] = useState([]);
    const [sourceSlotId, setSourceSlotId] = useState("");
    const [tableMode, setTableMode] = useState("assign");
    // Validation messages and new-table form state.
    const [tableError, setTableError] = useState("");
    const [slotError, setSlotError] = useState("");
    const [createTableError, setCreateTableError] = useState("");
    const [showCreateTableForm, setShowCreateTableForm] = useState(false);
    const [newTableCode, setNewTableCode] = useState("");
    const [newTableSeats, setNewTableSeats] = useState("");


    // Load slots and reusable tables once when the page mounts.
    useEffect(() => {
        const loadData = async () => {
            try {
                const [slotsData, tablesData] = await Promise.all([
                    capacityAPI.getSlots(),
                    capacityAPI.getTables(),
                ]);
                setSlots(slotsData);
                setAvailableTables(tablesData);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, []);

    // Group slots by local date and order each day chronologically.
    const slotsByDate = useMemo(() => {
        const grouped = new Map();
        for (const slot of slots) {
            const key = dateKey(new Date(slot.startAt));
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(slot);
        }
        for (const daySlots of grouped.values()) {
            daySlots.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
        }
        return grouped;
    }, [slots]);

    // Mark calendar dates according to whether all their slots have tables.
    const dateStatuses = useMemo(() => {
        const statuses = {};

        for (const [date, daySlots] of slotsByDate.entries()) {
            const allConfigured = daySlots.every(
                (slot) => (slot.tables?.length ?? 0) > 0
            );

            statuses[date] = allConfigured ? "success" : "warning";
        }

        return statuses;
    }, [slotsByDate]);

    // Only display slots belonging to the currently selected date.
    const daySlots = slotsByDate.get(selectedDate) ?? [];

    // Switching dates closes open forms and clears previous selections/errors.
    const selectDate = (key) => {
        setSelectedDate(key);
        setShowCreateForm(false);
        setSelectedSlotId(null);
        setSelectedTableIds([]);
        setSourceSlotId("");
        setTableMode("assign");
        setTableError("");
        setSlotError("");
        setShowCreateTableForm(false);
        setCreateTableError("");
    };

    // Expand or collapse a slot and reset its table-selection controls.
    const toggleSlot = (slotId) => {
        setSelectedSlotId((current) => (current === slotId ? null : slotId));
        setSelectedTableIds([]);
        setSourceSlotId("");
        setTableMode("assign");
        setTableError("");
    };

    // Validate the selected time interval, then create and reload slots.
    const handleCreateSlot = async (event) => {
        event.preventDefault();
        setSlotError("");

        const start = new Date(`${selectedDate}T${startTime}`);
        const end = new Date(`${selectedDate}T${endTime}`);

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            setSlotError("Please enter valid times.");
            return;
        }
        if (end <= start) {
            setSlotError("End time must be after start time.");
            return;
        }
        if (start <= new Date()) {
            setSlotError("The slot must start in the future.");
            return;
        }

        setSaving(true);

        try {
            await capacityAPI.createSlot(start.toISOString(), end.toISOString());
            setSlots(await capacityAPI.getSlots());
            setShowCreateForm(false);
            setStartTime("");
            setEndTime("");
        } catch (err) {
            setSlotError(
                err.message === "SLOT_OVERLAP"
                    ? "This time slot overlaps with an existing slot."
                    : err.message
            );
        } finally {
            setSaving(false);
        }
    };

    // Toggle a table in the list selected for assignment.
    const handleTableSelection = (tableId) => {
        setSelectedTableIds((current) =>
            current.includes(tableId)
                ? current.filter((id) => id !== tableId)
                : [...current, tableId]
        );
    };

    // Assign selected tables to a slot that has not been configured yet.
    const handleSaveTables = async (slot) => {
        if (slot.tables?.length > 0) return;
        if (selectedTableIds.length === 0) return;

        setTableError("");
        setSaving(true);

        try {
            await capacityAPI.addTablesToSlot(slot.slotId, selectedTableIds);
            setSlots(await capacityAPI.getSlots());
            toggleSlot(null);
        } catch (err) {
            const message =
                err.message === "DUPLICATE_TABLE_CODE"
                    ? "You cannot assign two tables with the same code to the same slot."
                    : err.message;

            setTableError(message);
        } finally {
            setSaving(false);
        }
    };

    // Copy the table configuration from another configured slot.
    const handleCopyTables = async (slot) => {
        if (slot.tables?.length > 0 || !sourceSlotId) return;

        setTableError("");
        setSaving(true);

        try {
            await capacityAPI.copyTablesToSlot(
                slot.slotId,
                Number(sourceSlotId)
            );

            setSlots(await capacityAPI.getSlots());
            toggleSlot(null);
        } catch (err) {
            setTableError(err.message);
        } finally {
            setSaving(false);
        }
    };

    // Human-readable heading for the date selected in the calendar.
    const selectedDateLabel = new Date(`${selectedDate}T12:00:00`).toLocaleDateString(
        "en-GB",
        { weekday: "long", day: "numeric", month: "long", year: "numeric" }
    );

    // Validate and create a reusable table, then refresh the table list.
    const handleCreateTable = async (e) => {
        e.preventDefault();
        setCreateTableError("");

        const code = newTableCode.trim();
        const seats = Number(newTableSeats);

        if (!code || code.length > 20) {
            setCreateTableError(
                "Table code must contain between 1 and 20 characters."
            );
            return;
        }

        if (!newTableSeats.trim() || !Number.isInteger(seats) || seats < 1 || seats > 100) {
            setCreateTableError(
                "Number of seats must be between 1 and 100."
            );
            return;
        }

        setSaving(true);

        try {
            await capacityAPI.createTable(code, seats);

            const updatedTables = await capacityAPI.getTables();
            setAvailableTables(updatedTables);

            setNewTableCode("");
            setNewTableSeats("");
            setCreateTableError("");
            setShowCreateTableForm(false);
        } catch (err) {
            setCreateTableError(
                err.message === "TABLE_ALREADY_EXISTS"
                    ? "A table with this code already exists."
                    : err.message
            );
        } finally {
            setSaving(false);
        }
    };

    // Render the calendar, slot creation form, and per-slot table controls.
    return (
        <section className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
            <header className="mb-8">
                <div className="flex items-center gap-3 mb-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-300/25 bg-sky-300/10 text-sky-300">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-calendar preview-icon"><path d="M8 2v3" /><path d="M16 2v3" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></svg>
                    </span>
                    <h1 className="text-3xl sm:text-4xl font-bold text-white">Slot Management</h1>
                </div>
                <p className="text-slate-300">Choose a date to manage dining time slots and table capacity.</p>
            </header>

            {error && (
                <div role="alert" className="mb-6 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-red-300">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-7 items-start">

                {/* Calendar with indicators for configured and unconfigured days. */}
                <Calendar
                    selectedDate={selectedDate}
                    onDateSelect={selectDate}
                    dateStatuses={dateStatuses}
                    statusLegend={[
                        {
                            status: "success",
                            label: "All slots configured",
                        },
                        {
                            status: "warning",
                            label: "Some slots need tables",
                        },
                    ]}
                />

                <div className="min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
                        <div>
                            <p className="text-xs uppercase tracking-widest text-sky-300 font-semibold mb-1">Selected date</p>
                            <h2 className="text-xl sm:text-2xl font-semibold text-white">{selectedDateLabel}</h2>
                            <p className="text-sm text-slate-400 mt-1">{daySlots.length} {daySlots.length === 1 ? "slot" : "slots"} defined</p>
                        </div>

                        <button
                            type="button"
                            onClick={() => {
                                setShowCreateForm((current) => !current);
                                setStartTime("");
                                setEndTime("");
                                setSlotError("");
                            }}
                            className="btn bg-sky-300 hover:bg-sky-400 border-sky-300 hover:border-sky-400 text-slate-950 font-semibold"
                        >
                            {showCreateForm ? (
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
                            )}
                            {showCreateForm ? "Cancel" : "Create New Slot"}
                        </button>

                    </div>

                    {/* Form for defining a new dining time slot. */}
                    {showCreateForm && (
                        <form onSubmit={handleCreateSlot} className="mb-5 rounded-2xl border border-sky-300/25 bg-[#0e1622]/90 p-5 shadow-xl">
                            <h3 className="text-lg font-semibold text-white mb-1">Create New Slot</h3>
                            <p className="text-sm text-slate-400 mb-5">{selectedDateLabel}</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="slot-start" className="block text-sm text-slate-300 mb-2">Start Time</label>
                                    <input id="slot-start" type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} className="input w-full bg-[#080e18] border-white/20 text-white focus:border-sky-300" />
                                </div>
                                <div>
                                    <label htmlFor="slot-end" className="block text-sm text-slate-300 mb-2">End Time</label>
                                    <input id="slot-end" type="time" required value={endTime} onChange={(event) => setEndTime(event.target.value)} className="input w-full bg-[#080e18] border-white/20 text-white focus:border-sky-300" />
                                </div>
                            </div>
                            {slotError && (
                                <div
                                    role="alert"
                                    className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300"
                                >
                                    {slotError}
                                </div>
                            )}
                            <button type="submit" disabled={saving} className="btn mt-5 w-full bg-sky-300 hover:bg-sky-400 border-sky-300 text-slate-950 font-semibold disabled:opacity-40">
                                {saving ? "Creating..." : "Create Slot"}
                            </button>
                        </form>
                    )}

                    {/* Show loading/empty states or the slots for the selected day. */}
                    {loading ? (
                        <p className="rounded-2xl border border-white/10 bg-[#0e1622]/85 p-6 text-slate-300">Loading slots...</p>
                    ) : daySlots.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/15 bg-[#0e1622]/65 p-9 text-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-calendar preview-icon"><path d="M8 2v3" /><path d="M16 2v3" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></svg>
                            <h3 className="text-white font-semibold">No slots for this day</h3>
                            <p className="text-sm text-slate-400 mt-2">Use Create New Slot to add a dining time slot.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {daySlots.map((slot) => {
                                // A slot becomes bookable only after tables are assigned.
                                const configured = (slot.tables?.length ?? 0) > 0;
                                const expanded = selectedSlotId === slot.slotId;
                                // Only other configured slots can be used as copy sources.
                                const sourceSlots = slots.filter((other) => other.slotId !== slot.slotId && (other.tables?.length ?? 0) > 0);
                                return (
                                    <article key={slot.slotId} className="rounded-2xl border border-white/10 bg-[#0e1622]/90 p-5 shadow-xl">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0">
                                                <p className="text-xl font-semibold text-white">{formatTime(slot.startAt)} – {formatTime(slot.endAt)}</p>
                                                <p className="mt-2 text-sm text-slate-400">{slot.tables?.length ?? 0} tables <span className="mx-1 text-slate-600">·</span> {slot.totalSeats ?? 0} seats</p>
                                                <p className={`mt-2 text-xs font-medium ${configured ? "text-emerald-300" : "text-amber-300"}`}>
                                                    {configured ? "Table set configured" : "No tables assigned · Not bookable"}
                                                </p>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => toggleSlot(slot.slotId)}
                                                aria-label={expanded ? (configured ? "Close" : "Cancel") : (configured ? "View Tables" : "Assign Tables")}
                                                aria-expanded={expanded}
                                                title={expanded ? (configured ? "Close" : "Cancel") : (configured ? "View Tables" : "Assign Tables")}
                                                className={`flex shrink-0 items-center justify-center gap-2 whitespace-nowrap cursor-pointer h-11 px-4 rounded-xl border font-semibold text-sm transition-colors ${expanded
                                                    ? "bg-sky-300 text-slate-950 border-sky-300"
                                                    : "bg-sky-300/10 border-sky-300/30 text-sky-300 hover:bg-sky-300/20"
                                                    }`}
                                            >
                                                {expanded ? (
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                                ) : configured ? (
                                                    <svg width="35" height="35" className="shrink-0" fill="currentColor" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="-30.04 -30.04 274.62 274.62" xml:space="preserve"><g id="SVGRepo_bgCarrier" strokeWidth="0"></g><g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g><g id="SVGRepo_iconCarrier"> <g> <g> <path d="M121.164,154.578h-6.625V89.14h38.937c4.014,0,7.269-3.254,7.269-7.269s-3.254-7.269-7.269-7.269h-92.41 c-4.014,0-7.269,3.254-7.269,7.269s3.254,7.269,7.269,7.269h38.936v65.438h-6.625c-4.014,0-7.269,3.254-7.269,7.27 c0,4.015,3.254,7.269,7.269,7.269h27.787c4.015,0,7.27-3.254,7.27-7.269C128.433,157.832,125.179,154.578,121.164,154.578z"></path> <path d="M73.783,120.777c0-4.014-3.254-7.269-7.269-7.269H54.833H34.219c-11.08,0-13.41-16.14-13.509-16.869l-6.239-45.122 c-0.55-3.977-4.217-6.748-8.196-6.205c-3.976,0.55-6.754,4.219-6.205,8.196l6.229,45.053c0.831,6.47,4.167,16.593,11.367,23.133 l-7.485,38.956c-0.758,3.942,1.824,7.752,5.766,8.509c3.946,0.761,7.752-1.825,8.509-5.766l6.792-35.349h17.579l6.792,35.349 c0.668,3.479,3.714,5.897,7.13,5.897c0.455,0,0.916-0.043,1.379-0.132c3.942-0.757,6.524-4.566,5.766-8.509l-6.265-32.605h2.883 C70.527,128.046,73.783,124.791,73.783,120.777z"></path> <path d="M208.267,45.313c-3.975-0.543-7.646,2.229-8.196,6.205l-6.244,45.165c-0.094,0.687-2.424,16.827-13.504,16.827h-20.614 h-11.681c-4.014,0-7.27,3.254-7.27,7.269s3.255,7.269,7.27,7.269h2.883l-6.265,32.605c-0.758,3.942,1.824,7.752,5.766,8.509 c3.946,0.761,7.752-1.825,8.509-5.766l6.792-35.349h17.579l6.792,35.349c0.668,3.479,3.714,5.897,7.13,5.897 c0.455,0,0.916-0.043,1.38-0.132c3.941-0.757,6.523-4.566,5.766-8.509l-7.485-38.953c7.198-6.534,10.532-16.64,11.357-23.065 l6.238-45.123C215.021,49.533,212.242,45.863,208.267,45.313z"></path> </g> </g> </g></svg>
                                                ) : (
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
                                                )}

                                                <span>
                                                    {expanded
                                                        ? (configured ? "Close" : "Cancel")
                                                        : (configured ? "View Tables" : "Assign Tables")}
                                                </span>
                                            </button>

                                        </div>

                                        {/* Expanded panel: view assigned tables or configure an empty slot. */}
                                        {expanded && (
                                            <div className="mt-5 pt-5 border-t border-white/10">
                                                {configured ? (
                                                    <>
                                                        <h4 className="font-semibold text-white mb-3">Assigned Tables</h4>
                                                        <div className="grid grid-cols-2 gap-3">
                                                            {slot.tables.map((table) => (
                                                                <div key={table.tableId} className="rounded-xl border border-white/10 bg-white/5 p-3">
                                                                    <p className="text-sm font-semibold text-white">{table.code}</p>
                                                                    <p className="text-xs text-slate-400 mt-1">{table.seats} seats</p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="flex gap-2 mb-5">
                                                            <button type="button" onClick={() => { setTableMode("assign"); setSourceSlotId(""); setTableError(""); }} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold border cursor-pointer ${tableMode === "assign" ? "bg-sky-300 text-slate-950 border-sky-300" : "border-white/15 text-slate-300 hover:bg-white/10"}`}>Assign Tables</button>
                                                            <button type="button" onClick={() => { setTableMode("copy"); setSelectedTableIds([]); setTableError(""); }} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold border cursor-pointer ${tableMode === "copy" ? "bg-sky-300 text-slate-950 border-sky-300" : "border-white/15 text-slate-300 hover:bg-white/10"}`}>Copy Tables</button>
                                                        </div>

                                                        {tableError && (
                                                            <div
                                                                role="alert"
                                                                className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300"
                                                            >
                                                                {tableError}
                                                            </div>
                                                        )}

                                                        {/* Choose tables manually or copy them from another slot. */}
                                                        {tableMode === "assign" ? (
                                                            <>
                                                                <h4 className="text-sm font-semibold text-white mb-3">Select available tables</h4>
                                                                <div className="mb-5">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setShowCreateTableForm((current) => !current);
                                                                            setCreateTableError("");
                                                                        }}
                                                                        className="rounded-xl cursor-pointer border border-sky-400/30 bg-sky-400/10 px-4 py-2 text-sm font-medium text-sky-300 transition hover:bg-sky-400/20"
                                                                    >
                                                                        {showCreateTableForm ? "Cancel" : "+ Create New Table"}
                                                                    </button>

                                                                    {/* Create a reusable table without leaving this page. */}
                                                                    {showCreateTableForm && (
                                                                        <form
                                                                            onSubmit={handleCreateTable}
                                                                            className="mt-4 space-y-4 rounded-2xl border border-sky-400/20 bg-slate-900/60 p-5"
                                                                        >
                                                                            <div>
                                                                                <label className="mb-2 block text-sm text-slate-300">
                                                                                    Table Code
                                                                                </label>
                                                                                <input
                                                                                    type="text"
                                                                                    value={newTableCode}
                                                                                    onChange={(e) => setNewTableCode(e.target.value)}
                                                                                    maxLength={20}
                                                                                    placeholder="e.g. T1"
                                                                                    required
                                                                                    className="w-full rounded-xl border border-white/10 bg-slate-800/80 px-4 py-3 text-white outline-none transition focus:border-sky-400"
                                                                                />
                                                                            </div>

                                                                            <div>
                                                                                <label className="mb-2 block text-sm text-slate-300">
                                                                                    Number of Seats
                                                                                </label>
                                                                                <input
                                                                                    type="number"
                                                                                    value={newTableSeats}
                                                                                    onChange={(e) => setNewTableSeats(e.target.value)}
                                                                                    min={1}
                                                                                    max={100}
                                                                                    step={1}
                                                                                    placeholder="e.g. 4"
                                                                                    required
                                                                                    className="w-full rounded-xl border border-white/10 bg-slate-800/80 px-4 py-3 text-white outline-none transition focus:border-sky-400"
                                                                                />
                                                                            </div>
                                                                            {createTableError && (
                                                                                <div
                                                                                    role="alert"
                                                                                    className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300"
                                                                                >
                                                                                    {createTableError}
                                                                                </div>
                                                                            )}

                                                                            <button
                                                                                type="submit"
                                                                                disabled={saving}
                                                                                className="rounded-xl bg-sky-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:opacity-40"
                                                                            >
                                                                                {saving ? "Creating..." : "Create Table"}
                                                                            </button>
                                                                        </form>
                                                                    )}
                                                                </div>
                                                                {availableTables.length === 0 ? (
                                                                    <p className="text-sm text-slate-400">No tables available.</p>
                                                                ) : (

                                                                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                                                                        {availableTables.map((table) => (
                                                                            <label key={table.tableId} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3 cursor-pointer hover:bg-white/10">
                                                                                <span>
                                                                                    <span className="block text-sm font-medium text-white">{table.code}</span>
                                                                                    <span className="block text-xs text-slate-400 mt-1">{table.seats} seats</span>
                                                                                </span>
                                                                                <input type="checkbox" className="checkbox checkbox-info checkbox-sm" checked={selectedTableIds.includes(table.tableId)} onChange={() => handleTableSelection(table.tableId)} />
                                                                            </label>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                <button type="button" disabled={saving || selectedTableIds.length === 0} onClick={() => handleSaveTables(slot)} className="btn mt-4 w-full bg-sky-300 hover:bg-sky-400 border-sky-300 text-slate-950 font-semibold disabled:opacity-40">
                                                                    {saving ? "Saving..." : "Save Tables"}
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <h4 className="text-sm font-semibold text-white mb-3">Copy from another slot</h4>
                                                                {sourceSlots.length === 0 ? (
                                                                    <p className="text-sm text-slate-400">No configured source slots available.</p>
                                                                ) : (
                                                                    <>
                                                                        <select value={sourceSlotId} onChange={(event) => setSourceSlotId(event.target.value)} className="select w-full bg-[#080e18] border-white/20 text-white focus:border-sky-300">
                                                                            <option value="">Select a source slot</option>
                                                                            {sourceSlots.map((other) => (
                                                                                <option key={other.slotId} value={other.slotId}>
                                                                                    {new Date(other.startAt).toLocaleDateString("en-GB")} | {formatTime(other.startAt)} | {other.tables.length} tables
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                        <button type="button" disabled={saving || !sourceSlotId} onClick={() => handleCopyTables(slot)} className="btn mt-4 w-full bg-sky-300 hover:bg-sky-400 border-sky-300 text-slate-950 font-semibold disabled:opacity-40">
                                                                            {saving ? "Copying..." : "Copy Tables"}
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
};
