import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { EmployeeReservationPage } from '../../../frontend/src/pages/EmployeeReservationPage';

import {
  listAvailableSlots, createReservation, createReservationForHiker,
  searchHikers,
} from '../../../frontend/src/api/reservation_api';
import { ReservationPage } from '../../../frontend/src/pages/ReservationPage';



vi.mock('../../../frontend/src/components/HikerPicker', () => ({
  HikerPicker: ({ onChange }) => (
    <button onClick={() => onChange({ userId: 42 })}>
      Select hiker
    </button>
  ),
}));

vi.mock('../../../frontend/src/components/BookingFlow', async (importOriginal) => {
  const actual = await importOriginal();
  const React = await import('react');

  return {
    ...actual,

    BookingFlow: (props) => {
      // Per ReservationPage manteniamo il BookingFlow reale.
      if (props.title !== 'New reservation for a hiker') {
        return React.createElement(actual.BookingFlow, props);
      }

      const [confirmed, setConfirmed] = React.useState(false);

      if (confirmed) {
        return React.createElement(
          'div',
          null,
          React.createElement(
            'p',
            null,
            'The reservation has been created.'
          ),
          React.createElement(
            'button',
            { onClick: props.confirmation.onPrimary },
            'New reservation'
          )
        );
      }

      return React.createElement(
        'div',
        null,
        props.topSection,
        React.createElement(
          'button',
          {
            disabled: !props.canReserve,
            onClick: async () => {
              await props.onReserve({
                slotId: 10,
                partySize: 2,
                requirements: ['wheelchair'],
              });

              setConfirmed(true);
            },
          },
          'Reserve'
        )
      );
    },
  };
});

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
        { slotId: 1, startTime: '12:00', endTime: '13:00', availableSeats: 4, bookingAllowed: true, restrictionReason: null },
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
        body: JSON.stringify({ slotId: 2, partySize: 4, requirements: [] }),
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
    expect(screen.getByRole('button', { name: 'Check availability' })).toBeDisabled();
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
      { slotId: 1, startTime: '12:00', endTime: '13:00', availableSeats: 4, bookingAllowed: true },
    ];
    fetchMock.mockResolvedValue(mockResponse({ status: 200, body: mockSlots }));

    renderPage(<ReservationPage loggedIn={true} />);

    await user.click(screen.getByRole('button', { name: todayKey() }));

    expect(await screen.findByRole('button', { name: /12:00.*13:00/ })).toBeInTheDocument();
  });

  it('submits reservation and displays confirmation on success', async () => {
    const user = userEvent.setup();
    const mockSlots = [
      { slotId: 1, startTime: '12:00', endTime: '13:00', availableSeats: 4, bookingAllowed: true },
    ];
    const mockReservation = {
      reservationId: 123,
      slotId: 1,
      partySize: 2,
      status: 'confirmed',
      tableAllocation: [{ tableId: 1, tableCode: 'A1', allocatedSeats: 2 }],
    };

    const mockAvailability = {
      slotId: 1,
      partySize: 2,
      available: true,
      tableAllocation: [
        { tableId: 1, tableCode: 'A1', allocatedSeats: 2 },
      ],
    };

    fetchMock
      .mockResolvedValueOnce(mockResponse({ status: 200, body: mockSlots }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: mockAvailability }))
      .mockResolvedValueOnce(mockResponse({ status: 201, body: mockReservation }));

    renderPage(<ReservationPage loggedIn={true} />);

    await user.click(screen.getByRole('button', { name: todayKey() }));
    await user.click(await screen.findByRole('button', { name: /12:00.*13:00/ }));
    await user.click(screen.getByRole('button', { name: 'Add one guest' }));
    await user.click(screen.getByRole('button', { name: 'Check availability' }));

    expect(
      await screen.findByText('Table available for 2 guests')
    ).toBeInTheDocument();

    await user.click(
      await screen.findByRole('button', { name: 'Reserve' })
    );

    expect(await screen.findByRole('heading', { name: 'Reservation confirmed!' })).toBeInTheDocument();
    expect(screen.getByText('#123')).toBeInTheDocument();
    expect(screen.getByText('A1 (2 seats)')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(`${SERVER_URL}/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ slotId: 1, partySize: 2, requirements: [] }),
    });
  });
});

describe('employee reservation_api', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('creates a reservation for an existing hiker', async () => {
    const hiker = { userId: 42 };

    fetchMock.mockResolvedValue(
      mockResponse({ body: { reservationId: 123 } })
    );

    const result = await createReservationForHiker(
      10,
      2,
      ['wheelchair'],
      hiker
    );

    expect(result).toEqual({ reservationId: 123 });

    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER_URL}/reservations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          slotId: 10,
          partySize: 2,
          requirements: ['wheelchair'],
          hiker,
        }),
      }
    );
  });

  it('creates a reservation for a new hiker', async () => {
    const hiker = {
      name: 'Mario Rossi',
      email: 'mario@example.com',
      phone: '3331234567',
      password: 'password123',
    };

    fetchMock.mockResolvedValue(
      mockResponse({ body: { reservationId: 124 } })
    );

    await createReservationForHiker(10, 2, [], hiker);

    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER_URL}/reservations`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          slotId: 10,
          partySize: 2,
          requirements: [],
          hiker,
        }),
      })
    );
  });

  it('throws an error when the hiker is not found', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 404,
        body: { error: 'HIKER_NOT_FOUND' },
      })
    );

    await expect(
      createReservationForHiker(10, 2, [], { userId: 999 })
    ).rejects.toThrow('The selected hiker could not be found.');
  });

  it('throws an employee-specific error when the hiker is already booked', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 409,
        body: { error: 'ALREADY_BOOKED' },
      })
    );

    await expect(
      createReservationForHiker(10, 2, [], { userId: 42 })
    ).rejects.toThrow(
      'This hiker already has a reservation for this time slot.'
    );
  });

  it('throws an employee-specific error when booking is too late', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 409,
        body: { error: 'BOOKING_TOO_LATE' },
      })
    );

    await expect(
      createReservationForHiker(10, 2, [], { userId: 42 })
    ).rejects.toThrow('This time slot has already started.');
  });

  it('searches hikers', async () => {
    const hikers = [
      {
        userId: 42,
        name: 'Mario Rossi',
        email: 'mario@example.com',
        phone: '3331234567',
      },
    ];

    fetchMock.mockResolvedValue(
      mockResponse({ body: hikers })
    );

    const result = await searchHikers('Mario');

    expect(result).toEqual(hikers);

    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER_URL}/hikers?search=Mario`,
      { credentials: 'include' }
    );
  });

  it('rejects hiker search for non-employees', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 403,
        body: {},
      })
    );

    await expect(searchHikers('Mario')).rejects.toThrow(
      'Only employees can search hikers.'
    );
  });
});
describe('EmployeeReservationPage', () => {
  let createReservationSpy;

  beforeEach( async () => {
    vi.clearAllMocks();

    createReservationSpy = vi
      .spyOn(
        await import('../../../frontend/src/api/reservation_api'),
        'createReservationForHiker'
      )
      .mockResolvedValue({
        reservationId: 123,
      });
  });

  it('creates a reservation for the selected hiker', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <EmployeeReservationPage />
      </MemoryRouter>
    );

    await user.click(
      screen.getByRole('button', { name: 'Select hiker' })
    );

    await user.click(
      screen.getByRole('button', { name: 'Reserve' })
    );

    expect(createReservationSpy).toHaveBeenCalledOnce();

    expect(createReservationSpy).toHaveBeenCalledWith(
      10,
      2,
      ['wheelchair'],
      { userId: 42 }
    );
  });
});