import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

function todayKey() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

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
        tableAllocation: [{ tableId: 1, tableCode: 'A1', allocatedSeats: 4 }],
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

  it('shows the reservation form with the reserve button disabled', () => {
    renderPage(<ReservationPage />);

    expect(screen.getByRole('heading', { name: 'Reserve your table' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Select a date' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Select a time slot' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check & Reserve' })).toBeDisabled();
  });

  it('does not let the guest count go below one', async () => {
    const user = userEvent.setup();
    renderPage(<ReservationPage />);

    const removeGuest = screen.getByRole('button', { name: 'Remove one guest' });
    expect(removeGuest).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Add one guest' }));
    expect(removeGuest).toBeEnabled();

    await user.click(removeGuest);
    expect(removeGuest).toBeDisabled();
  });

  it('loads slots when a date is selected', async () => {
    const user = userEvent.setup();
    const mockSlots = [
      { slotId: 1, startTime: '12:00', endTime: '13:00', bookingAllowed: true },
    ];
    fetchMock.mockResolvedValue(mockResponse({ status: 200, body: mockSlots }));

    renderPage(<ReservationPage />);

    await user.click(screen.getByRole('button', { name: todayKey() }));

    expect(await screen.findByRole('button', { name: /12:00.*13:00/ })).toBeInTheDocument();
  });

  it('submits reservation and displays confirmation on success', async () => {
    const user = userEvent.setup();
    const mockSlots = [
      { slotId: 1, startTime: '12:00', endTime: '13:00', bookingAllowed: true },
    ];
    const mockReservation = {
      reservationId: 123,
      slotId: 1,
      partySize: 2,
      status: 'confirmed',
      tableAllocation: [{ tableId: 1, tableCode: 'A1', allocatedSeats: 2 }],
    };

    fetchMock
      .mockResolvedValueOnce(mockResponse({ status: 200, body: mockSlots }))
      .mockResolvedValueOnce(mockResponse({ status: 201, body: mockReservation }));

    renderPage(<ReservationPage />);

    await user.click(screen.getByRole('button', { name: todayKey() }));
    await user.click(await screen.findByRole('button', { name: /12:00.*13:00/ }));
    await user.click(screen.getByRole('button', { name: 'Add one guest' }));
    await user.click(screen.getByRole('button', { name: 'Check & Reserve' }));

    expect(await screen.findByRole('heading', { name: 'Reservation confirmed!' })).toBeInTheDocument();
    expect(screen.getByText('#123')).toBeInTheDocument();
    expect(screen.getByText('A1 (2 seats)')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(`${SERVER_URL}/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ slotId: 1, partySize: 2 }),
    });
  });
});
