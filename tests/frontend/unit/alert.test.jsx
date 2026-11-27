import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const hikeAPI = vi.hoisted(() => ({
    getOverdueHikes: vi.fn(),
}));

vi.mock('../../../frontend/src/api/hike_api', () => ({
    default: hikeAPI,
}));

import { Alert } from '../../../frontend/src/components/Alert';

const POLL_MS = 30_000;
const SEEN_KEY = 'seenHikeAlerts';

const makeAlert = (overrides = {}) => ({
    hikeId: 1,
    hiker: {
        name: 'Mario Rossi',
        email: 'mario@example.com',
        phone: '3331234567',
    },
    destination: 'Monte Viso',
    expectedArrival: '2028-06-10T09:00:00.000Z',
    alertNumber: 1,
    totalAlerts: 5,
    ...overrides,
});

const flushPromises = async () => {
    await act(async () => {
        await Promise.resolve();
    });
};

const advancePolling = async () => {
    await act(async () => {
        vi.advanceTimersByTime(POLL_MS);
        await Promise.resolve();
    });
};

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();

    hikeAPI.getOverdueHikes.mockResolvedValue([]);
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.useRealTimers();
});

describe('Alert component', () => {

    it('retrieves overdue hikes when the component mounts', async () => {
        hikeAPI.getOverdueHikes.mockResolvedValueOnce([
            makeAlert(),
        ]);

        render(<Alert />);

        await flushPromises();

        expect(hikeAPI.getOverdueHikes).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });

    it('does not display a popup when there are no overdue hikes', async () => {
        hikeAPI.getOverdueHikes.mockResolvedValueOnce([]);

        render(<Alert />);

        await flushPromises();

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('displays the information of a missing hiker', async () => {
        hikeAPI.getOverdueHikes.mockResolvedValueOnce([
            makeAlert(),
        ]);

        render(<Alert />);

        await flushPromises();

        expect(screen.getByText('Mario Rossi')).toBeInTheDocument();
        expect(screen.getByText(/Monte Viso/)).toBeInTheDocument();
        expect(screen.getByText(/3331234567/)).toBeInTheDocument();
        expect(screen.getByText('Alert 1/5')).toBeInTheDocument();
    });

    it('displays multiple missing hikers in the same popup', async () => {
        hikeAPI.getOverdueHikes.mockResolvedValueOnce([
            makeAlert(),
            makeAlert({
                hikeId: 2,
                hiker: {
                    name: 'Anna Bianchi',
                    email: 'anna@example.com',
                    phone: null,
                },
                destination: 'Monte Rosa',
                alertNumber: 3,
            }),
        ]);

        render(<Alert />);

        await flushPromises();

        expect(
            screen.getByRole('heading', { name: 'Missing hikers' })
        ).toBeInTheDocument();

        expect(screen.getByText('Mario Rossi')).toBeInTheDocument();
        expect(screen.getByText('Anna Bianchi')).toBeInTheDocument();
        expect(screen.getByText('Alert 1/5')).toBeInTheDocument();
        expect(screen.getByText('Alert 3/5')).toBeInTheDocument();
    });

    it('does not display alerts that have already been seen', async () => {
        localStorage.setItem(
            SEEN_KEY,
            JSON.stringify(['1-1'])
        );

        hikeAPI.getOverdueHikes.mockResolvedValueOnce([
            makeAlert(),
        ]);

        render(<Alert />);

        await flushPromises();

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('marks alerts as seen and closes the popup when dismissed', async () => {
        const alert = makeAlert();

        hikeAPI.getOverdueHikes.mockResolvedValueOnce([alert]);

        render(<Alert />);

        await flushPromises();

        fireEvent.click(
            screen.getByRole('button', { name: "I've seen it" })
        );

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

        expect(
            JSON.parse(localStorage.getItem(SEEN_KEY))
        ).toContain('1-1');
    });

    it('does not display the same alert again after it has been dismissed', async () => {
        hikeAPI.getOverdueHikes
            .mockResolvedValueOnce([makeAlert()])
            .mockResolvedValueOnce([makeAlert()]);

        render(<Alert />);

        await flushPromises();

        fireEvent.click(
            screen.getByRole('button', { name: "I've seen it" })
        );

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

        await advancePolling();

        expect(hikeAPI.getOverdueHikes).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('displays a new alert when the alert number changes for the same hike', async () => {
        hikeAPI.getOverdueHikes
            .mockResolvedValueOnce([makeAlert()])
            .mockResolvedValueOnce([
                makeAlert({ alertNumber: 2 }),
            ]);

        render(<Alert />);

        await flushPromises();

        fireEvent.click(
            screen.getByRole('button', { name: "I've seen it" })
        );

        await advancePolling();

        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
        expect(screen.getByText('Alert 2/5')).toBeInTheDocument();
    });

    it('checks for new alerts every 30 seconds', async () => {
        hikeAPI.getOverdueHikes.mockResolvedValue([]);

        render(<Alert />);

        await flushPromises();

        expect(hikeAPI.getOverdueHikes).toHaveBeenCalledTimes(1);

        await advancePolling();

        expect(hikeAPI.getOverdueHikes).toHaveBeenCalledTimes(2);

        await advancePolling();

        expect(hikeAPI.getOverdueHikes).toHaveBeenCalledTimes(3);
    });

    it('continues polling when the API request fails', async () => {
        hikeAPI.getOverdueHikes
            .mockRejectedValueOnce(new Error('Network error'))
            .mockResolvedValueOnce([makeAlert()]);

        render(<Alert />);

        await flushPromises();

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

        await advancePolling();

        expect(hikeAPI.getOverdueHikes).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });

    it('clears the polling interval when the component unmounts', async () => {
        const { unmount } = render(<Alert />);

        await flushPromises();

        expect(vi.getTimerCount()).toBe(1);

        unmount();

        expect(vi.getTimerCount()).toBe(0);
    });
});
