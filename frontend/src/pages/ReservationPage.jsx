import { useNavigate } from "react-router";
import { BookingFlow } from "../components/BookingFlow";
import { createReservation } from "../api/reservation_api";

/**
 * Availability check and reservation for visitors and hikers.
 * Anyone can check the availability, only logged-in hikers can reserve.
 */
export const ReservationPage = ({ loggedIn }) => {
  const navigate = useNavigate();

  return (
    <BookingFlow
      loggedIn={loggedIn}
      title="Reserve your table"
      subtitle="Choose your preferred date, time and number of guests, then check availability."
      deadlineText="Booking deadline: reservations close 2 hours before service."
      onReserve={({ slotId, partySize, requirements }) =>
        createReservation(slotId, partySize, requirements)
      }
      confirmation={{
        message: "Your table reservation has been successfully created.",
        primaryLabel: "Return to homepage",
        onPrimary: () => navigate("/"),
      }}
    />
  );
};
