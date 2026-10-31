
import { useState } from "react";

// Converts a Date object into a local YYYY-MM-DD string.
// Using local date components avoids UTC-related date shifts.
const dateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
};

/**
 * Reusable calendar component.
 *
 * Props:
 * - selectedDate: currently selected date (YYYY-MM-DD).
 * - onDateSelect: callback triggered when a date is selected.
 * - dateStatuses: maps dates to their status ("success" or "warning").
 * - statusLegend: optional labels explaining the status indicators.
 * - minDate: optional minimum selectable date (YYYY-MM-DD).
 *
 * The component manages month navigation internally, while the parent
 * component controls the selected date and any date-specific statuses.
 */
export const Calendar = ({
    selectedDate,
    onDateSelect,
    dateStatuses = {},
    statusLegend = [],
    minDate,
}) => {
    // Initialize the displayed month from the selected date, or from today.
    // Noon is used when parsing the date to avoid timezone-related edge cases.
    const [displayedMonth, setDisplayedMonth] = useState(() => {
        const today = selectedDate
            ? new Date(`${selectedDate}T12:00:00`)
            : new Date();

        return new Date(today.getFullYear(), today.getMonth(), 1);
    });

    // Convert JavaScript's Sunday-first weekday index to Monday-first.
    const firstWeekday = (displayedMonth.getDay() + 6) % 7;

    // Day 0 of the following month gives the last day of the current month.
    const daysInMonth = new Date(
        displayedMonth.getFullYear(),
        displayedMonth.getMonth() + 1,
        0
    ).getDate();

    // Build the calendar grid, adding empty cells before the first day.
    const calendarCells = [
        ...Array(firstWeekday).fill(null),
        ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];

    // Navigate to the previous or next month.
    const changeMonth = (offset) => {
        setDisplayedMonth((current) =>
            new Date(
                current.getFullYear(),
                current.getMonth() + offset,
                1
            )
        );
    };

    // Return to the current month and select today's date.
    const goToToday = () => {
        const today = new Date();

        setDisplayedMonth(
            new Date(today.getFullYear(), today.getMonth(), 1)
        );

        onDateSelect(dateKey(today));
    };

    return (
        <div className="rounded-2xl border border-white/10 bg-[#0e1622]/90 p-5 sm:p-6 shadow-xl">
            {/* Month heading and navigation controls */}
            <div className="flex items-center justify-between gap-3 mb-6">
                <h2 className="text-xl font-semibold text-white capitalize">
                    {displayedMonth.toLocaleDateString("en-GB", {
                        month: "long",
                        year: "numeric",
                    })}
                </h2>

                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => changeMonth(-1)}
                        aria-label="Previous month"
                        className="h-9 w-9 rounded-lg border border-white/15 text-slate-200 hover:bg-white/10"
                    >
                        ‹
                    </button>

                    <button
                        type="button"
                        onClick={() => changeMonth(1)}
                        aria-label="Next month"
                        className="h-9 w-9 rounded-lg border border-white/15 text-slate-200 hover:bg-white/10"
                    >
                        ›
                    </button>
                </div>
            </div>

            {/* Weekday labels, starting from Monday */}
            <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                    (day) => (
                        <span
                            key={day}
                            className="text-center text-xs font-medium text-slate-400 py-2"
                        >
                            {day}
                        </span>
                    )
                )}
            </div>

            {/* Calendar days */}
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {calendarCells.map((day, index) => {
                    // Empty cells align the first day with its weekday.
                    if (day === null) {
                        return <div key={`blank-${index}`} />;
                    }

                    const key = dateKey(
                        new Date(
                            displayedMonth.getFullYear(),
                            displayedMonth.getMonth(),
                            day
                        )
                    );

                    // Determine the visual and interaction state of each day.
                    const status = dateStatuses[key];
                    const isSelected = selectedDate === key;
                    const isToday = dateKey(new Date()) === key;
                    const isDisabled = Boolean(minDate && key < minDate);

                    return (
                        <button
                            type="button"
                            key={key}
                            onClick={() => onDateSelect(key)}
                            disabled={isDisabled}
                            aria-label={`${key}${status ? `, ${status}` : ""}`}
                            aria-pressed={isSelected}
                            className={`relative aspect-square min-h-10 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors ${isDisabled
                                ? "cursor-default text-slate-600 opacity-50"
                                : isSelected
                                    ? "cursor-pointer bg-sky-300 text-slate-950 font-bold shadow-lg shadow-sky-300/15"
                                    : "cursor-pointer text-slate-200 hover:bg-white/10"
                                } ${isToday && !isSelected && !isDisabled
                                    ? "ring-1 ring-sky-300/60"
                                    : ""
                                }`}
                        >
                            <span className="text-sm">{day}</span>

                            {/* Optional status indicator for this date */}
                            <span
                                className={`h-1.5 w-1.5 rounded-full ${status === "success"
                                    ? "bg-emerald-400"
                                    : status === "warning"
                                        ? "bg-amber-400"
                                        : "bg-transparent"
                                    }`}
                            />
                        </button>
                    );
                })}
            </div>

            {/* Optional legend explaining the calendar status colors */}
            {statusLegend.length > 0 && (
                <div className="mt-6 pt-4 border-t border-white/10 space-y-2">
                    {statusLegend.map((item) => (
                        <div
                            key={item.status}
                            className="flex items-center gap-2 text-xs text-slate-400"
                        >
                            <span
                                className={`h-2 w-2 rounded-full ${item.status === "success"
                                    ? "bg-emerald-400"
                                    : item.status === "warning"
                                        ? "bg-amber-400"
                                        : "bg-transparent"
                                    }`}
                            />
                            {item.label}
                        </div>
                    ))}
                </div>
            )}

            {/* Quick navigation back to the current date */}
            <button
                type="button"
                onClick={goToToday}
                className="mt-4 text-sm text-sky-300 hover:text-sky-200"
            >
                Go to today
            </button>
        </div>
    );
};

export default Calendar;
