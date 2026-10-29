import { useState, useEffect } from 'react';
import { listAvailableSlots, createReservation } from '../api/reservation_api';
import { useNavigate } from 'react-router';

export const ReservationPage = () => {
  const [date, setDate] = useState('');
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [partySize, setPartySize] = useState(1);

  const [slots, setSlots] = useState([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [reservationDetails, setReservationDetails] = useState(null);

  const navigate = useNavigate();

  useEffect(() => {
    if (!date) return;

    let isCancelled = false;

    const fetchSlots = async () => {
      setIsLoadingSlots(true);
      setFetchError(null);
      setSelectedSlotId('');

      try {
        const data = await listAvailableSlots(date);
        if (!isCancelled) {
          setSlots(data || []);
        }
      } catch (err) {
        if (!isCancelled) {
          setFetchError(err.message || 'Failed to load available slots.');
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

  const selectedSlot = slots.find((s) => String(s.slotId) === String(selectedSlotId));

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    if (timeStr.includes('T')) {
      return new Date(timeStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return timeStr.substring(0, 5);
  };

  const handleDateChange = (e) => {
    const newDate = e.target.value;
    setDate(newDate);

    if (!newDate) {
      setSlots([]);
      setSelectedSlotId('');
      setFetchError(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    if (!date || !selectedSlotId || !partySize) {
      setSubmitError('Please fill in all required fields.');
      return;
    }

    if (selectedSlot && !selectedSlot.bookingAllowed) {
      setSubmitError(selectedSlot.restrictionReason || 'This slot is not available for booking.');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createReservation(selectedSlotId, partySize);
      setReservationDetails(result);
      setIsSubmitted(true);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const todayStr = new Date().toISOString().split('T')[0];

  return (
    /* 1. Contenitore principale con sfumatura scuro-rocciosa ed effeto sfocatura sui punti luce */
    <div className="relative min-h-screen bg-gradient-to-b from-neutral-950 via-neutral-900 to-stone-900 flex items-center justify-center p-4 overflow-hidden text-neutral-100">
      
      {/* Aloni di luce d'ambiente (Glows) */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-red-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-amber-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* 2. Card principale Glassmorphic con bordo sottile ed estetica coerente col Navbar */}
      <div className="relative z-10 w-full max-w-2xl bg-neutral-900/80 backdrop-blur-xl border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden">

        {/* Intestazione scura integrata */}
        <div className="bg-neutral-950/70 border-b border-neutral-800 text-neutral-300 py-3.5 px-6 text-center font-bold tracking-wider uppercase text-xs sm:text-sm flex items-center justify-center gap-2">
          <svg className="w-4 h-4 text-red-500 fill-current" viewBox="0 0 24 24">
            <path d="M14 6l-3.8 5.7 1.4 1.4L14 9.5 19 17H5l4-6 2.1 3.1 1.4-1.4L8 6l-6 9h20L14 6z" />
          </svg>
          Book a Table
        </div>

        <div className="p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center gap-8">

          {/* Dettagli a sinistra */}
          <div className="text-center md:text-left flex-1">
            <h1 className="text-2xl font-bold mb-2 text-white">Mountain Hut Dining</h1>
            <p className="text-sm text-neutral-400 leading-relaxed mb-4">
              Reserve your table for lunch or dinner. Select your preferred date, time slot, and group size.
            </p>

            <div className="bg-neutral-800/60 border border-neutral-700/50 p-3.5 rounded-xl text-xs text-neutral-300 space-y-1.5">
              <p>• <strong className="text-neutral-200">Shared Seating:</strong> Tables are shared with other hikers to optimize space.</p>
              <p>• <strong className="text-neutral-200">Deadline:</strong> Bookings close 2 hours prior to service time.</p>
            </div>
          </div>

          {/* Form o Conferma */}
          <div className="w-full md:w-72 shrink-0">
            {isSubmitted && reservationDetails ? (
              <div className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 p-4 rounded-xl text-center space-y-2">
                <p className="font-bold text-base text-emerald-200">Reservation Confirmed!</p>
                <p className="text-xs opacity-90">
                  Code: <strong className="font-mono text-emerald-100">#{reservationDetails.reservationId}</strong>
                </p>
                <div className="text-xs border-t border-emerald-500/20 pt-2 text-left space-y-1 opacity-90">
                  <p>Party Size: <strong>{reservationDetails.partySize} guests</strong></p>
                  {reservationDetails.tableAllocation?.length > 0 && (
                    <p>Tables: <strong>{reservationDetails.tableAllocation.map(t => `#${t.tableId} (${t.allocatedSeats} seats)`).join(', ')}</strong></p>
                  )}
                </div>
                <button className="btn btn-outline btn-sm text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/20 w-full mt-3" onClick={() => navigate("/")}>
                  Return to homepage
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">

                {(submitError || fetchError) && (
                  <div className="p-2 text-xs bg-red-950/50 border border-red-500/30 text-red-300 rounded-lg">
                    {submitError || fetchError}
                  </div>
                )}

                {/* Date */}
                <div>
                  <label className="block text-xs font-semibold mb-1 text-neutral-300">
                    Date *
                  </label>
                  <input
                    type="date"
                    min={todayStr}
                    value={date}
                    onChange={handleDateChange}
                    className="input input-bordered w-full input-sm bg-neutral-800/80 border-neutral-700 text-white focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                    required
                  />
                </div>

                {/* Time Slot */}
                <div>
                  <label className="block text-xs font-semibold mb-1 text-neutral-300">
                    Time Slot *
                  </label>
                  <select
                    value={selectedSlotId}
                    onChange={(e) => setSelectedSlotId(e.target.value)}
                    disabled={!date || isLoadingSlots}
                    className="select select-bordered w-full select-sm bg-neutral-800/80 border-neutral-700 text-white focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                    required
                  >
                    {!date && <option value="">Select a date first</option>}
                    {date && isLoadingSlots && <option value="">Loading slots...</option>}
                    {date && !isLoadingSlots && slots.length === 0 && (
                      <option value="">No slots available for this date</option>
                    )}
                    {date && !isLoadingSlots && slots.length > 0 && (
                      <>
                        <option value="">Select a time</option>
                        {slots.map((slot) => {
                          const timeRange = `${formatTime(slot.startTime)} - ${formatTime(slot.endTime)}`;
                          const isAllowed = slot.bookingAllowed;
                          const reason = slot.restrictionReason ? ` (${slot.restrictionReason})` : '';

                          return (
                            <option
                              key={slot.slotId}
                              value={slot.slotId}
                              disabled={!isAllowed}
                            >
                              {timeRange} {!isAllowed ? reason : ''}
                            </option>
                          );
                        })}
                      </>
                    )}
                  </select>
                </div>

                {/* Party size */}
                <div>
                  <label className="block text-xs font-semibold mb-1 text-neutral-300">
                    Number of People *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={partySize}
                    onChange={(e) => setPartySize(parseInt(e.target.value, 10) || 1)}
                    className="input input-bordered w-full input-sm bg-neutral-800/80 border-neutral-700 text-white focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={!selectedSlotId || (selectedSlot && !selectedSlot.bookingAllowed) || isSubmitting}
                  className="btn btn-error text-white w-full mt-2 btn-sm disabled:bg-neutral-800 disabled:text-neutral-500 disabled:border-neutral-700"
                >
                  {isSubmitting ? 'Booking...' : 'Check & Reserve'}
                </button>

                <p className="text-[11px] text-center text-neutral-400 mt-2">
                  Need to change an existing booking? <a href="#modify" className="link text-red-400 hover:text-red-300">Modify reservation</a>
                </p>
              </form>
            )}
          </div>

        </div>

      </div>
    </div>
  );
};