import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const TODAY = new Date(2026, 10, 11, 12, 0, 0);

const capacityAPI = vi.hoisted(() => ({
  getSlots: vi.fn(),
}));

vi.mock('../../../frontend/src/api/capacity_api', () => ({
  default: capacityAPI,
}));

vi.mock('../../../frontend/src/components/Calendar', () => ({
  default: ({ selectedDate, onDateSelect, dateStatuses, minDate }) => (
    <div>
      <button
        type="button"
        aria-label="Choose occupancy date"
        onClick={() => onDateSelect('2026-11-12')}
        data-selected-date={selectedDate}
        data-min-date={minDate}
      />
      <span>{dateStatuses?.['2026-11-11'] ?? 'none'}</span>
    </div>
  ),
}));

import { OccupancyPage } from '../../../frontend/src/pages/OccupancyPage';

function iso(day, hour) {
  const date = new Date(2026, 10, day, hour, 0, 0);
  return date.toISOString();
}

function freeSlot() {
  return {
    slotId: 1,
    startAt: iso(11, 12),
    endAt: iso(11, 13),
    totalSeats: 10,
    bookedSeats: 4,
    remainingSeats: 6,
    occupancyPercentage: 40,
    tables: [
      {
        tableId: 11,
        code: 'T1',
        seats: 6,
        bookedSeats: 2,
        remainingSeats: 4,
        occupancyPercentage: 33,
      },
      {
        tableId: 12,
        code: 'T2',
        seats: 4,
        bookedSeats: 2,
        remainingSeats: 2,
        occupancyPercentage: 50,
      },
    ],
  };
}

function fullSlot() {
  return {
    slotId: 2,
    startAt: iso(11, 18),
    endAt: iso(11, 19),
    totalSeats: 4,
    bookedSeats: 4,
    remainingSeats: 0,
    occupancyPercentage: 100,
    tables: [
      {
        tableId: 21,
        code: 'T3',
        seats: 4,
        bookedSeats: 4,
        remainingSeats: 0,
        occupancyPercentage: 100,
      },
    ],
  };
}

function renderPage(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <OccupancyPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('OccupancyPage', () => {
  it('shows loading state while occupancy is requested', () => {
    capacityAPI.getSlots.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Loading occupancy...')).toBeInTheDocument();
  });

  it('renders free and full slots with total occupancy', async () => {
    capacityAPI.getSlots.mockResolvedValue([freeSlot(), fullSlot()]);

    renderPage();

    expect(await screen.findByText('12:00 – 13:00')).toBeInTheDocument();
    expect(screen.getByText('18:00 – 19:00')).toBeInTheDocument();
    expect(screen.getByText('6 seats free')).toBeInTheDocument();
    expect(screen.getByText('Full')).toBeInTheDocument();
    expect(screen.getByText(/4 \/ 10 seats booked/)).toBeInTheDocument();
    expect(screen.getByText(/4 \/ 4 seats booked/)).toBeInTheDocument();
  });

  it('expands a slot and renders table occupancy details', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    capacityAPI.getSlots.mockResolvedValue([freeSlot()]);

    renderPage();

    await user.click(await screen.findByRole('button', { name: 'View details' }));

    expect(screen.getByRole('heading', { name: 'Tables' })).toBeInTheDocument();
    expect(screen.getByText('T1')).toBeInTheDocument();
    expect(screen.getByText('T2')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Occupancy of table T1' })).toHaveAttribute('aria-valuenow', '33');

    await user.click(screen.getByRole('button', { name: 'Hide details' }));
    expect(screen.queryByRole('heading', { name: 'Tables' })).not.toBeInTheDocument();
  });

  it('renders no-slots state for a date with no occupancy data', async () => {
    capacityAPI.getSlots.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText('No slots for this day')).toBeInTheDocument();
  });

  it('renders a slot without tables as no tables assigned', async () => {
    capacityAPI.getSlots.mockResolvedValue([{
      ...freeSlot(),
      slotId: 3,
      totalSeats: 0,
      bookedSeats: 0,
      remainingSeats: 0,
      occupancyPercentage: 0,
      tables: [],
    }]);

    renderPage();

    expect(await screen.findByText('No tables assigned')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View details' })).not.toBeInTheDocument();
  });

  it('renders API errors', async () => {
    capacityAPI.getSlots.mockRejectedValue(new Error('Unable to retrieve slots'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to retrieve slots');
  });

  it('reloads occupancy when refresh is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    capacityAPI.getSlots
      .mockResolvedValueOnce([freeSlot()])
      .mockResolvedValueOnce([fullSlot()]);

    renderPage();

    await screen.findByText('12:00 – 13:00');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(capacityAPI.getSlots).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('18:00 – 19:00')).toBeInTheDocument();
  });

  it('opens a requested date and slot from location state', async () => {
    capacityAPI.getSlots.mockResolvedValue([freeSlot(), fullSlot()]);

    renderPage({
      pathname: '/occupancy',
      state: { date: '2026-11-11', slotId: 1 },
    });

    expect(await screen.findByRole('button', { name: 'Hide details' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tables' })).toBeInTheDocument();
  });
});
