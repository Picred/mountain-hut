import { useEffect, useMemo, useState } from "react";
import { getHikerReservations, updateHikerReservation } from "../api/booking_api";
import { listAvailableSlots } from "../api/reservation_api";

const dateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

const localDateKey = (timestamp) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    return dateKey(date);
};

const formatDateTime = (timestamp) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return date.toLocaleString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
};

const isEditable = (reservation) => {
    if (!["confirmed", "waiting"].includes(reservation.status)) return false;
    // Changes are admitted until 48 hours before the booked slot starts.
    const startAt = new Date(reservation.startAt).getTime();
    return Number.isFinite(startAt) && startAt - Date.now() >= 48 * 60 * 60 * 1000;
};

const sameRequirement = (left, right) =>
    left.peopleCount === right.peopleCount &&
    left.description.trim() === right.description.trim() &&
    left.isAllergy === right.isAllergy;

const statusClass = {
    confirmed: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    waiting: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    cancelled: "border-slate-400/30 bg-slate-400/10 text-slate-300",
};

export const MyReservationsPage = () => {
    const [reservations, setReservations] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [selectedReservation, setSelectedReservation] = useState(null);
    const [editDate, setEditDate] = useState("");
    const [slotId, setSlotId] = useState("");
    const [partySize, setPartySize] = useState(1);
    const [requirements, setRequirements] = useState([]);
    const [slots, setSlots] = useState([]);
    const [slotsLoading, setSlotsLoading] = useState(false);
    const [slotsError, setSlotsError] = useState("");
    const [requirementDraft, setRequirementDraft] = useState({
        peopleCount: 1,
        description: "",
        isAllergy: false,
    });
    const [formError, setFormError] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [notice, setNotice] = useState("");

    const reloadReservations = async () => {
        setLoadError("");
        const data = await getHikerReservations();
        if (!Array.isArray(data)) {
            throw new Error("The reservations response was not in the expected format.");
        }
        setReservations(data);
    };

    useEffect(() => {
        let cancelled = false;

        getHikerReservations()
            .then((data) => {
                if (!Array.isArray(data)) {
                    throw new Error("The reservations response was not in the expected format.");
                }
                if (!cancelled) setReservations(data);
            })
            .catch((error) => {
                if (!cancelled) setLoadError(error.message);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!editDate) return;

        let cancelled = false;
        listAvailableSlots(editDate)
            .then((data) => {
                if (cancelled) return;
                const bookableSlots = (data || []).filter((slot) => slot.bookingAllowed);
                setSlots(bookableSlots);
                setSlotId((current) =>
                    bookableSlots.some((slot) => String(slot.slotId) === String(current))
                        ? current
                        : ""
                );
            })
            .catch((error) => {
                if (!cancelled) {
                    setSlots([]);
                    setSlotId("");
                    setSlotsError(error.message || "Could not load time slots.");
                }
            })
            .finally(() => {
                if (!cancelled) setSlotsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [editDate, selectedReservation?.reservationId]);

    const requirementPeople = useMemo(
        () => requirements.reduce((total, requirement) => total + Number(requirement.peopleCount), 0),
        [requirements]
    );

    const openEditor = (reservation) => {
        setSelectedReservation(reservation);
        setEditDate(localDateKey(reservation.startAt));
        setSlotId(String(reservation.slotId));
        setPartySize(reservation.partySize);
        setRequirements(reservation.requirements.map((requirement) => ({ ...requirement })));
        setRequirementDraft({ peopleCount: 1, description: "", isAllergy: false });
        setFormError("");
        setSlotsLoading(true);
        setSlotsError("");
        setNotice("");
    };

    const closeEditor = () => {
        setSelectedReservation(null);
        setSlots([]);
        setSlotsLoading(false);
        setFormError("");
        setSlotsError("");
    };

    const addRequirement = () => {
        const peopleCount = Number(requirementDraft.peopleCount);
        const description = requirementDraft.description.trim();
        if (!Number.isInteger(peopleCount) || peopleCount <= 0 || !description) {
            setFormError("Enter a positive number of people and a description.");
            return;
        }
        if (requirementPeople + peopleCount > Number(partySize)) {
            setFormError("The total number of people with requirements cannot exceed the party size.");
            return;
        }

        setRequirements((current) => [
            ...current,
            { peopleCount, description, isAllergy: requirementDraft.isAllergy },
        ]);
        setRequirementDraft({ peopleCount: 1, description: "", isAllergy: false });
        setFormError("");
    };

    const updateRequirement = (index, field, value) => {
        setRequirements((current) => current.map((requirement, itemIndex) => (
            itemIndex === index
                ? { ...requirement, [field]: field === "peopleCount" ? Number(value) : value }
                : requirement
        )));
        setFormError("");
    };

    const saveChanges = async (event) => {
        event.preventDefault();
        if (!selectedReservation) return;
        setFormError("");
        setNotice("");

        if (!editDate || !slotId || !Number.isInteger(Number(partySize)) || Number(partySize) <= 0) {
            setFormError("Choose a date, time slot, and valid party size.");
            return;
        }
        if (requirements.some((requirement) =>
            !Number.isInteger(Number(requirement.peopleCount)) ||
            Number(requirement.peopleCount) <= 0 ||
            !requirement.description.trim()
        )) {
            setFormError("Each requirement needs a positive people count and a description.");
            return;
        }
        if (requirementPeople > Number(partySize)) {
            setFormError("The total number of people with requirements cannot exceed the party size.");
            return;
        }

        const changes = {};
        if (Number(slotId) !== selectedReservation.slotId) changes.slotId = Number(slotId);
        if (Number(partySize) !== selectedReservation.partySize) changes.partySize = Number(partySize);

        const originalById = new Map(
            selectedReservation.requirements.map((requirement) => [requirement.id, requirement])
        );
        const currentIds = new Set(
            requirements.filter((requirement) => requirement.id !== undefined).map((requirement) => requirement.id)
        );
        const added = requirements
            .filter((requirement) => requirement.id === undefined)
            .map(({ peopleCount, description, isAllergy }) => ({
                peopleCount: Number(peopleCount),
                description: description.trim(),
                isAllergy,
            }));
        const updated = requirements
            .filter((requirement) => requirement.id !== undefined)
            .filter((requirement) => {
                const original = originalById.get(requirement.id);
                return original && !sameRequirement(original, requirement);
            })
            .map(({ id, peopleCount, description, isAllergy }) => ({
                id,
                peopleCount: Number(peopleCount),
                description: description.trim(),
                isAllergy,
            }));
        const removed = selectedReservation.requirements
            .filter((requirement) => !currentIds.has(requirement.id))
            .map((requirement) => requirement.id);

        if (added.length || updated.length || removed.length) {
            changes.requirements = { add: added, update: updated, remove: removed };
        }

        if (Object.keys(changes).length === 0) {
            setFormError("Make at least one change before saving.");
            return;
        }

        setIsSaving(true);
        try {
            await updateHikerReservation(selectedReservation.reservationId, changes);
            closeEditor();
            setNotice("Your reservation was updated.");
            try {
                await reloadReservations();
            } catch (error) {
                setLoadError(`Changes were saved, but the reservation list could not be refreshed: ${error.message}`);
            }
        } catch (error) {
            setFormError(error.message || "Could not update this reservation.");
        } finally {
            setIsSaving(false);
        }
    };

    const today = dateKey(new Date());
    const selectedTimeSlot = slots.find((slot) => String(slot.slotId) === String(slotId));

    return (
        <section className="w-full px-4 py-10 text-slate-100 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-5xl">
                <header className="mb-8">
                    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-300">Your account</p>
                    <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">My reservations</h1>
                    <p className="mt-3 max-w-2xl text-slate-300">
                        Review your bookings and update the date, time, party size, or party requirements.
                        Changes are allowed until 48 hours before the booked date.
                    </p>
                </header>

                {notice && (
                    <p role="status" className="mb-5 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-emerald-200">
                        {notice}
                    </p>
                )}
                {loadError && (
                    <div role="alert" className="mb-5 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-red-200">
                        <p>{loadError}</p>
                        <button className="mt-3 underline" type="button" onClick={() => {
                            setIsLoading(true);
                            reloadReservations()
                                .catch((error) => setLoadError(error.message))
                                .finally(() => setIsLoading(false));
                        }}>
                            Try again
                        </button>
                    </div>
                )}

                {isLoading ? (
                    <p role="status" className="rounded-2xl border border-white/10 bg-[#0e1622]/90 p-6 text-slate-300">
                        Loading your reservations…
                    </p>
                ) : !loadError && reservations.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-[#0e1622]/90 p-8 text-center">
                        <h2 className="text-xl font-semibold text-white">No reservations yet</h2>
                        <p className="mt-2 text-slate-300">Your bookings will appear here after you reserve a table.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {reservations.map((reservation) => {
                            const editable = isEditable(reservation);
                            return (
                                <article key={reservation.reservationId} className="rounded-2xl border border-white/10 bg-[#0e1622]/95 p-5 shadow-lg sm:p-6">
                                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                        <div>
                                            <div className="flex flex-wrap items-center gap-3">
                                                <h2 className="text-lg font-semibold text-white">
                                                    Reservation #{reservation.reservationId}
                                                </h2>
                                                <span className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${statusClass[reservation.status] || statusClass.cancelled}`}>
                                                    {reservation.status}
                                                </span>
                                            </div>
                                            <p className="mt-3 text-slate-200">{formatDateTime(reservation.startAt)}</p>
                                            <p className="mt-1 text-sm text-slate-400">
                                                {reservation.partySize} {reservation.partySize === 1 ? "guest" : "guests"}
                                                {reservation.tableAllocation?.length > 0 && (
                                                    <> · Tables {reservation.tableAllocation.map((table) => table.tableCode).join(", ")}</>
                                                )}
                                            </p>
                                        </div>
                                        {editable ? (
                                            <button
                                                type="button"
                                                className="btn btn-sm gap-2 border-sky-300 bg-sky-300 text-slate-950 hover:border-sky-200 hover:bg-sky-200"
                                                onClick={() => openEditor(reservation)}
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4Z" /></svg>
                                                Change reservation
                                            </button>
                                        ) : (
                                            <p className="text-sm text-slate-400">
                                                {reservation.status === "cancelled"
                                                    ? "Cancelled reservations cannot be changed."
                                                    : "Changes are no longer allowed less than 48 hours before the booked date."}
                                            </p>
                                        )}
                                    </div>

                                    {reservation.requirements?.length > 0 && (
                                        <div className="mt-5 border-t border-white/10 pt-4">
                                            <h3 className="mb-2 text-sm font-semibold text-slate-300">Party requirements</h3>
                                            <ul className="space-y-1 text-sm text-slate-400">
                                                {reservation.requirements.map((requirement) => (
                                                    <li key={requirement.id}>
                                                        {requirement.peopleCount} {requirement.peopleCount === 1 ? "person" : "people"}: {requirement.description}
                                                        {requirement.isAllergy && <span className="ml-2 text-amber-300">(allergy)</span>}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                )}

                {selectedReservation && (
                    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-4 py-8">
                        <section
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="edit-reservation-title"
                            className="w-full max-w-2xl rounded-2xl border border-white/15 bg-[#0e1622] p-5 shadow-2xl sm:p-7"
                        >
                            <div className="mb-6 flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-sm text-sky-300">Reservation #{selectedReservation.reservationId}</p>
                                    <h2 id="edit-reservation-title" className="mt-1 text-2xl font-bold text-white">Change your booking</h2>
                                </div>
                                <button type="button" className="btn btn-sm border border-white/20 bg-white/10 text-white hover:border-white/40 hover:bg-white/20" onClick={closeEditor} disabled={isSaving}>
                                    Close
                                </button>
                            </div>

                            <form onSubmit={saveChanges} className="space-y-6">
                                <div className="grid items-start gap-5 sm:grid-cols-3">
                                    <div className="space-y-2">
                                        <label htmlFor="edit-reservation-date" className="block text-sm font-medium text-slate-300">Date</label>
                                        <input
                                            id="edit-reservation-date"
                                            type="date"
                                            min={today}
                                            value={editDate}
                                            onChange={(event) => {
                                                setSlotsLoading(true);
                                                setSlotsError("");
                                                setEditDate(event.target.value);
                                            }}
                                            className="scheme-dark h-12 w-full rounded-xl border border-white/15 bg-[#0e1622] px-4 text-sm text-white outline-none focus:border-sky-300"
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2 sm:col-span-2">
                                        <label htmlFor="edit-reservation-slot" className="block text-sm font-medium text-slate-300">Time slot</label>
                                        <div className="relative">
                                            <select
                                                id="edit-reservation-slot"
                                                value={slotId}
                                                onChange={(event) => setSlotId(event.target.value)}
                                                className="h-12 w-full appearance-none rounded-xl border border-white/15 bg-[#0e1622] py-3 pl-4 pr-12 text-sm text-white outline-none focus:border-sky-300"
                                                disabled={slotsLoading || slots.length === 0}
                                                required
                                            >
                                                <option value="">
                                                    {slotsLoading ? "Loading slots…" : "Choose a time"}
                                                </option>
                                                {slots.map((slot) => (
                                                    <option key={slot.slotId} value={slot.slotId}>
                                                        {slot.startTime} – {slot.endTime}
                                                    </option>
                                                ))}
                                            </select>
                                            <svg
                                                aria-hidden="true"
                                                className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300"
                                                viewBox="0 0 20 20"
                                                fill="none"
                                            >
                                                <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        </div>
                                    </div>
                                </div>
                                {slotsError && <p role="alert" className="text-sm text-red-300">{slotsError}</p>}
                                {!slotsLoading && editDate && !slotsError && slots.length === 0 && (
                                    <p className="text-sm text-amber-200">No bookable time slots are available on this date.</p>
                                )}
                                {selectedTimeSlot && (
                                    <p className="text-sm text-slate-400">
                                        Availability is checked when you save. If the updated party cannot be seated, your original reservation remains unchanged.
                                    </p>
                                )}

                                <div className="max-w-xs space-y-2">
                                    <label htmlFor="edit-reservation-party-size" className="block text-sm font-medium text-slate-300">Party size</label>
                                    <input
                                        id="edit-reservation-party-size"
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={partySize}
                                        onChange={(event) => setPartySize(event.target.value)}
                                        className="h-12 w-full rounded-xl border border-white/15 bg-[#0e1622] px-4 text-sm text-white outline-none focus:border-sky-300"
                                        required
                                    />
                                </div>

                                <div className="border-t border-white/10 pt-5">
                                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <h3 className="font-semibold text-white">Party requirements</h3>
                                            <p className="text-xs text-slate-400">Allergy flag and description can be changed for each entry.</p>
                                        </div>
                                        <span className="text-xs text-slate-400">
                                            {requirementPeople} of {Number(partySize) || 0} guests covered
                                        </span>
                                    </div>

                                    <div className="space-y-3">
                                        {requirements.map((requirement, index) => (
                                            <div key={requirement.id ?? `new-${index}`} className="space-y-4 rounded-xl border border-white/10 bg-[#090f19] p-4">
                                                <div className="grid items-start gap-5 sm:grid-cols-2">
                                                    <div className="space-y-2">
                                                        <label htmlFor={`requirement-${requirement.id ?? index}-people`} className="block text-sm font-medium text-slate-300">Number of people</label>
                                                        <input
                                                            id={`requirement-${requirement.id ?? index}-people`}
                                                            type="number"
                                                            min="1"
                                                            step="1"
                                                            value={requirement.peopleCount}
                                                            onChange={(event) => updateRequirement(index, "peopleCount", event.target.value)}
                                                            className="h-12 w-full rounded-xl border border-white/15 bg-[#0e1622] px-4 text-sm text-white outline-none focus:border-sky-300"
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <label htmlFor={`requirement-${requirement.id ?? index}-description`} className="block text-sm font-medium text-slate-300">Description</label>
                                                        <textarea
                                                            id={`requirement-${requirement.id ?? index}-description`}
                                                            rows="2"
                                                            value={requirement.description}
                                                            onChange={(event) => updateRequirement(index, "description", event.target.value)}
                                                            className="min-h-12 w-full resize-y rounded-xl border border-white/15 bg-[#0e1622] px-4 py-3 text-sm leading-6 text-white outline-none focus:border-sky-300"
                                                            required
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
                                                    <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-300">
                                                        <input
                                                            aria-label={`Requirement ${index + 1} is allergy`}
                                                            type="checkbox"
                                                            checked={requirement.isAllergy}
                                                            onChange={(event) => updateRequirement(index, "isAllergy", event.target.checked)}
                                                            className="mt-0.5 h-4 w-4 accent-sky-300"
                                                        />
                                                        <span>Contains allergies</span>
                                                    </label>
                                                    <button
                                                        type="button"
                                                        className="rounded-lg border border-red-400/30 px-4 py-2 text-sm font-semibold text-red-300 transition-colors hover:bg-red-400/10"
                                                        onClick={() => setRequirements((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="mt-5 space-y-4 rounded-xl border border-dashed border-white/15 bg-[#090f19] p-4">
                                        <div className="grid items-start gap-5 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <label htmlFor="new-requirement-people" className="block text-sm font-medium text-slate-300">Number of people</label>
                                                <input
                                                    id="new-requirement-people"
                                                    type="number"
                                                    min="1"
                                                    step="1"
                                                    value={requirementDraft.peopleCount}
                                                    onChange={(event) => setRequirementDraft((current) => ({ ...current, peopleCount: event.target.value }))}
                                                    className="h-12 w-full rounded-xl border border-white/15 bg-[#0e1622] px-4 text-sm text-white outline-none focus:border-sky-300"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label htmlFor="new-requirement-description" className="block text-sm font-medium text-slate-300">Description</label>
                                                <textarea
                                                    id="new-requirement-description"
                                                    rows="2"
                                                    value={requirementDraft.description}
                                                    onChange={(event) => setRequirementDraft((current) => ({ ...current, description: event.target.value }))}
                                                    placeholder="e.g. Vegan, peanut allergy"
                                                    className="min-h-12 w-full resize-y rounded-xl border border-white/15 bg-[#0e1622] px-4 py-3 text-sm leading-6 text-white outline-none focus:border-sky-300"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-4 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
                                            <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-300">
                                                <input
                                                    aria-label="New requirement is allergy"
                                                    type="checkbox"
                                                    checked={requirementDraft.isAllergy}
                                                    onChange={(event) => setRequirementDraft((current) => ({ ...current, isAllergy: event.target.checked }))}
                                                    className="mt-0.5 h-4 w-4 accent-sky-300"
                                                />
                                                <span>Contains allergies</span>
                                            </label>
                                            <button
                                                type="button"
                                                className="w-full cursor-pointer rounded-xl bg-sky-300 px-5 py-3 font-semibold text-slate-950 transition-colors hover:bg-sky-200 sm:w-auto"
                                                onClick={addRequirement}
                                            >
                                                + Add requirement
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {formError && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{formError}</p>}

                                <div className="flex flex-col-reverse justify-end gap-3 border-t border-white/10 pt-5 sm:flex-row">
                                    <button type="button" className="btn border border-white/20 bg-white/10 text-white hover:border-white/40 hover:bg-white/20" onClick={closeEditor} disabled={isSaving}>
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn border-sky-300 bg-sky-300 text-slate-950 hover:border-sky-200 hover:bg-sky-200"
                                        disabled={isSaving || slotsLoading || !slotId || slotsError !== ""}
                                    >
                                        {isSaving ? "Saving…" : "Save changes"}
                                    </button>
                                </div>
                            </form>
                        </section>
                    </div>
                )}
            </div>
        </section>
    );
};
