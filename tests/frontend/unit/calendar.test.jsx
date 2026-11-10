
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Calendar from '../../../frontend/src/components/Calendar';

const TODAY = new Date(2026, 10, 11, 11, 0);
const SELECTED_DATE = '2026-11-11';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Calendar', () => {
  it('displays the selected month and highlights the selected day', () => {
    render(
      <Calendar
        selectedDate={SELECTED_DATE}
        onDateSelect={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SELECTED_DATE })).toHaveAttribute('aria-pressed', 'true');
  });

  it('navigates to the previous and next months', async () => {
    const user = userEvent.setup();

    render(
      <Calendar
        selectedDate={SELECTED_DATE}
        onDateSelect={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
  });

  it('calls onDateSelect when an available day is clicked', async () => {
    const user = userEvent.setup();
    const onDateSelect = vi.fn();

    render(
      <Calendar
        selectedDate={SELECTED_DATE}
        onDateSelect={onDateSelect}
      />
    );

    await user.click(screen.getByRole('button', { name: '2026-11-15' }));

    expect(onDateSelect).toHaveBeenCalledWith('2026-11-15');
    expect(onDateSelect).toHaveBeenCalledTimes(1);
  });

  it('disables dates before minDate', async () => {
    const user = userEvent.setup();
    const onDateSelect = vi.fn();

    render(
      <Calendar
        selectedDate={SELECTED_DATE}
        minDate="2026-11-11"
        onDateSelect={onDateSelect}
      />
    );

    const pastDay = screen.getByRole('button', { name: '2026-11-10' });
    const availableDay = screen.getByRole('button', { name: '2026-11-12' });

    expect(pastDay).toBeDisabled();
    expect(availableDay).toBeEnabled();

    await user.click(availableDay);
    expect(onDateSelect).toHaveBeenCalledWith('2026-11-12');
  });

  it('returns to the current month and selects today', async () => {
    const user = userEvent.setup();
    const onDateSelect = vi.fn();

    render(
      <Calendar
        selectedDate="2026-09-15"
        onDateSelect={onDateSelect}
      />
    );

    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go to today' }));

    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    expect(onDateSelect).toHaveBeenCalledWith(SELECTED_DATE);
  });

  it('shows success and warning statuses for dates', () => {
    render(
      <Calendar
        selectedDate={SELECTED_DATE}
        onDateSelect={vi.fn()}
        dateStatuses={{
          '2026-11-12': 'success',
          '2026-11-13': 'warning',
        }}
      />
    );

    expect(screen.getByRole('button', { name: '2026-11-12, success' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2026-11-13, warning' })).toBeInTheDocument();
  });

  it('displays the optional status legend', () => {
    render(
      <Calendar
        selectedDate={SELECTED_DATE}
        onDateSelect={vi.fn()}
        statusLegend={[
          { status: 'success', label: 'Available' },
          { status: 'warning', label: 'Limited availability' },
        ]}
      />
    );

    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('Limited availability')).toBeInTheDocument();
  });
});
