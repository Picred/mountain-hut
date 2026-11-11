import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router";
import { listAvailableSlots, checkAvailability } from "../api/reservation_api";
import Calendar from "./Calendar";

// Format a local date as YYYY-MM-DD without converting it to UTC.
const dateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Temporary password of a hiker registered by an employee together with the reservation.
// The backend returns it only in this response.
const TemporaryPassword = ({ password, email }) => {
  const [copied, setCopied] = useState(false);

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The password can still be selected and copied by hand.
      setCopied(false);
    }
  };

  return (
    <div
      role="status"
      className="mt-6 rounded-xl border border-amber-300/40 bg-amber-300/10 p-5"
    >
      <p className="text-sm font-semibold text-amber-200">Temporary password</p>

      <div className="mt-3 flex items-center justify-between gap-3">
        <code className="select-all break-all font-mono text-xl tracking-wider text-white">
          {password}
        </code>

        <button
          type="button"
          onClick={copyPassword}
          className="shrink-0 cursor-pointer rounded-lg border border-amber-300/40 px-3 py-1.5 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-300/10"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-amber-100/80">
        This password is shown only now. Give it to the hiker
        {email ? ` (${email})` : ""}: it must be changed at the first login.
      </p>
    </div>
  );
};

/**
 * Availability check and reservation flow, shared by the hiker page and the
 * employee page.
 * Anyone can choose a date, a time slot and a party size and check the
 * availability; only logged-in users can then submit the booking, the
 * others are asked to log in.
 * The backend validates availability and returns the assigned tables.
 *
 * Props:
 * - loggedIn: whether the user can submit the booking.
 * - title, subtitle, deadlineText: texts of the page heading.
 * - topSection: optional block shown above the form (e.g. the hiker selection).
 * - firstStep: number of the first step of the form (2 when topSection is step 1).
 * - canReserve, reserveHint: the Reserve button is disabled while canReserve is
 *   false, and reserveHint explains why.
 * - onReserve({ slotId, partySize, requirements }): sends the booking and returns
 *   the created reservation.
 * - confirmation: { message, primaryLabel, onPrimary } for the confirmation card.
 */
export const BookingFlow = ({
  loggedIn,
  title,
  subtitle,
  deadlineText,
  topSection = null,
  firstStep = 1,
  canReserve = true,
  reserveHint = null,
  onReserve,
  confirmation,
}) => {
  // Booking form selections.
  // A visitor who logs in from this page comes back with the same selection.
  const location = useLocation();
  const savedSelection = location.state?.reservation;

  const [date, setDate] = useState(savedSelection?.date || "");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [partySize, setPartySize] = useState(savedSelection?.partySize || 1);

  // Dietary requirements for the party.
  const [requirements, setRequirements] = useState(
    savedSelection?.requirements || []
  );

  // Controls the visibility of the requirement form.
  const [showRequirementForm, setShowRequirementForm] = useState(false);

  // Fields for a new requirement.
  const [requirementPeopleCount, setRequirementPeopleCount] = useState(1);
  const [requirementDescription, setRequirementDescription] = useState("");
  const [requirementIsAllergy, setRequirementIsAllergy] = useState(false);

  // Validation error for the requirement form.
  const [requirementError, setRequirementError] = useState(null);

  // Slot to select again once the slots of the restored date are loaded.
  const pendingSlotId = useRef(savedSelection?.slotId || null);

  // Slot-fetching state, updated whenever the selected date changes.
  const [slots, setSlots] = useState([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  // Result of the last availability check.
  const [availability, setAvailability] = useState(null);
  const [isChecking, setIsChecking] = useState(false);

  // Reservation submission state and successful booking details.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [reservationDetails, setReservationDetails] = useState(null);

  const navigate = useNavigate();
  const todayStr = dateKey(new Date());

  // Reset the fields used to create a new requirement.
  const resetRequirementForm = () => {
    setRequirementPeopleCount(1);
    setRequirementDescription("");
    setRequirementIsAllergy(false);
    setRequirementError(null);
  };

  // Clear all requirements when booking details change.
  const resetRequirements = () => {
    setRequirements([]);
    resetRequirementForm();
    setShowRequirementForm(false);
  };

  // Open or close the requirement form.
  const handleToggleRequirementForm = () => {
    if (showRequirementForm) {
      resetRequirementForm();
      setShowRequirementForm(false);
      return;
    }

    setRequirementError(null);
    setShowRequirementForm(true);
  };

  // Add a dietary requirement to the current reservation.
  const handleAddRequirement = () => {
    setRequirementError(null);

    const peopleCount = Number(requirementPeopleCount);
    const description = requirementDescription.trim();

    // Validate the number of people.
    if (!Number.isInteger(peopleCount) || peopleCount <= 0) {
      setRequirementError("Please enter a valid number of people.");
      return;
    }

    // Validate the description.
    if (!description) {
      setRequirementError("Please enter a requirement description.");
      return;
    }

    // Count the people already covered by existing requirements.
    const assignedPeople = requirements.reduce(
      (total, requirement) => total + requirement.peopleCount,
      0
    );

    // The total cannot exceed the number of guests.
    if (assignedPeople + peopleCount > partySize) {
      setRequirementError(
        "You cannot add requirements for more people than the total number of guests."
      );
      return;
    }

    // Add the new requirement to the list.
    setRequirements((current) => [
      ...current,
      {
        peopleCount,
        description,
        isAllergy: requirementIsAllergy,
      },
    ]);

    // Close the form and clear its fields.
    resetRequirementForm();
    setShowRequirementForm(false);
  };

  // Fetch the slots for the selected date and clear any previous slot selection.
  useEffect(() => {
    if (!date) return;

    // Ignore responses from an outdated request if the date changes or the page unmounts.
    let isCancelled = false;

    const fetchSlots = async () => {
      setIsLoadingSlots(true);
      setFetchError(null);
      setSelectedSlotId("");
      setSlots([]);

      try {
        const data = await listAvailableSlots(date);

        if (!isCancelled) {
          setSlots(data || []);

          // Restore the slot chosen before the login and run the check again.
          const restoredId = pendingSlotId.current;
          pendingSlotId.current = null;

          if (
            restoredId &&
            (data || []).some((slot) => String(slot.slotId) === String(restoredId))
          ) {
            setSelectedSlotId(String(restoredId));
            // Consume the saved selection so a page refresh does not restore it again.
            navigate(location.pathname, { replace: true, state: null });
            try {
              setAvailability(
                await checkAvailability(restoredId, savedSelection.partySize)
              );
            } catch {
              // The user can still press "Check availability" manually.
            }
          }
        }
      } catch (err) {
        if (!isCancelled) {
          setFetchError(
            err.message || "Failed to load time slots."
          );
          setSlots([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingSlots(false);
        }
      }
    };

    fetchSlots();

    return () => {
      isCancelled = true;
    };
  }, [date]);

  // Convert ISO timestamps (stored in UTC) to the browser's local time.
  // Plain HH:mm strings are displayed without conversion.
  const formatTime = (timeStr) => {
    if (!timeStr) return "";

    if (timeStr.includes("T")) {
      return new Date(timeStr).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    return timeStr.substring(0, 5);
  };

  // Reject past dates and reset the selected slot and any submission error.
  // Reset availability and requirements when the selected date changes.
  const handleDateSelect = (newDate) => {
    if (newDate < dateKey(new Date())) return;

    // Do nothing if the user selects the same date.
    if (newDate === date) return;

    setDate(newDate);
    setSelectedSlotId("");
    setAvailability(null);
    setSubmitError(null);
    resetRequirements();
  };

  // Show the result only while it matches the current selection: changing
  // the slot or the guests hides it, so "Reserve" always refers to what was checked.
  const currentAvailability =
    availability &&
      availability.slotId === Number(selectedSlotId) &&
      availability.partySize === partySize
      ? availability
      : null;

  // Check whether the selected slot has room for the party. No login needed.
  const handleCheck = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    if (!date || !selectedSlotId || !partySize) {
      setSubmitError("Please complete all booking details.");
      return;
    }

    setIsChecking(true);

    try {
      setAvailability(await checkAvailability(selectedSlotId, partySize));
    } catch (err) {
      setAvailability(null);
      setSubmitError(err.message || "Unable to check availability.");
    } finally {
      setIsChecking(false);
    }
  };

  // Submit the selected slot and party size; the backend decides whether
  // enough seats are available and which tables to allocate.
  const handleReserve = async () => {
    setSubmitError(null);

    if (!date || !selectedSlotId || !partySize) {
      setSubmitError("Please complete all booking details.");
      return;
    }

    const selectedSlot = slots.find(
      (slot) => String(slot.slotId) === String(selectedSlotId)
    );

    if (!selectedSlot || selectedSlot.bookingAllowed !== true) {
      setSubmitError("This time slot is no longer available for booking.");
      return
    }

    setIsSubmitting(true);

    try {
      const result = await onReserve({
        slotId: selectedSlotId,
        partySize,
        requirements,
      });

      setReservationDetails(result);
      setIsSubmitted(true);
    } catch (err) {
      setSubmitError(
        err.message || "Unable to complete the reservation."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Seating of the checked party: "T1 (2 seats) + T3 (3 seats) + T5 (1 seat)".
  const seatingLabel = currentAvailability?.tableAllocation
    ?.map(
      (table) =>
        `${table.tableCode} (${table.allocatedSeats} ${table.allocatedSeats === 1 ? "seat" : "seats"})`
    )
    .join(" + ");

  // Format the selected calendar date for the slot section heading.
  const formattedDate = date
    ? new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
    : null;

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 lg:px-8 text-slate-100">
      <div className="mx-auto max-w-6xl">


        {/* Page heading */}
        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-center">

          {/* Left: Title and subtitle */}
          <div>

            <h1 className="text-3xl font-bold text-white sm:text-4xl">
              {title}
            </h1>

            <p className="mt-3 text-sm text-slate-400">
              {subtitle}
            </p>
          </div>

          {/* Right: Booking information */}
          <div className="space-y-4 lg:pl-4">

            <div className="flex items-start gap-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 shrink-0 text-sky-300"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>

              <div>
                <p className="text-sm font-semibold text-slate-200">
                  Shared seating: tables may be shared with other hikers.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 shrink-0 text-sky-300"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>

              <div>
                <p className="text-sm font-semibold text-slate-200">
                  {deadlineText}
                </p>
              </div>
            </div>

          </div>
        </div>


        {/* Show either the booking confirmation or the reservation form. */}
        {isSubmitted && reservationDetails ? (
          <div className="mx-auto max-w-xl rounded-2xl border border-emerald-400/30 bg-[#0e1622]/90 p-8 shadow-xl">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>

            <h2 className="text-2xl font-bold text-white">
              Reservation confirmed!
            </h2>

            <p className="mt-2 text-sm text-slate-400">
              {confirmation.message}
            </p>

            {reservationDetails.temporaryPassword && (
              <TemporaryPassword
                password={reservationDetails.temporaryPassword}
                email={reservationDetails.hiker?.email}
              />
            )}

            <div className="mt-6 space-y-3 rounded-xl border border-white/10 bg-[#090f19] p-5 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-400">Reservation code</span>
                <strong className="text-sky-300">
                  #{reservationDetails.reservationId}
                </strong>
              </div>

              {/* Shown when an employee booked for a hiker. */}
              {reservationDetails.hiker && (
                <div className="space-y-1 border-b border-white/10 pb-3">
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-400">Hiker</span>
                    <strong className="break-words text-right text-white">
                      {reservationDetails.hiker.name}
                    </strong>
                  </div>
                  {reservationDetails.hiker.email && (
                    <p className="break-words text-right text-slate-300">
                      {reservationDetails.hiker.email}
                    </p>
                  )}
                  {reservationDetails.hiker.phone && (
                    <p className="text-right text-slate-300">
                      {reservationDetails.hiker.phone}
                    </p>
                  )}
                  {reservationDetails.hiker.userId == null && (
                    <p className="text-right text-xs text-amber-300">
                      Temporary hiker: no web account
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-between gap-4">
                <span className="text-slate-400">Guests</span>
                <strong className="text-white">
                  {reservationDetails.partySize}
                </strong>
              </div>

              {/* A booking may be split across multiple tables. */}
              {reservationDetails.tableAllocation?.length > 0 && (
                <div className="border-t border-white/10 pt-3">
                  <p className="mb-2 text-slate-400">
                    Assigned tables
                  </p>
                  <p className="text-slate-200">
                    {reservationDetails.tableAllocation
                      .map(
                        (table) =>
                          `${table.tableCode} (${table.allocatedSeats} seats)`
                      )
                      .join(", ")}
                  </p>
                </div>
              )}

              {/* Display dietary requirements included in the reservation. */}
              {reservationDetails.requirements?.length > 0 && (
                <div className="border-t border-white/10 pt-3">
                  <p className="mb-3 text-slate-400">
                    Party requirements
                  </p>

                  <div className="space-y-3">
                    {reservationDetails.requirements.map((requirement, index) => (
                      <div key={index}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-slate-200">
                            Requirement {index + 1}
                          </p>

                          <span className="text-sky-300">
                            {requirement.peopleCount}{" "}
                            {requirement.peopleCount === 1 ? "person" : "people"}
                          </span>
                        </div>

                        <p className="mt-1 whitespace-pre-wrap break-words text-slate-300">
                          {requirement.description}
                        </p>

                        {requirement.isAllergy && (
                          <p className="mt-2 flex items-center gap-2 text-amber-300">
                            <span aria-hidden="true">⚠</span>
                            Allergy
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={confirmation.onPrimary}
              className="mt-6 w-full cursor-pointer rounded-xl bg-sky-300 px-5 py-3 font-semibold text-slate-950 transition-colors hover:bg-sky-200"
            >
              {confirmation.primaryLabel}
            </button>
          </div>
        ) : (
          <>
          {topSection && <div className="mb-8">{topSection}</div>}
          <form
            onSubmit={handleCheck}
            className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2"
          >
            {/* Left: Calendar */}
            <div>
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-300 font-bold text-slate-950">
                  {firstStep}
                </span>
                <h2 className="text-lg font-semibold text-white">
                  Select a date
                </h2>
              </div>

              <Calendar
                selectedDate={date}
                onDateSelect={handleDateSelect}
                minDate={todayStr}
              />
            </div>

            {/* Right: Booking details */}
            <div className="space-y-6">

              {/* Time slots: loading, error, empty and selectable states. */}
              <div>
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-300 font-bold text-slate-950">
                    {firstStep + 1}
                  </span>
                  <h2 className="text-lg font-semibold text-white">
                    Select a time slot
                  </h2>
                </div>

                <section className="rounded-2xl border border-white/10 bg-[#0e1622]/90 p-5 shadow-xl sm:p-6">

                  {!date ? (
                    <p className="rounded-xl border border-dashed border-white/15 bg-[#090f19] p-5 text-center text-sm text-slate-400">
                      Select a date on the calendar to view time slots.
                    </p>
                  ) : isLoadingSlots ? (
                    <div className="flex items-center justify-center gap-3 py-10 text-sm text-slate-400">
                      <span className="loading loading-spinner loading-sm text-sky-300" />
                      Loading time slots...
                    </div>
                  ) : fetchError ? (
                    <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-300">
                      {fetchError}
                    </p>
                  ) : slots.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-white/15 bg-[#090f19] p-5 text-center text-sm text-slate-400">
                      No time slots found for this date.
                    </p>
                  ) : (
                    <>
                      <p className="mb-4 text-sm text-slate-400">
                        {formattedDate}
                      </p>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {slots.map((slot) => {
                          const isBookable = slot.bookingAllowed === true;
                          const isSelected =
                            String(selectedSlotId) ===
                            String(slot.slotId);

                          return (
                            <button
                              type="button"
                              key={slot.slotId}
                              disabled={!isBookable}
                              onClick={() => {
                                if (!isBookable) return;

                                // Do nothing if the selected slot has not changed.
                                if (String(selectedSlotId) === String(slot.slotId)) return;

                                setSelectedSlotId(String(slot.slotId));
                                setAvailability(null);
                                setSubmitError(null);
                                resetRequirements();
                              }}
                              aria-pressed={isSelected}
                              className={`flex min-h-16 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${!isBookable
                                ? "cursor-not-allowed border-white/5 bg-[#090f19]/50 text-slate-500 opacity-50"
                                : isSelected
                                  ? "cursor-pointer border-sky-300 bg-sky-300/10 text-sky-200"
                                  : "cursor-pointer border-white/10 bg-[#090f19] text-slate-200 hover:border-sky-300/40 hover:bg-white/5"
                                }`}
                            >
                              <span className="text-sm font-medium">
                                {formatTime(slot.startTime)}
                                {" – "}
                                {formatTime(slot.endTime)}
                              </span>

                              {!isBookable && (
                                <span className="text-xs font-medium text-amber-300">
                                  Booking closed
                                </span>
                              )}

                              {isSelected && (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="18"
                                  height="18"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="shrink-0 text-sky-300"
                                >
                                  <path d="M20 6 9 17l-5-5" />
                                </svg>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </section>
              </div>

              {/* Guest count: minimum one guest; no frontend maximum. */}
              <div>
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-300 font-bold text-slate-950">
                    {firstStep + 2}
                  </span>
                  <h2 className="text-lg font-semibold text-white">
                    Select number of guests
                  </h2>
                </div>

                <section className="rounded-2xl border border-white/10 bg-[#0e1622]/90 p-5 shadow-xl sm:p-6">

                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#090f19] p-4">
                    <span className="text-sm text-slate-300">
                      Guests
                    </span>

                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => {
                          if (partySize <= 1) return;

                          setPartySize((current) => current - 1);
                          setAvailability(null);
                          setSubmitError(null);
                          resetRequirements();
                        }}
                        disabled={partySize <= 1}
                        aria-label="Remove one guest"
                        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-white/15 text-xl text-sky-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        −
                      </button>

                      <span className="min-w-6 text-center text-lg font-semibold text-white">
                        {partySize}
                      </span>

                      <button
                        type="button"
                        onClick={() => {
                          setPartySize((current) => current + 1);
                          setAvailability(null);
                          setSubmitError(null);
                          resetRequirements();
                        }}
                        aria-label="Add one guest"
                        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-white/15 text-xl text-sky-300 transition-colors hover:bg-white/10"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </section>
              </div>

              {/* Display availability or validation errors returned during booking. */}
              {submitError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-sm text-red-300"
                >
                  {submitError}
                </div>
              )}

              {/* The check is available to everyone; it needs a date and a slot. */}
              <button
                type="submit"
                disabled={
                  !date ||
                  !selectedSlotId ||
                  isChecking ||
                  isLoadingSlots
                }
                className={`w-full cursor-pointer rounded-xl px-5 py-3.5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${currentAvailability?.available
                  ? "border border-sky-300/40 bg-sky-300/10 text-sky-300 hover:bg-sky-300/20"
                  : "bg-sky-300 text-slate-950 shadow-lg shadow-sky-300/10 hover:bg-sky-200"
                  }`}
              >
                {isChecking ? "Checking..." : "Check availability"}
              </button>

              {/* Result of the check: seating details, or no availability. */}
              {currentAvailability && (
                currentAvailability.available ? (
                  <div
                    role="status"
                    className="flex items-start gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm"
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
                      className="mt-0.5 shrink-0 text-emerald-400"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="m8 12 3 3 5-6" />
                    </svg>

                    <div className="min-w-0">
                      <p className="font-semibold text-emerald-300">
                        Table available for {partySize}{" "}
                        {partySize === 1 ? "guest" : "guests"}
                      </p>
                      <p className="mt-1 break-words text-slate-300">
                        Seating: {seatingLabel}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div
                    role="status"
                    className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm"
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
                      className="mt-0.5 shrink-0 text-amber-400"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v4" />
                      <path d="M12 16h.01" />
                    </svg>

                    <div className="min-w-0">
                      <p className="font-semibold text-amber-300">
                        Not available
                      </p>
                      <p className="mt-1 text-slate-300">
                        There are not enough free seats for {partySize}{" "}
                        {partySize === 1 ? "guest" : "guests"} in this time slot.
                      </p>
                    </div>
                  </div>
                )
              )}

              {/* Party requirements are available only to authenticated hikers
    after a successful availability check. */}
              {loggedIn && currentAvailability?.available && (
                <div>
                  <div className="mb-4 flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-300 font-bold text-slate-950">
                      {firstStep + 3}
                    </span>
                    <h2 className="text-lg font-semibold text-white">
                      Party requirements
                    </h2>
                  </div>

                  <section className="rounded-2xl border border-white/10 bg-[#0e1622]/90 p-5 shadow-xl sm:p-6">
                    {/* List of requirements already added. */}
                    {requirements.length > 0 && (
                      <div className="mb-5 space-y-3">
                        {requirements.map((requirement, index) => (
                          <div
                            key={index}
                            className="rounded-xl border border-white/10 bg-[#090f19] p-4"
                          >
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-white">
                                Requirement {index + 1}
                              </p>

                              <span className="text-xs font-medium text-sky-300">
                                {requirement.peopleCount}{" "}
                                {requirement.peopleCount === 1 ? "person" : "people"}
                              </span>
                            </div>

                            <p className="whitespace-pre-wrap break-words text-sm text-slate-300">
                              {requirement.description}
                            </p>

                            {requirement.isAllergy && (
                              <p className="mt-3 flex items-center gap-2 text-sm text-amber-300">
                                <span aria-hidden="true">⚠</span>
                                Allergy
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Requirement validation error. */}
                    {requirementError && (
                      <div
                        role="alert"
                        className="mb-4 rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-sm text-red-300"
                      >
                        {requirementError}
                      </div>
                    )}

                    {/* Button to open or cancel the requirement form. */}
                    <button
                      type="button"
                      onClick={handleToggleRequirementForm}
                      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-sky-300/40 bg-sky-300/10 px-5 py-3 font-semibold text-sky-300 transition-colors hover:bg-sky-300/20"
                    >
                      {showRequirementForm ? (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                          Cancel
                        </>
                      ) : (
                        "+ Add requirement"
                      )}
                    </button>

                    {/* Form for a new requirement. */}
                    {showRequirementForm && (
                      <div className="mt-5 space-y-4 rounded-xl border border-white/10 bg-[#090f19] p-4">
                        <div>
                          <label
                            htmlFor="requirement-people-count"
                            className="mb-2 block text-sm font-medium text-slate-300"
                          >
                            Number of people
                          </label>

                          <input
                            id="requirement-people-count"
                            type="number"
                            min="1"
                            step="1"
                            value={requirementPeopleCount}
                            onChange={(e) => {
                              setRequirementPeopleCount(e.target.value);
                              setRequirementError(null);
                            }}
                            className="w-full rounded-xl border border-white/15 bg-[#0e1622] px-4 py-3 text-sm text-white outline-none focus:border-sky-300"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="requirement-description"
                            className="mb-2 block text-sm font-medium text-slate-300"
                          >
                            Description
                          </label>

                          <textarea
                            id="requirement-description"
                            rows="3"
                            value={requirementDescription}
                            onChange={(e) => {
                              setRequirementDescription(e.target.value);
                              setRequirementError(null);
                            }}
                            placeholder="e.g. Vegan, peanut allergy"
                            className="w-full resize-y rounded-xl border border-white/15 bg-[#0e1622] px-4 py-3 text-sm text-white outline-none focus:border-sky-300"
                          />
                        </div>

                        <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={requirementIsAllergy}
                            onChange={(e) => setRequirementIsAllergy(e.target.checked)}
                            className="mt-0.5 h-4 w-4 accent-sky-300"
                          />
                          <span>
                            Contains allergies
                          </span>
                        </label>

                        <button
                          type="button"
                          onClick={handleAddRequirement}
                          className="w-full cursor-pointer rounded-xl bg-sky-300 px-5 py-3 font-semibold text-slate-950 transition-colors hover:bg-sky-200"
                        >
                          + Add requirement
                        </button>
                      </div>
                    )}
                  </section>
                </div>
              )}

              {/* Only hikers can reserve: the others are asked to log in first. */}
              {currentAvailability?.available && (
                loggedIn ? (
                  <>
                  {!canReserve && reserveHint && (
                    <p className="text-center text-sm text-amber-300">
                      {reserveHint}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleReserve}
                    disabled={isSubmitting || !canReserve}
                    className="w-full cursor-pointer rounded-xl bg-sky-300 px-5 py-3.5 font-semibold text-slate-950 shadow-lg shadow-sky-300/10 transition-colors hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isSubmitting ? "Reserving..." : "Reserve"}
                  </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      navigate("/login", {
                        state: {
                          from: "/reservations",
                          reservation: { date, slotId: selectedSlotId, partySize, requirements, },
                        },
                      })
                    }
                    className="w-full cursor-pointer rounded-xl bg-sky-300 px-5 py-3.5 font-semibold text-slate-950 shadow-lg shadow-sky-300/10 transition-colors hover:bg-sky-200"
                  >
                    Log in to reserve
                  </button>
                )
              )}
            </div>
          </form>
          </>
        )}
      </div>
    </div>
  );
};