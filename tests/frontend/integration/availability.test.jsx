import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { App } from '../../../frontend/src/App';

// The real app is rendered (App, routes, ReservationPage, Calendar, reservation_api): only the network is fake
const SERVER_URL = 'http://localhost:3001';

// Only Date is faked, so the calendar always opens on November 2026; timers stay real
const TODAY = new Date(2026, 10, 11, 11, 0);
const DATE = '2026-11-11';
const SLOTS = [{ slotId: 2, startTime: '19:00', endTime: '21:00', bookingAllowed: true, restrictionReason: null }];

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

// A visitor (not logged in) checks the dinner slot of DATE for the given party
async function checkAsVisitor(user, partySize, availability) {
  mockServer({
    'GET /api/sessions/current': { status: 401 },
    'GET /api/slots': { body: SLOTS },
    'GET /api/slots/2/availability': { body: availability },
  });
  render(<MemoryRouter initialEntries={['/reservations']}><App /></MemoryRouter>);

  await user.click(await screen.findByRole('button', { name: DATE }));
  await user.click(await screen.findByRole('button', { name: '19:00 – 21:00' }));
  for (let i = 1; i < partySize; i++) await user.click(screen.getByRole('button', { name: 'Add one guest' }));
  await user.click(screen.getByRole('button', { name: 'Check availability' }));
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

describe('Availability check', () => {
  it('lets a visitor check a slot and shows how the party would be seated', async () => {
    const user = userEvent.setup();

    await checkAsVisitor(user, 6, {
      slotId: 2,
      partySize: 6,
      available: true,
      tableAllocation: [
        { tableId: 4, tableCode: 'T4', allocatedSeats: 2 },
        { tableId: 5, tableCode: 'T5', allocatedSeats: 3 },
        { tableId: 6, tableCode: 'T6', allocatedSeats: 1 },
      ],
    });

    expect(await screen.findByText('Table available for 6 guests')).toBeInTheDocument();
    expect(screen.getByText('Seating: T4 (2 seats) + T5 (3 seats) + T6 (1 seat)')).toBeInTheDocument();
    expect(server.mock.calls.at(-1)[0]).toBe(`${SERVER_URL}/api/slots/2/availability?partySize=6`);
    // Only hikers can book: the visitor is asked to log in first
    expect(screen.getByRole('button', { name: 'Log in to reserve' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reserve' })).not.toBeInTheDocument();
  });

  it('tells the visitor when the party does not fit, without offering to reserve', async () => {
    const user = userEvent.setup();

    await checkAsVisitor(user, 2, { slotId: 2, partySize: 2, available: false, tableAllocation: [] });

    expect(await screen.findByText('Not available')).toBeInTheDocument();
    expect(screen.getByText('There are not enough free seats for 2 guests in this time slot.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log in to reserve' })).not.toBeInTheDocument();
  });
});
