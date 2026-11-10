import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const capacityAPI = vi.hoisted(() => ({
  getSlots: vi.fn(),
  getTables: vi.fn(),
  addTablesToSlot: vi.fn(),
  createSlot: vi.fn(),
  createTable: vi.fn(),
  copyTablesToSlot: vi.fn(),
}));

vi.mock('../../../frontend/src/api/capacity_api', () => ({
  default: capacityAPI,
}));

import { CapacityPage } from '../../../frontend/src/pages/CapacityPage';

function slotForToday(tables = []) {
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  const end = new Date(start);
  end.setHours(13);

  return {
    slotId: 1,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    tables,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  capacityAPI.getTables.mockResolvedValue([
    { tableId: 2, code: 'T2', seats: 4 },
  ]);
});

afterEach(() => {
  cleanup();
});

describe('CapacityPage', () => {
  it('shows slots returned by the capacity API', async () => {
    capacityAPI.getSlots.mockResolvedValue([slotForToday([
      { tableId: 1, code: 'T1', seats: 6 },
    ])]);

    render(<CapacityPage />);

    expect(await screen.findByText(/12:00.*13:00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View Tables' }));
    expect(screen.getByText('Assigned Tables')).toBeInTheDocument();
    expect(screen.getByText('T1')).toBeInTheDocument();
    expect(screen.getByText('6 seats')).toBeInTheDocument();
  });

  it('assigns a selected table to an empty slot', async () => {
    const user = userEvent.setup();
    capacityAPI.getSlots
      .mockResolvedValueOnce([slotForToday()])
      .mockResolvedValueOnce([slotForToday([
        { tableId: 2, code: 'T2', seats: 4 },
      ])]);
    capacityAPI.addTablesToSlot.mockResolvedValue({});

    render(<CapacityPage />);

    await user.click(await screen.findByRole('button', { name: 'Assign Tables' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Save Tables' }));

    expect(capacityAPI.addTablesToSlot).toHaveBeenCalledWith(1, [2]);
    expect(capacityAPI.getSlots).toHaveBeenCalledTimes(2);
  });
});
