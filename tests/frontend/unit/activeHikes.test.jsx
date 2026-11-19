import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The component uses a mocked getActiveHikes, the API tests use the real one.
vi.mock('../../../frontend/src/api/hike_api', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        default: {
            ...actual.default,
            getActiveHikes: vi.fn(),
        },
    };
});

import hikeAPI from '../../../frontend/src/api/hike_api';
import { ActiveHikesPage } from '../../../frontend/src/pages/ActiveHikesPage';

const { default: realAPI } = await vi.importActual(
    '../../../frontend/src/api/hike_api'
);

const SERVER_URL = 'http://localhost:3001';

function mockResponse({ ok = true, status = 200, body = [], invalidJson = false } = {}) {
    return {
        ok,
        status,
        json: invalidJson
            ? vi.fn().mockRejectedValue(new SyntaxError('Invalid JSON'))
            : vi.fn().mockResolvedValue(body),
    };
}

const hike = {
    hikeId: 1,
    destination: 'Monte Viso',
    route: 'Pian del Re - Colle delle Traversette',
    passages: ['Pian del Re', 'Colle delle Traversette'],
    scheduledDeparture: '2027-07-15T08:00:00.000Z',
    expectedArrival: '2027-07-15T17:00:00.000Z',
    partySize: 2,
    status: 'scheduled',
    isOverdue: false,
    hiker: {
        userId: 10,
        name: 'Mario Rossi',
        email: 'mario@example.com',
        phone: '123456789',
        notes: 'Experienced hiker',
        emergencyContact: 'Anna: 987654321',
    },
};

const overdueHike = {
    ...hike,
    hikeId: 2,
    destination: 'Monte Rosa',
    partySize: 1,
    isOverdue: true,
    hiker: {
        userId: 11,
        name: 'Giulia Bianchi',
        email: 'giulia@example.com',
        phone: null,
        notes: null,
        emergencyContact: null,
    },
};

let fetchMock;

beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    hikeAPI.getActiveHikes.mockResolvedValue([hike, overdueHike]);
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

// ============================================================
// API
// ============================================================

describe('getActiveHikes API', () => {
    it('sends a GET request with session credentials and returns the hikes', async () => {
        const result = [hike, overdueHike];
        fetchMock.mockResolvedValue(mockResponse({ body: result }));

        await expect(realAPI.getActiveHikes()).resolves.toEqual(result);

        expect(fetchMock).toHaveBeenCalledWith(
            `${SERVER_URL}/api/hikes/active`,
            {
                method: 'GET',
                credentials: 'include',
            }
        );
    });

    it('returns an empty array when no active hikes exist', async () => {
        fetchMock.mockResolvedValue(mockResponse({ body: [] }));

        await expect(realAPI.getActiveHikes()).resolves.toEqual([]);
    });

    it.each([
        [401, 'Please log in to view active hikes.'],
        [403, 'Only employees can view active hikes.'],
        [400, 'Unable to load active hikes. Please try again.'],
        [404, 'Unable to load active hikes. Please try again.'],
        [500, 'A server error occurred while loading active hikes. Please try again.'],
        [503, 'A server error occurred while loading active hikes. Please try again.'],
    ])('throws the correct message for HTTP %i', async (status, message) => {
        fetchMock.mockResolvedValue(
            mockResponse({ ok: false, status })
        );

        await expect(realAPI.getActiveHikes()).rejects.toThrow(message);
    });

    it('propagates network errors', async () => {
        fetchMock.mockRejectedValue(new Error('Network error'));

        await expect(realAPI.getActiveHikes()).rejects.toThrow(
            'Network error'
        );
    });

    it('propagates invalid JSON responses', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({ invalidJson: true })
        );

        await expect(realAPI.getActiveHikes()).rejects.toThrow(
            'Invalid JSON'
        );
    });
});

// ============================================================
// ACTIVE HIKES PAGE
// ============================================================

describe('ActiveHikesPage', () => {
    it('shows a loading state while hikes are requested', () => {
        hikeAPI.getActiveHikes.mockReturnValue(new Promise(() => {}));

        render(<ActiveHikesPage />);

        expect(screen.getByText('Loading active hikes...')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Refreshing...' })).toBeDisabled();
    });

    it('loads and displays active hikes', async () => {
        render(<ActiveHikesPage />);

        expect(await screen.findByText('Monte Viso')).toBeInTheDocument();
        expect(screen.getByText('Monte Rosa')).toBeInTheDocument();
        expect(screen.getByText('Mario Rossi')).toBeInTheDocument();
        expect(screen.getByText('Giulia Bianchi')).toBeInTheDocument();

        expect(hikeAPI.getActiveHikes).toHaveBeenCalledTimes(1);
    });

    it('displays the correct active and overdue hike counts', async () => {
        render(<ActiveHikesPage />);

        await screen.findByText('Monte Viso');

        expect(
            screen.getByText('Active hikes').nextElementSibling
        ).toHaveTextContent('2');

        expect(
            screen.getByText('Overdue hikes').nextElementSibling
        ).toHaveTextContent('1');
    });

    it('displays an empty state when no active hikes exist', async () => {
        hikeAPI.getActiveHikes.mockResolvedValue([]);

        render(<ActiveHikesPage />);

        expect(
            await screen.findByRole('heading', { name: 'No active hikes' })
        ).toBeInTheDocument();

        expect(
            screen.getByText('There are currently no hikers registered as being on a hike.')
        ).toBeInTheDocument();

        expect(
            screen.getByText('Active hikes').nextElementSibling
        ).toHaveTextContent('0');

        expect(
            screen.getByText('Overdue hikes').nextElementSibling
        ).toHaveTextContent('0');
    });

    it('marks only overdue hikes with an overdue badge', async () => {
        render(<ActiveHikesPage />);

        await screen.findByText('Monte Viso');

        const articles = document.querySelectorAll('article');

        expect(articles).toHaveLength(2);
        expect(within(articles[0]).queryByText('Overdue')).not.toBeInTheDocument();
        expect(within(articles[1]).getByText('Overdue')).toBeInTheDocument();
    });

    it('displays singular and plural party sizes correctly', async () => {
        render(<ActiveHikesPage />);

        await screen.findByText('Monte Viso');

        expect(screen.getByText('2 hikers')).toBeInTheDocument();
        expect(screen.getByText('1 hiker')).toBeInTheDocument();
    });

    it('displays scheduled departure and expected return information', async () => {
        render(<ActiveHikesPage />);

        await screen.findByText('Monte Viso');

        expect(screen.getAllByText('Scheduled departure')).toHaveLength(2);
        expect(screen.getAllByText('Expected return')).toHaveLength(2);
    });

    it('hides hike details by default', async () => {
        render(<ActiveHikesPage />);

        await screen.findByText('Monte Viso');

        expect(screen.queryByText('Intermediate passage points')).not.toBeInTheDocument();
        expect(screen.queryByText('mario@example.com')).not.toBeInTheDocument();
    });

    it('expands a hike and displays its route and passage points', async () => {
        render(<ActiveHikesPage />);

        await screen.findByText('Monte Viso');

        await userEvent.click(
            screen.getAllByRole('button', { name: 'View details' })[0]
        );

        expect(
            screen.getByText('Pian del Re - Colle delle Traversette')
        ).toBeInTheDocument();

        expect(screen.getByText('Pian del Re')).toBeInTheDocument();
        expect(screen.getByText('Colle delle Traversette')).toBeInTheDocument();
        expect(screen.getByText('Intermediate passage points')).toBeInTheDocument();
    });

    it('displays hiker contact information and notes', async () => {
        render(<ActiveHikesPage />);

        await screen.findByText('Monte Viso');

        await userEvent.click(
            screen.getAllByRole('button', { name: 'View details' })[0]
        );

        expect(screen.getByText('mario@example.com')).toBeInTheDocument();
        expect(screen.getByText('123456789')).toBeInTheDocument();
        expect(screen.getByText('Anna: 987654321')).toBeInTheDocument();
        expect(screen.getByText('Experienced hiker')).toBeInTheDocument();
    });

    it('displays fallback values for missing optional contact information', async () => {
        hikeAPI.getActiveHikes.mockResolvedValue([overdueHike]);

        render(<ActiveHikesPage />);

        await screen.findByText('Monte Rosa');

        await userEvent.click(
            screen.getByRole('button', { name: 'View details' })
        );

        expect(screen.getAllByText('Not provided')).toHaveLength(2);
        expect(screen.queryByText('Notes')).not.toBeInTheDocument();
    });

    it('displays a message when no intermediate passage points exist', async () => {
        hikeAPI.getActiveHikes.mockResolvedValue([
            { ...hike, passages: [] },
        ]);

        render(<ActiveHikesPage />);

        await screen.findByText('Monte Viso');

        await userEvent.click(
            screen.getByRole('button', { name: 'View details' })
        );

        expect(
            screen.getByText('No intermediate passage points.')
        ).toBeInTheDocument();
    });

    it('collapses the hike details when Hide details is clicked', async () => {
        render(<ActiveHikesPage />);

        await screen.findByText('Monte Viso');

        await userEvent.click(
            screen.getAllByRole('button', { name: 'View details' })[0]
        );

        expect(screen.getByText('mario@example.com')).toBeInTheDocument();

        await userEvent.click(
            screen.getByRole('button', { name: 'Hide details' })
        );

        expect(screen.queryByText('mario@example.com')).not.toBeInTheDocument();
    });

    it('expands only one hike at a time', async () => {
        render(<ActiveHikesPage />);

        await screen.findByText('Monte Viso');

        await userEvent.click(
            screen.getAllByRole('button', { name: 'View details' })[0]
        );

        expect(screen.getByText('mario@example.com')).toBeInTheDocument();

        await userEvent.click(
            screen.getByRole('button', { name: 'View details' })
        );

        expect(screen.queryByText('mario@example.com')).not.toBeInTheDocument();
        expect(screen.getByText('giulia@example.com')).toBeInTheDocument();
    });

    it('requests the hikes again when Refresh is clicked', async () => {
        render(<ActiveHikesPage />);

        await screen.findByText('Monte Viso');

        await userEvent.click(
            screen.getByRole('button', { name: 'Refresh' })
        );

        await vi.waitFor(() => {
            expect(hikeAPI.getActiveHikes).toHaveBeenCalledTimes(2);
        });
    });

    it('updates the displayed hikes after refreshing', async () => {
        hikeAPI.getActiveHikes
            .mockResolvedValueOnce([hike])
            .mockResolvedValueOnce([overdueHike]);

        render(<ActiveHikesPage />);

        await screen.findByText('Monte Viso');

        await userEvent.click(
            screen.getByRole('button', { name: 'Refresh' })
        );

        expect(await screen.findByText('Monte Rosa')).toBeInTheDocument();
        expect(screen.queryByText('Monte Viso')).not.toBeInTheDocument();
    });

    it('disables Refresh while a request is pending', async () => {
        let finishRefresh;

        hikeAPI.getActiveHikes
            .mockResolvedValueOnce([hike])
            .mockImplementationOnce(
                () => new Promise((resolve) => {
                    finishRefresh = resolve;
                })
            );

        render(<ActiveHikesPage />);

        await screen.findByText('Monte Viso');

        await userEvent.click(
            screen.getByRole('button', { name: 'Refresh' })
        );

        expect(
            screen.getByRole('button', { name: 'Refreshing...' })
        ).toBeDisabled();

        finishRefresh([hike]);

        await vi.waitFor(() => {
            expect(
                screen.getByRole('button', { name: 'Refresh' })
            ).toBeEnabled();
        });
    });

    it('displays an error when the initial request fails', async () => {
        hikeAPI.getActiveHikes.mockRejectedValue(
            new Error('Network error')
        );

        render(<ActiveHikesPage />);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Network error'
        );
    });

    it('displays an error when refreshing fails', async () => {
        hikeAPI.getActiveHikes
            .mockResolvedValueOnce([hike])
            .mockRejectedValueOnce(new Error('Refresh failed'));

        render(<ActiveHikesPage />);

        await screen.findByText('Monte Viso');

        await userEvent.click(
            screen.getByRole('button', { name: 'Refresh' })
        );

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Refresh failed'
        );
    });

    it('clears an error after a successful retry', async () => {
        hikeAPI.getActiveHikes
            .mockRejectedValueOnce(new Error('Network error'))
            .mockResolvedValueOnce([hike]);

        render(<ActiveHikesPage />);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Network error'
        );

        await userEvent.click(
            screen.getByRole('button', { name: 'Refresh' })
        );

        expect(await screen.findByText('Monte Viso')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('ignores a pending initial request after the component unmounts', async () => {
        let finishRequest;

        hikeAPI.getActiveHikes.mockImplementationOnce(
            () => new Promise((resolve) => {
                finishRequest = resolve;
            })
        );

        const { unmount } = render(<ActiveHikesPage />);

        expect(screen.getByText('Loading active hikes...')).toBeInTheDocument();

        unmount();
        finishRequest([hike]);

        await vi.waitFor(() => {
            expect(hikeAPI.getActiveHikes).toHaveBeenCalledTimes(1);
        });
    });
});
