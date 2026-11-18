import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mealAPI = vi.hoisted(() => ({
  getMealsByDate: vi.fn(),
}));

vi.mock('../../../frontend/src/api/meal_api', () => ({
  default: mealAPI,
  getMealsByDate: mealAPI.getMealsByDate,
}));

vi.mock('../../../frontend/src/components/Calendar', () => ({
  default: ({ selectedDate, onDateSelect, minDate }) => (
    <button
      type="button"
      aria-label="Choose test date"
      data-selected-date={selectedDate}
      data-min-date={minDate}
      onClick={() => onDateSelect('2028-06-01')}
    />
  ),
}));

import { MealsPage } from '../../../frontend/src/pages/MealsPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <MealsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('MealsPage', () => {
  it('shows a loading state while meal details are requested', () => {
    mealAPI.getMealsByDate.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Loading meals...')).toBeInTheDocument();
  });

  it('renders meal times and published Markdown menus', async () => {
    mealAPI.getMealsByDate.mockResolvedValue([
      {
        slotId: 12,
        date: '2028-06-01',
        startTime: '11:00',
        endTime: '12:00',
        menu: '**Lunch**\n- Polenta',
      },
      {
        slotId: 13,
        date: '2028-06-01',
        startTime: '18:00',
        endTime: '19:00',
        menu: '**Dinner**',
      },
    ]);

    renderPage();

    expect(await screen.findByText('11:00 – 12:00')).toBeInTheDocument();
    expect(screen.getByText('18:00 – 19:00')).toBeInTheDocument();
    expect(screen.getByText('Lunch').tagName).toBe('STRONG');
    expect(screen.getByText('Polenta')).toBeInTheDocument();
    expect(screen.getByText('Dinner').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'Reserve a table' })).toHaveAttribute(
      'href',
      '/reservations'
    );
  });

  it('renders a notice when a meal exists but its menu is not published', async () => {
    mealAPI.getMealsByDate.mockResolvedValue([
      {
        slotId: 12,
        date: '2028-06-01',
        startTime: '11:00',
        endTime: '12:00',
        menu: null,
      },
    ]);

    renderPage();

    expect(
      await screen.findByText('The menu has not been published yet.')
    ).toBeInTheDocument();
  });

  it('renders the empty-state message for a date with no meals', async () => {
    mealAPI.getMealsByDate.mockResolvedValue([]);

    renderPage();

    expect(
      await screen.findByText('No meals are served on this day.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reserve a table' })).not.toBeInTheDocument();
  });

  it('renders API errors in an alert', async () => {
    mealAPI.getMealsByDate.mockRejectedValue(
      new Error('The selected date is not valid.')
    );

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The selected date is not valid.'
    );
  });

  it('requests meals again when a valid future date is selected', async () => {
    const user = userEvent.setup();
    mealAPI.getMealsByDate.mockResolvedValue([]);

    renderPage();

    await screen.findByText('No meals are served on this day.');
    await user.click(screen.getByRole('button', { name: 'Choose test date' }));

    await waitFor(() => {
      expect(mealAPI.getMealsByDate).toHaveBeenCalledWith('2028-06-01');
    });
  });

  it('ignores stale responses when the selected date changes', async () => {
    const user = userEvent.setup();
    let resolveFirst;
    mealAPI.getMealsByDate
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce([]);

    renderPage();

    await user.click(screen.getByRole('button', { name: 'Choose test date' }));
    await waitFor(() => {
      expect(mealAPI.getMealsByDate).toHaveBeenCalledWith('2028-06-01');
    });

    resolveFirst([{ slotId: 12, startTime: '11:00', endTime: '12:00', menu: '**Old**' }]);

    await waitFor(() => {
      expect(screen.queryByText('11:00 – 12:00')).not.toBeInTheDocument();
    });
  });
});
