import { useState } from "react";
import { BookingFlow } from "../components/BookingFlow";
import { HikerPicker } from "../components/HikerPicker";
import { createReservationForHiker } from "../api/reservation_api";

/**
 * Reservation entered by an employee for a hiker. The hiker is chosen first
 * then booking flow.
 */
export const EmployeeReservationPage = () => {
  // Hiker in the format expected by the backend, or null while it is incomplete.
  const [hiker, setHiker] = useState(null);

  // Changing this key starts a new, empty reservation.
  const [round, setRound] = useState(0);

  const startNewReservation = () => {
    setHiker(null);
    setRound((current) => current + 1);
  };

  return (
    <BookingFlow
      key={round}
      loggedIn
      title="New reservation for a hiker"
      subtitle="Enter a reservation received at the hut, by phone or by message."
      deadlineText="Reservations can be entered until the time slot starts."
      topSection={<HikerPicker onChange={setHiker} />}
      firstStep={2}
      canReserve={hiker !== null}
      reserveHint="Select or enter the hiker first."
      onReserve={({ slotId, partySize, requirements }) =>
        createReservationForHiker(slotId, partySize, requirements, hiker)
      }
      confirmation={{
        message: "The reservation has been created.",
        primaryLabel: "New reservation",
        onPrimary: startNewReservation,
      }}
    />
  );
};
