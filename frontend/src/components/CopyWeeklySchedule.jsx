import { useState } from "react";
import capacityAPI from "../api/capacity_api";

const getWeekStart = (dateString) => {
    if (!dateString) return "";

    const date = new Date(`${dateString}T12:00:00`);
    const day = date.getDay();

    const daysFromMonday = (day + 6) % 7;
    date.setDate(date.getDate() - daysFromMonday);

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const dayOfMonth = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${dayOfMonth}`;
};

const formatWeekRange = (weekStart) => {
    if (!weekStart) return "";

    const endDate = new Date(`${weekStart}T12:00:00`);
    endDate.setDate(endDate.getDate() + 6);

    const year = endDate.getFullYear();
    const month = String(endDate.getMonth() + 1).padStart(2, "0");
    const day = String(endDate.getDate()).padStart(2, "0");

    return `Week ${weekStart} - ${year}-${month}-${day}`;
};

const parseCopyError = (message) => {
    if (!message?.includes("SLOT_HAS_RESERVATIONS")) {
        return null;
    }

    const slots = [];
    const pattern = /slotId:\s*\d+\s*\(([^)]+?)\s+-\s+([^)]+?)\)/g;

    for (const match of message.matchAll(pattern)) {
        const start = new Date(match[1]);
        const end = new Date(match[2]);

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            continue;
        }

        slots.push({
            date: start.toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "Europe/Rome",
            }),
            time: `${start.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Europe/Rome",
            })} – ${end.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Europe/Rome",
            })}`,
        });
    }

    return slots;
};

export default function CopyWeeklySchedule({ onClose, onSuccess }) {
    const [isCopying, setIsCopying] = useState(false);
    const [copyError, setCopyError] = useState("");
    const [sourceDate, setSourceDate] = useState("");
    const sourceWeekStart = getWeekStart(sourceDate);
    const [destinationDate, setDestinationDate] = useState("");
    const destinationWeekStart = getWeekStart(destinationDate);
    const isSameWeek =
        sourceWeekStart !== "" &&
        destinationWeekStart !== "" &&
        sourceWeekStart === destinationWeekStart;
    const reservationConflictSlots = parseCopyError(copyError);

    const handleCopySchedule = async () => {
        if (!sourceWeekStart || !destinationWeekStart || isSameWeek || isCopying) {
            return;
        }

        setIsCopying(true);
        setCopyError("");

        try {
            const result = await capacityAPI.copyWeeklySchedule(
                sourceWeekStart,
                destinationWeekStart
            );

            if (Array.isArray(result.created) && result.created.length === 0) {
                setCopyError("No slots were copied. All slots were skipped.");
                return;
            }

            await onSuccess();
            onClose();
        } catch (error) {
            setCopyError(error.message || "Unable to copy weekly schedule.");
        } finally {
            setIsCopying(false);
        }
    };


    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="copy-week-title"
                className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0e1622] p-6 shadow-2xl sm:p-7"
            >
                {/* Modal header */}
                <div className="mb-5 flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-sky-300/25 bg-sky-300/10 text-sky-300">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="22"
                                height="22"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                <path d="M8 2v3" />
                                <path d="M16 2v3" />
                                <rect x="3" y="3" width="18" height="18" rx="2" />
                                <path d="M3 9h18" />
                            </svg>
                        </span>

                        <div>
                            <h2
                                id="copy-week-title"
                                className="text-xl font-semibold text-white"
                            >
                                Copy Weekly Schedule
                            </h2>
                            <p className="mt-1 text-xs text-slate-400">
                                Duplicate a weekly schedule
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isCopying}
                        aria-label="Close modal"
                        className="cursor-pointer flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <path d="M18 6 6 18" />
                            <path d="m6 6 12 12" />
                        </svg>
                    </button>
                </div>

                <div className="mb-5 border-t border-white/10" />

                <p className="text-sm leading-relaxed text-slate-300">
                    Select the source and destination weeks to copy dining
                    slots and their configuration.
                </p>

                {/* Source Week */}
                <div className="mt-6">
                    <label
                        htmlFor="source-week"
                        className="mb-2 block text-sm font-medium text-slate-300"
                    >
                        Source Week
                    </label>

                    <input
                        id="source-week"
                        type="date"
                        value={sourceDate}
                        onChange={(event) => setSourceDate(event.target.value)}
                        disabled={isCopying}
                        required
                        className="w-full rounded-xl border border-white/20 bg-[#080e18] px-4 py-3 text-white outline-none transition focus:border-sky-300 focus:ring-1 focus:ring-sky-300/30 disabled:opacity-50 [color-scheme:dark]"
                    />

                    <p className="mt-2 text-xs text-slate-400">
                        Select any day of the week you want to copy.
                    </p>

                    {sourceWeekStart && (
                        <p className="mt-2 text-sm font-medium text-sky-300">
                            {formatWeekRange(sourceWeekStart)}
                        </p>
                    )}
                </div>

                {/* Destination Week */}
                <div className="mt-6">
                    <label
                        htmlFor="destination-week"
                        className="mb-2 block text-sm font-medium text-slate-300"
                    >
                        Destination Week
                    </label>

                    <input
                        id="destination-week"
                        type="date"
                        value={destinationDate}
                        onChange={(event) => setDestinationDate(event.target.value)}
                        disabled={isCopying}
                        required
                        className="w-full rounded-xl border border-white/20 bg-[#080e18] px-4 py-3 text-white outline-none transition focus:border-sky-300 focus:ring-1 focus:ring-sky-300/30 disabled:opacity-50 [color-scheme:dark]"
                    />

                    <p className="mt-2 text-xs text-slate-400">
                        Select any day of the destination week.
                    </p>

                    {destinationWeekStart && (
                        <p className="mt-2 text-sm font-medium text-sky-300">
                            {formatWeekRange(destinationWeekStart)}
                        </p>
                    )}

                    {isSameWeek && (
                        <div
                            role="alert"
                            className="mt-3 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3"
                        >
                            <p className="text-sm text-red-300">
                                Source and destination weeks must be different.
                            </p>
                        </div>
                    )}
                </div>

                {/* Copy Summary */}
                {sourceWeekStart && destinationWeekStart && !isSameWeek && (
                    <div className="mt-6 rounded-xl border border-sky-300/25 bg-sky-300/10 p-4">
                        <h3 className="mb-3 text-sm font-semibold text-sky-300">
                            Copy Summary
                        </h3>

                        <p className="text-sm text-slate-200">
                            <strong className="text-white">From:</strong>{" "}
                            {formatWeekRange(sourceWeekStart)}
                        </p>

                        <p className="mt-2 text-sm text-slate-200">
                            <strong className="text-white">To:</strong>{" "}
                            {formatWeekRange(destinationWeekStart)}
                        </p>
                    </div>
                )}

                {/* Replacement warning */}
                {sourceWeekStart && destinationWeekStart && !isSameWeek && (
                    <div className="mt-5 rounded-xl border border-amber-400/25 bg-amber-400/10 p-4">
                        <div className="flex items-start gap-3">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="mt-0.5 shrink-0 text-amber-300"
                                aria-hidden="true"
                            >
                                <path d="m10.29 3.86-8.47 14.14A2 2 0 0 0 3.53 21h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                                <path d="M12 9v4" />
                                <path d="M12 17h.01" />
                            </svg>

                            <p className="text-sm leading-relaxed text-amber-200">
                                <strong className="font-semibold">
                                    Important:
                                </strong>{" "}
                                If the destination week already has a schedule,
                                it will be completely replaced. Copying is not
                                allowed if the destination week contains reservations.
                            </p>
                        </div>
                    </div>
                )}

                {/* API error */}
                {copyError && (
                    <div
                        role="alert"
                        className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 p-4"
                    >
                        {reservationConflictSlots !== null ? (
                            <div>
                                <div className="mb-3 flex items-center gap-2">
                                    <span className="text-red-300" aria-hidden="true">
                                        ⚠
                                    </span>
                                    <h3 className="text-sm font-semibold text-red-300">
                                        Cannot copy weekly schedule
                                    </h3>
                                </div>

                                <p className="text-sm leading-relaxed text-red-200">
                                    The destination week contains existing reservations.
                                    The schedule cannot be replaced.
                                </p>

                                {reservationConflictSlots.length > 0 && (
                                    <div className="mt-4">
                                        <p className="mb-2 text-sm font-semibold text-red-200">
                                            Affected time slots:
                                        </p>

                                        <div className="space-y-2">
                                            {reservationConflictSlots.map((slot, index) => (
                                                <div
                                                    key={index}
                                                    className="rounded-lg border border-red-400/15 bg-red-950/30 px-3 py-2"
                                                >
                                                    <p className="text-sm font-medium text-white">
                                                        {slot.date}
                                                    </p>
                                                    <p className="mt-1 text-sm text-red-200">
                                                        {slot.time}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <p className="mt-4 text-xs text-red-300">
                                    Choose another destination week or manage the
                                    existing reservations before trying again.
                                </p>
                            </div>
                        ) : (
                            <p className="text-sm text-red-300">
                                {copyError}
                            </p>
                        )}
                    </div>
                )}

                {/* Actions */}
                <div className="mt-7 flex flex-col-reverse gap-3 border-t border-white/10 pt-5 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isCopying}
                        className="cursor-pointer rounded-xl border border-white/20 px-5 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        onClick={handleCopySchedule}
                        disabled={
                            !sourceWeekStart ||
                            !destinationWeekStart ||
                            isSameWeek ||
                            isCopying
                        }
                        className="cursor-pointer rounded-xl border border-sky-300 bg-sky-300 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:border-sky-400 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {isCopying ? "Copying..." : "Copy Schedule"}
                    </button>
                </div>
            </div>
        </div>
    );

}