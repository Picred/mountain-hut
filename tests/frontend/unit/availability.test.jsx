
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { checkAvailability } from '../../../frontend/src/api/reservation_api';
import { ReservationPage } from '../../../frontend/src/pages/ReservationPage';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}));

const SERVER_URL = 'http://localhost:3001/api';

function mockResponse({
  ok = true,
  status = 200,
  body = {},
  invalidJson = false,
} = {}) {
  return {
    ok,
    status,
    json: invalidJson
      ? vi.fn().mockRejectedValue(new SyntaxError('Invalid JSON'))
      : vi.fn().mockResolvedValue(body),
  };
}

function deferred() {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function todayKey() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const AVAILABLE_SLOT = {
  slotId: 1,
  startTime: '12:00',
  endTime: '13:00',
  availableSeats: 4,
  bookingAllowed: true,
  restrictionReason: null,
};

function availabilityResult({
  slotId = 1,
  partySize = 2,
  available = true,
  tableAllocation = [
    { tableId: 1, tableCode: 'T1', allocatedSeats: 2 },
  ],
} = {}) {
  return { slotId, partySize, available, tableAllocation };
}

function renderPage({
  loggedIn = false,
  initialEntries = ['/reservations'],
} = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ReservationPage loggedIn={loggedIn} />
    </MemoryRouter>
  );
}

async function selectSlot(user, slot = AVAILABLE_SLOT) {
  await user.click(screen.getByRole('button', { name: todayKey() }));
  await user.click(
    await screen.findByRole('button', {
      name: new RegExp(`${slot.startTime}.*${slot.endTime}`),
    })
  );
}

let fetchMock;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('checkAvailability API', () => {
  it('sends a GET request and returns availability details', async () => {
    const availability = availabilityResult({
      partySize: 3,
      tableAllocation: [
        { tableId: 2, tableCode: 'T2', allocatedSeats: 3 },
      ],
    });

    fetchMock.mockResolvedValue(mockResponse({ body: availability }));

    const result = await checkAvailability(1, 3);

    expect(result).toEqual(availability);
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER_URL}/slots/1/availability?partySize=3`,
      { credentials: 'include' }
    );
  });

  it('converts slot ID and party size to numbers', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ body: availabilityResult() })
    );

    await checkAvailability('5', '4');

    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER_URL}/slots/5/availability?partySize=4`,
      { credentials: 'include' }
    );
  });

  it('returns an unavailable result without throwing an error', async () => {
    const unavailable = availabilityResult({
      partySize: 10,
      available: false,
      tableAllocation: [],
    });

    fetchMock.mockResolvedValue(mockResponse({ body: unavailable }));

    await expect(checkAvailability(1, 10)).resolves.toEqual(unavailable);
  });

  it('returns allocation across multiple tables', async () => {
    const availability = availabilityResult({
      partySize: 6,
      tableAllocation: [
        { tableId: 1, tableCode: 'T1', allocatedSeats: 4 },
        { tableId: 2, tableCode: 'T2', allocatedSeats: 2 },
      ],
    });

    fetchMock.mockResolvedValue(mockResponse({ body: availability }));

    await expect(checkAvailability(1, 6)).resolves.toEqual(availability);
  });

  it('throws a specific error when the slot does not exist (404)', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ ok: false, status: 404 })
    );

    await expect(checkAvailability(99, 2)).rejects.toThrow(
      'Selected time slot was not found.'
    );
  });

  it('throws a specific error for invalid input (400)', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ ok: false, status: 400 })
    );

    await expect(checkAvailability(1, 0)).rejects.toThrow(
      'Invalid availability request.'
    );
  });

  it('throws a generic error for server failures', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ ok: false, status: 500 })
    );

    await expect(checkAvailability(1, 2)).rejects.toThrow(
      'Server error while checking availability.'
    );
  });

  it('handles an invalid JSON body in an error response', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ ok: false, status: 500, invalidJson: true })
    );

    await expect(checkAvailability(1, 2)).rejects.toThrow(
      'Server error while checking availability.'
    );
  });

  it('propagates network errors', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));

    await expect(checkAvailability(1, 2)).rejects.toThrow('Network error');
  });
});

describe('ReservationPage - US4 availability', () => {
  it('shows the availability form to unauthenticated visitors', () => {
    renderPage({ loggedIn: false });

    expect(
      screen.getByRole('heading', { name: 'Reserve your table' })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: 'Check availability' })
    ).toBeDisabled();

    expect(
      screen.queryByRole('button', { name: 'Reserve' })
    ).not.toBeInTheDocument();
  });

  it('loads available slots after selecting a date', async () => {
    const user = userEvent.setup();

    fetchMock.mockResolvedValue(
      mockResponse({ body: [AVAILABLE_SLOT] })
    );

    renderPage();

    await user.click(screen.getByRole('button', { name: todayKey() }));

    expect(
      await screen.findByRole('button', { name: /12:00.*13:00/ })
    ).toBeInTheDocument();
    expect(screen.getByText('4 seats available')).toHaveClass('text-emerald-300');

    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER_URL}/slots?date=${todayKey()}`,
      { credentials: 'include' }
    );
  });

  it('shows zero available seats in red', async () => {
    const user = userEvent.setup();
    const fullSlot = { ...AVAILABLE_SLOT, availableSeats: 0 };

    fetchMock.mockResolvedValue(mockResponse({ body: [fullSlot] }));
    renderPage();

    await user.click(screen.getByRole('button', { name: todayKey() }));

    expect(await screen.findByText('0 seats available')).toHaveClass('text-red-300');
  });

  it('allows a guest to check availability without logging in', async () => {
    const user = userEvent.setup();

    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: [AVAILABLE_SLOT] }))
      .mockResolvedValueOnce(
        mockResponse({ body: availabilityResult({ partySize: 1 }) })
      );

    renderPage({ loggedIn: false });

    await selectSlot(user);
    await user.click(
      screen.getByRole('button', { name: 'Check availability' })
    );

    expect(
      await screen.findByText('Table available for 1 guest')
    ).toBeInTheDocument();

    expect(fetchMock).toHaveBeenLastCalledWith(
      `${SERVER_URL}/slots/1/availability?partySize=1`,
      { credentials: 'include' }
    );

    expect(
      screen.getByRole('button', { name: 'Log in to reserve' })
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('button', { name: 'Reserve' })
    ).not.toBeInTheDocument();
  });

  it('displays seating across multiple tables', async () => {
    const user = userEvent.setup();

    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: [AVAILABLE_SLOT] }))
      .mockResolvedValueOnce(
        mockResponse({
          body: availabilityResult({
            partySize: 2,
            tableAllocation: [
              { tableId: 1, tableCode: 'T1', allocatedSeats: 1 },
              { tableId: 2, tableCode: 'T2', allocatedSeats: 1 },
            ],
          }),
        })
      );

    renderPage();

    await selectSlot(user);
    await user.click(screen.getByRole('button', { name: 'Add one guest' }));
    await user.click(
      screen.getByRole('button', { name: 'Check availability' })
    );

    expect(
      await screen.findByText('Table available for 2 guests')
    ).toBeInTheDocument();

    expect(
      screen.getByText(/T1 \(1 seat\) \+ T2 \(1 seat\)/)
    ).toBeInTheDocument();
  });

  it('shows a warning when there are not enough free seats', async () => {
    const user = userEvent.setup();

    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: [AVAILABLE_SLOT] }))
      .mockResolvedValueOnce(
        mockResponse({
          body: availabilityResult({
            partySize: 1,
            available: false,
            tableAllocation: [],
          }),
        })
      );

    renderPage();

    await selectSlot(user);
    await user.click(
      screen.getByRole('button', { name: 'Check availability' })
    );

    expect(
      await screen.findByText('Not available')
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('button', { name: 'Log in to reserve' })
    ).not.toBeInTheDocument();
  });

  it('shows a loading state while checking availability', async () => {
    const user = userEvent.setup();
    const pending = deferred();

    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: [AVAILABLE_SLOT] }))
      .mockReturnValueOnce(pending.promise);

    renderPage();

    await selectSlot(user);
    await user.click(
      screen.getByRole('button', { name: 'Check availability' })
    );

    expect(
      screen.getByRole('button', { name: 'Checking...' })
    ).toBeDisabled();

    pending.resolve(
      mockResponse({ body: availabilityResult({ partySize: 1 }) })
    );

    expect(
      await screen.findByText('Table available for 1 guest')
    ).toBeInTheDocument();
  });

  it('shows an error when the availability request fails', async () => {
    const user = userEvent.setup();

    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: [AVAILABLE_SLOT] }))
      .mockResolvedValueOnce(
        mockResponse({ ok: false, status: 500 })
      );

    renderPage();

    await selectSlot(user);
    await user.click(
      screen.getByRole('button', { name: 'Check availability' })
    );

    expect(
      await screen.findByText(
        'Server error while checking availability.'
      )
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('button', { name: 'Log in to reserve' })
    ).not.toBeInTheDocument();
  });

  it('hides an old availability result when the party size changes', async () => {
    const user = userEvent.setup();

    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: [AVAILABLE_SLOT] }))
      .mockResolvedValueOnce(
        mockResponse({ body: availabilityResult({ partySize: 1 }) })
      );

    renderPage();

    await selectSlot(user);
    await user.click(
      screen.getByRole('button', { name: 'Check availability' })
    );

    expect(
      await screen.findByText('Table available for 1 guest')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add one guest' }));

    expect(
      screen.queryByText('Table available for 1 guest')
    ).not.toBeInTheDocument();

    expect(
      screen.queryByRole('button', { name: 'Log in to reserve' })
    ).not.toBeInTheDocument();
  });

  it('hides an old availability result when the selected slot changes', async () => {
    const user = userEvent.setup();

    const secondSlot = {
      slotId: 2,
      startTime: '13:00',
      endTime: '14:00',
      bookingAllowed: true,
      restrictionReason: null,
    };

    fetchMock
      .mockResolvedValueOnce(
        mockResponse({ body: [AVAILABLE_SLOT, secondSlot] })
      )
      .mockResolvedValueOnce(
        mockResponse({ body: availabilityResult({ partySize: 1 }) })
      );

    renderPage();

    await selectSlot(user);
    await user.click(
      screen.getByRole('button', { name: 'Check availability' })
    );

    expect(
      await screen.findByText('Table available for 1 guest')
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /13:00.*14:00/ })
    );

    expect(
      screen.queryByText('Table available for 1 guest')
    ).not.toBeInTheDocument();
  });

  it('shows the Reserve button to logged-in users after a successful check', async () => {
    const user = userEvent.setup();

    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: [AVAILABLE_SLOT] }))
      .mockResolvedValueOnce(
        mockResponse({ body: availabilityResult({ partySize: 1 }) })
      );

    renderPage({ loggedIn: true });

    await selectSlot(user);
    await user.click(
      screen.getByRole('button', { name: 'Check availability' })
    );

    expect(
      await screen.findByRole('button', { name: 'Reserve' })
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('button', { name: 'Log in to reserve' })
    ).not.toBeInTheDocument();
  });

  it('redirects guests to login while preserving their selection', async () => {
    const user = userEvent.setup();

    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: [AVAILABLE_SLOT] }))
      .mockResolvedValueOnce(
        mockResponse({ body: availabilityResult({ partySize: 1 }) })
      );

    renderPage({ loggedIn: false });

    await selectSlot(user);
    await user.click(
      screen.getByRole('button', { name: 'Check availability' })
    );

    await user.click(
      await screen.findByRole('button', { name: 'Log in to reserve' })
    );

    expect(navigate).toHaveBeenCalledWith('/login', {
      state: {
        from: '/reservations',
        reservation: {
          date: todayKey(),
          slotId: '1',
          partySize: 1,
          requirements: []
        },
      },
    });
  });

  it('restores the saved selection after login', async () => {
    const savedDate = todayKey();

    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: [AVAILABLE_SLOT] }))
      .mockResolvedValueOnce(
        mockResponse({ body: availabilityResult({ partySize: 2 }) })
      );

    renderPage({
      loggedIn: true,
      initialEntries: [
        {
          pathname: '/reservations',
          state: {
            reservation: {
              date: savedDate,
              slotId: '1',
              partySize: 2,
            },
          },
        },
      ],
    });

    expect(
      await screen.findByText('Table available for 2 guests')
    ).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER_URL}/slots/1/availability?partySize=2`,
      { credentials: 'include' }
    );

    expect(
      screen.getByRole('button', { name: 'Reserve' })
    ).toBeInTheDocument();
  });

  it('shows an error when loading slots fails', async () => {
    const user = userEvent.setup();

    fetchMock.mockResolvedValue(
      mockResponse({ ok: false, status: 500 })
    );

    renderPage();

    await user.click(screen.getByRole('button', { name: todayKey() }));

    expect(
      await screen.findByText(
        'Server error while fetching available slots.'
      )
    ).toBeInTheDocument();
  });
});
