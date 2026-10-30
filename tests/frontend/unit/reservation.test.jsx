import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { listAvailableSlots, createReservation } from '../../../frontend/src/api/reservation_api';
import { ReservationPage } from '../../../frontend/src/pages/ReservationPage';

// Mock router navigation so buttons like "Return to homepage" do not trigger actual page loads
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}));

const SERVER_URL = 'http://localhost:3001/api';

// Helper to simulate fetch responses with status and JSON payload
function mockResponse({ ok = true, status = 200, body = {}, invalidJson = false } = {}) {
  return {
    ok,
    status,
    json: invalidJson
      ? vi.fn().mockRejectedValue(new SyntaxError('Unexpected token'))
      : vi.fn().mockResolvedValue(body),
  };
}

// MemoryRouter provides the routing context expected by components using router hooks
const renderPage = (element) => render(<MemoryRouter>{element}</MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('reservation_api', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  describe('listAvailableSlots', () => {
    it('returns empty array immediately if date is not provided', async () => {
      // Avoid making an HTTP request if the user hasn't selected a date yet
      const result = await listAvailableSlots('');
      expect(result).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends GET to /slots with encoded date and returns slots', async () => {
      const mockSlots = [
        { slotId: 1, startTime: '12:00', endTime: '13:00', bookingAllowed: true, restrictionReason: null },
      ];
      fetchMock.mockResolvedValue(mockResponse({ status: 200, body: mockSlots }));

      const result = await listAvailableSlots('2026-11-01');

      expect(result).toEqual(mockSlots);
      expect(fetchMock).toHaveBeenCalledWith(`${SERVER_URL}/slots?date=2026-11-01`, {
        credentials: 'include',
      });
    });

    it('throws error when status is 400', async () => {
      fetchMock.mockResolvedValue(
        mockResponse({ ok: false, status: 400, body: { message: 'Invalid date format.' } })
      );

      await expect(listAvailableSlots('bad-date')).rejects.toThrow('Invalid date format.');
    });

    it('throws generic server error when response is not ok', async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 500 }));

      await expect(listAvailableSlots('2026-11-01')).rejects.toThrow(
        'Server error while fetching available slots.'
      );
    });
  });

  describe('createReservation', () => {
    it('sends POST to /reservations and returns reservation details', async () => {
      const reservation = {
        reservationId: 10,
        slotId: 2,
        partySize: 4,
        status: 'confirmed',
        tableAllocation: [{ tableId: 1, allocatedSeats: 4 }],
      };
      fetchMock.mockResolvedValue(mockResponse({ status: 201, body: reservation }));

      const result = await createReservation(2, 4);

      expect(result).toEqual(reservation);
      expect(fetchMock).toHaveBeenCalledWith(`${SERVER_URL}/reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ slotId: 2, partySize: 4 }),
      });
    });

    it('throws unauthorized error on 401', async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 401 }));

      await expect(createReservation(1, 2)).rejects.toThrow('You must be logged in to book a table.');
    });

    it('handles 409 conflict errors with specific messages', async () => {
      // The API client translates specific backend error codes into user-facing alerts
      fetchMock.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 409, body: { error: 'ALREADY_BOOKED' } })
      );
      await expect(createReservation(1, 2)).rejects.toThrow('You already have a reservation for this time slot');

      fetchMock.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 409, body: { error: 'BOOKING_TOO_LATE' } })
      );
      await expect(createReservation(1, 2)).rejects.toThrow('less than 2 hours remaining');

      fetchMock.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 409, body: { error: 'NO_AVAILABILITY' } })
      );
      await expect(createReservation(1, 2)).rejects.toThrow('Not enough seats available');
    });

    it('handles 404 when slot does not exist', async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 404 }));

      await expect(createReservation(99, 2)).rejects.toThrow('Selected time slot was not found.');
    });
  });
});

describe('ReservationPage', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('renders the reservation page title and form elements', () => {
    // Labels do not use htmlFor attributes in the component, so inputs are queried directly by selector
    const { container } = renderPage(<ReservationPage />);

    expect(screen.getByText('Mountain Hut Dining')).toBeInTheDocument();
    expect(container.querySelector('input[type="date"]')).toBeInTheDocument();
    expect(container.querySelector('select')).toBeInTheDocument();
    expect(container.querySelector('input[type="number"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check & Reserve/i })).toBeDisabled();
  });

  it('fetches slots when date is selected and populates slot options', async () => {
    const user = userEvent.setup();
    const mockSlots = [
      { slotId: 1, startTime: '12:00', endTime: '13:00', bookingAllowed: true, restrictionReason: null },
      { slotId: 2, startTime: '13:00', endTime: '14:00', bookingAllowed: false, restrictionReason: 'Less than 2 hours' },
    ];
    fetchMock.mockResolvedValue(mockResponse({ status: 200, body: mockSlots }));

    const { container } = renderPage(<ReservationPage />);

    const dateInput = container.querySelector('input[type="date"]');
    await user.type(dateInput, '2026-11-01');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /12:00 - 13:00/i })).toBeInTheDocument();
    });

    // Slots with bookingAllowed=false should be rendered with disabled attribute
    const restrictedOption = screen.getByRole('option', { name: /13:00 - 14:00 \(Less than 2 hours\)/i });
    expect(restrictedOption).toBeDisabled();
  });

  it('submits reservation and displays confirmation on success', async () => {
    const user = userEvent.setup();
    const mockSlots = [
      { slotId: 1, startTime: '12:00', endTime: '13:00', bookingAllowed: true, restrictionReason: null },
    ];
    const mockReservation = {
      reservationId: 123,
      slotId: 1,
      partySize: 2,
      status: 'confirmed',
      tableAllocation: [{ tableId: 1, allocatedSeats: 2 }],
    };

    fetchMock
      .mockResolvedValueOnce(mockResponse({ status: 200, body: mockSlots }))
      .mockResolvedValueOnce(mockResponse({ status: 201, body: mockReservation }));

    const { container } = renderPage(<ReservationPage />);

    const dateInput = container.querySelector('input[type="date"]');
    await user.type(dateInput, '2026-11-01');

    const slotSelect = await screen.findByRole('combobox');
    await user.selectOptions(slotSelect, '1');

    const submitBtn = screen.getByRole('button', { name: /Check & Reserve/i });
    expect(submitBtn).toBeEnabled();
    await user.click(submitBtn);

    // Verify UI switches from the form to the confirmation view
    expect(await screen.findByText('Reservation Confirmed!')).toBeInTheDocument();
    expect(screen.getByText('#123')).toBeInTheDocument();
    expect(screen.getByText(/2 guests/i)).toBeInTheDocument();
  });
});
