import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { App } from '../../../frontend/src/App';

// The real app is rendered (App, routes, ReservationPage, Calendar, reservation_api): only the network is fake
const SERVER_URL = 'http://localhost:3001';
const ANNA = { user_id: 3, name: 'Anna Winden', email: 'anna@mountainhut.test', phone: '+393401234567', role: 'hiker' };

// Only Date is faked, so the calendar always opens on November 2026; timers stay real
// It is 11:00: lunch at 12:00 is less than 2 hours away, dinner at 19:00 can still be booked
const TODAY = new Date(2026, 10, 11, 11, 0);
const DATE = '2026-11-11';
const at = (hour) => new Date(2026, 10, 11, hour, 0).toISOString();
const SLOTS = [
  { slotId: 1, startTime: at(12), endTime: at(14), bookingAllowed: false, restrictionReason: 'Less than 2 hours' },
  { slotId: 2, startTime: at(19), endTime: at(21), bookingAllowed: true, restrictionReason: null },
];

let server;

// Fake backend: answers each "METHOD /path" with the configured { status, body }
function mockServer(routes) {
  server = vi.fn(async (url, { method = 'GET' } = {}) => {
    const path = url.replace(SERVER_URL, '').split('?')[0];
    const { status = 200, body } = routes[`${method} ${path}`] ?? { status: 404 };
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', server);
}

const lastCall = (method, path) => server.mock.calls.findLast(([url, opts = {}]) =>
  url.startsWith(`${SERVER_URL}${path}`) && (opts.method ?? 'GET') === method);

// Logged user on the reservation page, with the slots of DATE already loaded
async function openSlotsOfDate(user, reservationResponse) {
  mockServer({
    'GET /api/sessions/current': { body: ANNA },
    'GET /api/slots': { body: SLOTS },
    'POST /api/reservations': reservationResponse,
  });
  render(<MemoryRouter initialEntries={['/reservations']}><App /></MemoryRouter>);

  await user.click(await screen.findByRole('button', { name: DATE }));
  await screen.findByRole('button', { name: '19:00 – 21:00' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Reservation flow', () => {
  it('books the chosen slot for the chosen party and shows the assigned tables', async () => {
    const user = userEvent.setup();
    await openSlotsOfDate(user, {
      status: 201,
      body: {
        reservationId: 9,
        slotId: 2,
        partySize: 6,
        status: 'confirmed',
        tableAllocation: [
          { tableId: 2, tableCode: 'T2', allocatedSeats: 4 },
          { tableId: 5, tableCode: 'T5', allocatedSeats: 2 },
        ],
      },
    });
    const submit = screen.getByRole('button', { name: 'Check & Reserve' });

    expect(lastCall('GET', '/api/slots')[0]).toBe(`${SERVER_URL}/api/slots?date=${DATE}`);
    expect(screen.getByRole('button', { name: /12:00 – 14:00/ })).toBeDisabled(); // less than 2 hours left
    expect(submit).toBeDisabled(); // the time slot is still missing

    await user.click(screen.getByRole('button', { name: '19:00 – 21:00' }));
    for (let i = 0; i < 5; i++) await user.click(screen.getByRole('button', { name: 'Add one guest' }));
    await user.click(submit);

    expect(JSON.parse(lastCall('POST', '/api/reservations')[1].body)).toEqual({ slotId: 2, partySize: 6 });
    expect(await screen.findByRole('heading', { name: 'Reservation confirmed!' })).toBeInTheDocument();
    expect(screen.getByText('#9')).toBeInTheDocument();
    expect(screen.getByText('T2 (4 seats), T5 (2 seats)')).toBeInTheDocument();
  });

  it('shows the reason and keeps the form when the server refuses the booking', async () => {
    const user = userEvent.setup();
    await openSlotsOfDate(user, { status: 409, body: { error: 'NO_AVAILABILITY' } });

    await user.click(screen.getByRole('button', { name: '19:00 – 21:00' }));
    await user.click(screen.getByRole('button', { name: 'Check & Reserve' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough seats available for this party size.');
    expect(screen.queryByRole('heading', { name: 'Reservation confirmed!' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check & Reserve' })).toBeEnabled();
  });
});
