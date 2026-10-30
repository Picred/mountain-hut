
import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { listAvailableSlots, createReservation } from "../api/reservation_api";
import Calendar from "../components/Calendar";

// Format a local date as YYYY-MM-DD without converting it to UTC.
const dateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Reservation flow for authenticated hikers.
 * Users choose a date, a time slot and a party size, then submit a booking.
 * The backend validates availability and returns the assigned tables.
 */
export const ReservationPage = () => {
  // Booking form selections.
  const [date, setDate] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [partySize, setPartySize] = useState(1);

  // Slot-fetching state, updated whenever the selected date changes.
  const [slots, setSlots] = useState([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  // Reservation submission state and successful booking details.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [reservationDetails, setReservationDetails] = useState(null);

  const navigate = useNavigate();
  const todayStr = dateKey(new Date());

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
  const handleDateSelect = (newDate) => {
    if (newDate < dateKey(new Date())) return;

    setDate(newDate);
    setSelectedSlotId("");
    setSubmitError(null);
  };

  // Submit the selected slot and party size; the backend decides whether
  // enough seats are available and which tables to allocate.
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    if (!date || !selectedSlotId || !partySize) {
      setSubmitError("Please complete all booking details.");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createReservation(
        selectedSlotId,
        partySize
      );

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
              Reserve your table
            </h1>

            <p className="mt-3 text-sm text-slate-400">
              Choose your preferred date, time and number of guests.
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
                  Booking deadline: reservations close 2 hours before service.
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
              Your table reservation has been successfully created.
            </p>

            <div className="mt-6 space-y-3 rounded-xl border border-white/10 bg-[#090f19] p-5 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-400">Reservation code</span>
                <strong className="text-sky-300">
                  #{reservationDetails.reservationId}
                </strong>
              </div>

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
            </div>

            <button
              type="button"
              onClick={() => navigate("/")}
              className="mt-6 w-full cursor-pointer rounded-xl bg-sky-300 px-5 py-3 font-semibold text-slate-950 transition-colors hover:bg-sky-200"
            >
              Return to homepage
            </button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2"
          >
            {/* Left: Calendar */}
            <div>
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-300 font-bold text-slate-950">
                  1
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
                    2
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
                          const isSelected =
                            String(selectedSlotId) ===
                            String(slot.slotId);

                          return (
                            <button
                              type="button"
                              key={slot.slotId}
                              onClick={() => {
                                setSelectedSlotId(
                                  String(slot.slotId)
                                );
                                setSubmitError(null);
                              }}
                              aria-pressed={isSelected}
                              className={`flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${isSelected
                                ? "border-sky-300 bg-sky-300/10 text-sky-200"
                                : "border-white/10 bg-[#090f19] text-slate-200 hover:border-sky-300/40 hover:bg-white/5"
                                }`}
                            >
                              <span className="text-sm font-medium">
                                {formatTime(slot.startTime)}
                                {" – "}
                                {formatTime(slot.endTime)}
                              </span>

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
                    3
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
                        onClick={() =>
                          setPartySize((current) =>
                            Math.max(1, current - 1)
                          )
                        }
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
                        onClick={() =>
                          setPartySize((current) =>
                            current + 1
                          )
                        }
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

              {/* Prevent submission until a date and slot are selected or while loading. */}
              <button
                type="submit"
                disabled={
                  !date ||
                  !selectedSlotId ||
                  isSubmitting ||
                  isLoadingSlots
                }
                className="w-full cursor-pointer rounded-xl bg-sky-300 px-5 py-3.5 font-semibold text-slate-950 shadow-lg shadow-sky-300/10 transition-colors hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSubmitting
                  ? "Checking reservation..."
                  : "Check & Reserve"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
