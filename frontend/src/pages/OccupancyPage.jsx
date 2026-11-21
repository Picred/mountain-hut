import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
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

// Occupancy bar: green while there are free seats, red when everything is booked.
const OccupancyBar = ({ booked, total, label }) => {
    const percentage = total > 0 ? Math.min(100, Math.round((booked / total) * 100)) : 0;
    const full = total > 0 && booked >= total;

    return (
        <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage}
            className="h-2.5 w-full overflow-hidden rounded-full bg-white/10"
        >
            <div
                className={`h-full rounded-full transition-all ${full ? "bg-red-400" : "bg-emerald-400"}`}
                style={{ width: `${percentage}%` }}
            />
        </div>
    );
};

export const OccupancyPage = () => {
    const location = useLocation();
    const today = dateKey(new Date());

    // The page can be opened from the capacity page with a day and a slot already selected.
    const requestedDate = location.state?.date;
    const requestedSlotId = location.state?.slotId ?? null;

    const [slots, setSlots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(null);
    const [selectedDate, setSelectedDate] = useState(
        requestedDate && requestedDate >= today ? requestedDate : today
    );
    const [selectedSlotId, setSelectedSlotId] = useState(requestedSlotId);

    // Only the answer of the latest request is used.
    const requestCounter = useRef(0);

    // Load every slot from today on, with tables and occupancy.
    const loadSlots = useCallback(async ({ showRefreshing = false } = {}) => {
        const requestId = ++requestCounter.current;

        if (showRefreshing) setRefreshing(true);

        try {
            const data = await capacityAPI.getSlots(dateKey(new Date()));
            if (requestId !== requestCounter.current) return;
            setSlots(data);
            setError(null);
        } catch (err) {
            if (requestId !== requestCounter.current) return;
            setError(err.message);
        } finally {
            if (requestId === requestCounter.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, []);

    useEffect(() => {
        loadSlots();
    }, [loadSlots]);

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

    // Green: some slot still has free seats. Red: every slot with tables is full.
    // Days without any slot with tables have no indicator.
    const dateStatuses = useMemo(() => {
        const statuses = {};

        for (const [date, daySlots] of slotsByDate.entries()) {
            const withTables = daySlots.filter((slot) => (slot.tables?.length ?? 0) > 0);
            if (withTables.length === 0) continue;

            statuses[date] = withTables.every((slot) => slot.remainingSeats <= 0)
                ? "danger"
                : "success";
        }

        return statuses;
    }, [slotsByDate]);

    const daySlots = slotsByDate.get(selectedDate) ?? [];

    const selectedDateLabel = new Date(`${selectedDate}T12:00:00`).toLocaleDateString(
        "en-GB",
        { weekday: "long", day: "numeric", month: "long", year: "numeric" }
    );

    const selectDate = (key) => {
        setSelectedDate(key);
        setSelectedSlotId(null);
    };

    // Opening a slot reloads all the data, so the figures are always up to date.
    const toggleSlot = (slotId) => {
        if (selectedSlotId === slotId) {
            setSelectedSlotId(null);
            return;
        }

        setSelectedSlotId(slotId);
        loadSlots({ showRefreshing: true });
    };

    return (
        <section className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
            <header className="mb-8">
                <div className="flex items-center gap-3 mb-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-300/25 bg-sky-300/10 text-sky-300">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>
                    </span>
                    <h1 className="text-3xl sm:text-4xl font-bold text-white">Occupancy</h1>
                </div>
                <p className="text-slate-300">
                    Check how booked and free seats are distributed across the tables of every time slot.
                </p>
            </header>

            <div className="flex justify-end mb-6">
                <button
                    type="button"
                    onClick={() => loadSlots({ showRefreshing: true })}
                    disabled={loading || refreshing}
                    className="btn bg-sky-300 hover:bg-sky-400 border-sky-300 hover:border-sky-400 text-slate-950 font-semibold disabled:opacity-40"
                >
                    {refreshing ? "Refreshing..." : "Refresh"}
                </button>
            </div>

            {error && (
                <div role="alert" className="mb-6 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-red-300">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-7 items-start">
                <Calendar
                    selectedDate={selectedDate}
                    onDateSelect={selectDate}
                    dateStatuses={dateStatuses}
                    minDate={today}
                    statusLegend={[
                        { status: "success", label: "Free seats available" },
                        { status: "danger", label: "All seats booked" },
                    ]}
                />

                <div className="min-w-0">
                    <div className="mb-5">
                        <p className="text-xs uppercase tracking-widest text-sky-300 font-semibold mb-1">Selected date</p>
                        <h2 className="text-xl sm:text-2xl font-semibold text-white">{selectedDateLabel}</h2>
                        <p className="text-sm text-slate-400 mt-1">
                            {daySlots.length} {daySlots.length === 1 ? "slot" : "slots"} defined
                        </p>
                    </div>

                    {loading ? (
                        <p className="rounded-2xl border border-white/10 bg-[#0e1622]/85 p-6 text-slate-300">
                            Loading occupancy...
                        </p>
                    ) : daySlots.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/15 bg-[#0e1622]/65 p-9 text-center">
                            <h3 className="text-white font-semibold">No slots for this day</h3>
                            <p className="text-sm text-slate-400 mt-2">
                                Slots can be created from the capacity management page.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {daySlots.map((slot) => {
                                const tables = slot.tables ?? [];
                                const hasTables = tables.length > 0;
                                const full = hasTables && slot.remainingSeats <= 0;
                                const expanded = selectedSlotId === slot.slotId;

                                return (
                                    <article
                                        key={slot.slotId}
                                        className={`rounded-2xl border bg-[#0e1622]/90 p-5 shadow-xl ${expanded ? "border-sky-300/40" : "border-white/10"}`}
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0">
                                                <p className="text-xl font-semibold text-white">
                                                    {formatTime(slot.startAt)} – {formatTime(slot.endAt)}
                                                </p>

                                                {hasTables ? (
                                                    <>
                                                        <p className="mt-2 text-sm text-slate-400">
                                                            {tables.length} {tables.length === 1 ? "table" : "tables"}
                                                            <span className="mx-1 text-slate-600">·</span>
                                                            {slot.totalSeats} seats
                                                        </p>
                                                        <p className={`mt-2 text-xs font-medium ${full ? "text-red-300" : "text-emerald-300"}`}>
                                                            {full ? "Full" : `${slot.remainingSeats} seats free`}
                                                        </p>
                                                    </>
                                                ) : (
                                                    <p className="mt-2 text-xs font-medium text-amber-300">
                                                        No tables assigned
                                                    </p>
                                                )}
                                            </div>

                                            {hasTables && (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleSlot(slot.slotId)}
                                                    aria-expanded={expanded}
                                                    className={`flex h-11 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-xl border px-4 text-sm font-semibold transition-colors ${expanded
                                                        ? "border-sky-300 bg-sky-300 text-slate-950"
                                                        : "border-sky-300/30 bg-sky-300/10 text-sky-300 hover:bg-sky-300/20"
                                                        }`}
                                                >
                                                    {expanded ? "Hide details" : "View details"}
                                                </button>
                                            )}
                                        </div>

                                        {hasTables && (
                                            <div className="mt-5">
                                                <div className="mb-2 flex items-center justify-between text-sm">
                                                    <span className="text-slate-300">Total occupancy</span>
                                                    <span className="font-semibold text-white">
                                                        {slot.bookedSeats} / {slot.totalSeats} seats booked
                                                        <span className="ml-2 text-slate-400">({slot.occupancyPercentage}%)</span>
                                                    </span>
                                                </div>
                                                <OccupancyBar
                                                    booked={slot.bookedSeats}
                                                    total={slot.totalSeats}
                                                    label={`Total occupancy of the slot ${formatTime(slot.startAt)}`}
                                                />
                                            </div>
                                        )}

                                        {expanded && hasTables && (
                                            <div className="mt-5 border-t border-white/10 pt-5">
                                                <h3 className="mb-3 font-semibold text-white">Tables</h3>

                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    {tables.map((table) => {
                                                        const tableFull = table.remainingSeats <= 0;

                                                        return (
                                                            <div
                                                                key={table.tableId}
                                                                className={`rounded-xl border p-4 ${tableFull ? "border-red-400/30 bg-red-400/10" : "border-white/10 bg-white/5"}`}
                                                            >
                                                                <div className="mb-3 flex items-center justify-between gap-2">
                                                                    <p className="text-sm font-semibold text-white">{table.code}</p>
                                                                    <p className="text-xs text-slate-400">{table.seats} seats</p>
                                                                </div>

                                                                <OccupancyBar
                                                                    booked={table.bookedSeats}
                                                                    total={table.seats}
                                                                    label={`Occupancy of table ${table.code}`}
                                                                />

                                                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                                                    <div>
                                                                        <p className="text-slate-400">Occupied</p>
                                                                        <p className="mt-0.5 text-sm font-semibold text-white">{table.bookedSeats}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-slate-400">Free</p>
                                                                        <p className={`mt-0.5 text-sm font-semibold ${tableFull ? "text-red-300" : "text-emerald-300"}`}>
                                                                            {table.remainingSeats}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
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