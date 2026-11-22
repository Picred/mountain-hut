import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The component uses mocked API functions, while API tests use the real ones.
vi.mock('../../../frontend/src/api/hike_api', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        default: {
            ...actual.default,
            getHikerHikes: vi.fn(),
            confirmHikeArrival: vi.fn(),
        },
    };
});

import hikeAPI from '../../../frontend/src/api/hike_api';
import { MyHikesPage } from '../../../frontend/src/pages/MyHikesPage';

const { default: realAPI } = await vi.importActual(
    '../../../frontend/src/api/hike_api'
);

const SERVER_URL = 'http://localhost:3001';

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

const PAST_DEPARTURE = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const FUTURE_DEPARTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const makeHike = (overrides = {}) => ({
    hikeId: 1,
    status: 'scheduled',
    destination: 'Monte Bianco',
    route: 'Via Normale',
    scheduledDeparture: PAST_DEPARTURE,
    expectedArrival: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    partySize: 2,
    passages: [],
    ...overrides,
});

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

// ============================================================
// API
// ============================================================

describe('getHikerHikes API', () => {
    it('sends a GET request and returns the hiker hikes', async () => {
        const hikes = [
            makeHike(),
            makeHike({ hikeId: 2, status: 'returned' }),
        ];

        fetchMock.mockResolvedValue(mockResponse({ body: hikes }));

        await expect(realAPI.getHikerHikes()).resolves.toEqual(hikes);

        expect(fetchMock).toHaveBeenCalledWith(
            `${SERVER_URL}/api/hikes`,
            {
                method: 'GET',
                credentials: 'include',
            }
        );
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('returns an empty array when the hiker has no hikes', async () => {
        fetchMock.mockResolvedValue(mockResponse({ body: [] }));

        await expect(realAPI.getHikerHikes()).resolves.toEqual([]);
    });

    it.each([
        [401, 'Please log in to view your hikes.'],
        [403, 'Only hikers can view their hikes.'],
        [400, 'Unable to load your hikes. Please try again.'],
        [404, 'Unable to load your hikes. Please try again.'],
        [500, 'A server error occurred while loading your hikes. Please try again.'],
        [503, 'A server error occurred while loading your hikes. Please try again.'],
    ])('throws the correct error for HTTP %i', async (status, message) => {
        fetchMock.mockResolvedValue(
            mockResponse({ ok: false, status })
        );

        await expect(realAPI.getHikerHikes()).rejects.toThrow(message);
    });

    it('propagates network errors', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(realAPI.getHikerHikes()).rejects.toThrow(
            'Failed to fetch'
        );
    });

    it('propagates invalid JSON errors on successful responses', async () => {
        fetchMock.mockResolvedValue(mockResponse({ invalidJson: true }));

        await expect(realAPI.getHikerHikes()).rejects.toThrow(SyntaxError);
    });
});

describe('confirmHikeArrival API', () => {
    it('sends a PUT request and returns the confirmed hike', async () => {
        const confirmed = {
            hikeId: 1,
            userId: 10,
            status: 'returned',
        };

        fetchMock.mockResolvedValue(
            mockResponse({ body: confirmed })
        );

        await expect(
            realAPI.confirmHikeArrival(1)
        ).resolves.toEqual(confirmed);

        expect(fetchMock).toHaveBeenCalledWith(
            `${SERVER_URL}/api/hikes/1/confirm-arrival`,
            {
                method: 'PUT',
                credentials: 'include',
            }
        );
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('uses the provided hike ID in the URL', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({
                body: { hikeId: 42, status: 'returned' },
            })
        );

        await realAPI.confirmHikeArrival(42);

        expect(fetchMock).toHaveBeenCalledWith(
            `${SERVER_URL}/api/hikes/42/confirm-arrival`,
            expect.objectContaining({ method: 'PUT' })
        );
    });

    it('does not send a request body', async () => {
        fetchMock.mockResolvedValue(mockResponse());

        await realAPI.confirmHikeArrival(1);

        const [, options] = fetchMock.mock.calls[0];

        expect(options).not.toHaveProperty('body');
    });

    it.each([
        [401, 'Please log in to confirm your safe arrival.'],
        [403, 'Only hikers can confirm a hike arrival.'],
    ])('throws the correct authorization error for HTTP %i', async (status, message) => {
        fetchMock.mockResolvedValue(
            mockResponse({ ok: false, status })
        );

        await expect(
            realAPI.confirmHikeArrival(1)
        ).rejects.toThrow(message);
    });

    it('throws a specific error when the hike is not found', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({
                ok: false,
                status: 404,
                body: { error: 'HIKE_NOT_FOUND' },
            })
        );

        await expect(
            realAPI.confirmHikeArrival(99)
        ).rejects.toThrow('This hike could not be found.');
    });

    it('throws a specific error when the hike is already confirmed', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({
                ok: false,
                status: 409,
                body: { error: 'HIKE_ALREADY_CONFIRMED' },
            })
        );

        await expect(
            realAPI.confirmHikeArrival(1)
        ).rejects.toThrow(
            'This hike has already been marked as returned.'
        );
    });

    it.each([
        [400, 'Unable to confirm your safe arrival. Please try again.'],
        [404, 'Unable to confirm your safe arrival. Please try again.'],
        [409, 'Unable to confirm your safe arrival. Please try again.'],
        [500, 'A server error occurred while confirming your arrival. Please try again.'],
        [503, 'A server error occurred while confirming your arrival. Please try again.'],
    ])('throws a fallback error for HTTP %i', async (status, message) => {
        fetchMock.mockResolvedValue(
            mockResponse({
                ok: false,
                status,
                body: {},
            })
        );

        await expect(
            realAPI.confirmHikeArrival(1)
        ).rejects.toThrow(message);
    });

    it('uses the fallback error when the server returns invalid JSON', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({
                ok: false,
                status: 409,
                invalidJson: true,
            })
        );

        await expect(
            realAPI.confirmHikeArrival(1)
        ).rejects.toThrow(
            'Unable to confirm your safe arrival. Please try again.'
        );
    });

    it('propagates network errors', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(
            realAPI.confirmHikeArrival(1)
        ).rejects.toThrow('Failed to fetch');
    });

    it('propagates invalid JSON errors on successful responses', async () => {
        fetchMock.mockResolvedValue(mockResponse({ invalidJson: true }));

        await expect(
            realAPI.confirmHikeArrival(1)
        ).rejects.toThrow(SyntaxError);
    });
});

// ============================================================
// COMPONENT
// ============================================================

describe('MyHikesPage', () => {
    function renderPage(hikes = [makeHike()]) {
        hikeAPI.getHikerHikes.mockResolvedValue(hikes);
        render(<MyHikesPage />);
    }

    const confirmButton = () =>
        screen.getByRole('button', { name: 'Confirm safe arrival' });

    it('shows a loading message while fetching hikes', () => {
        hikeAPI.getHikerHikes.mockReturnValue(new Promise(() => {}));

        render(<MyHikesPage />);

        expect(screen.getByRole('status')).toHaveTextContent(
            'Loading your hikes...'
        );
        expect(hikeAPI.getHikerHikes).toHaveBeenCalledOnce();
    });

    it('displays the page title and description', async () => {
        renderPage();

        expect(
            screen.getByRole('heading', { name: 'My hikes' })
        ).toBeInTheDocument();

        expect(screen.getByText(
            'View your registered hikes and confirm when you have arrived safely.'
        )).toBeInTheDocument();

        expect(
            await screen.findByRole('heading', { name: 'Hike #1' })
        ).toBeInTheDocument();
    });

    it('shows a fallback for invalid dates', async () => {
        renderPage([
            makeHike({
                scheduledDeparture: 'invalid',
                expectedArrival: null,
            }),
        ]);

        await screen.findByRole('heading', { name: 'Hike #1' });

        expect(screen.getByText('Date unavailable')).toBeInTheDocument();
    });

    it('uses the singular label for a single hiker', async () => {
        renderPage([makeHike({ partySize: 1 })]);

        expect(await screen.findByText('1 hiker')).toBeInTheDocument();
    });

    it('hides the passages section when no passages exist', async () => {
        renderPage([makeHike({ passages: [] })]);

        await screen.findByRole('heading', { name: 'Hike #1' });

        expect(screen.queryByText('Passages')).not.toBeInTheDocument();
    });

    it('shows all hikes returned by the API', async () => {
        renderPage([
            makeHike({ hikeId: 1 }),
            makeHike({
                hikeId: 2,
                destination: 'Gran Paradiso',
                status: 'returned',
            }),
            makeHike({
                hikeId: 3,
                destination: 'Monte Rosa',
                status: 'cancelled',
            }),
        ]);

        expect(
            await screen.findByRole('heading', { name: 'Hike #1' })
        ).toBeInTheDocument();

        expect(
            screen.getByRole('heading', { name: 'Hike #2' })
        ).toBeInTheDocument();

        expect(
            screen.getByRole('heading', { name: 'Hike #3' })
        ).toBeInTheDocument();

        expect(screen.getByText('Gran Paradiso')).toBeInTheDocument();
        expect(screen.getByText('Monte Rosa')).toBeInTheDocument();
    });

    it('shows an empty state when the hiker has no hikes', async () => {
        renderPage([]);

        expect(
            await screen.findByRole('heading', { name: 'No hikes yet' })
        ).toBeInTheDocument();

        expect(screen.getByText(
            'Your registered hikes will appear here.'
        )).toBeInTheDocument();

        expect(
            screen.queryByRole('button', { name: 'Confirm safe arrival' })
        ).not.toBeInTheDocument();
    });

    it('shows an error when loading hikes fails', async () => {
        hikeAPI.getHikerHikes.mockRejectedValue(
            new Error('Unable to load your hikes.')
        );

        render(<MyHikesPage />);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Unable to load your hikes.'
        );

        expect(
            screen.queryByRole('heading', { name: 'No hikes yet' })
        ).not.toBeInTheDocument();
    });

    it('rejects an invalid API response format', async () => {
        hikeAPI.getHikerHikes.mockResolvedValue({
            hikes: [makeHike()],
        });

        render(<MyHikesPage />);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'The hikes response was not in the expected format.'
        );
    });

    it('shows the confirmation button only for started scheduled hikes', async () => {
        renderPage([
            makeHike({ hikeId: 1, status: 'scheduled', scheduledDeparture: PAST_DEPARTURE }),
            makeHike({ hikeId: 2, status: 'scheduled', scheduledDeparture: FUTURE_DEPARTURE }),
            makeHike({ hikeId: 3, status: 'returned', scheduledDeparture: PAST_DEPARTURE }),
            makeHike({ hikeId: 4, status: 'cancelled', scheduledDeparture: PAST_DEPARTURE }),
        ]);

        await screen.findByRole('heading', { name: 'Hike #4' });

        const articles = screen.getAllByRole('article');

        expect(
            within(articles[0]).getByRole('button', {
                name: 'Confirm safe arrival',
            })
        ).toBeEnabled();

        expect(
            within(articles[1]).queryByRole('button', {
                name: 'Confirm safe arrival',
            })
        ).not.toBeInTheDocument();

        expect(
            within(articles[2]).queryByRole('button', {
                name: 'Confirm safe arrival',
            })
        ).not.toBeInTheDocument();

        expect(
            within(articles[3]).queryByRole('button', {
                name: 'Confirm safe arrival',
            })
        ).not.toBeInTheDocument();
    });

    it('confirms a hike and updates its status to returned', async () => {
        hikeAPI.confirmHikeArrival.mockResolvedValue({
            hikeId: 1,
            userId: 10,
            status: 'returned',
        });

        renderPage();

        await screen.findByRole('heading', { name: 'Hike #1' });

        await userEvent.click(confirmButton());

        expect(hikeAPI.confirmHikeArrival).toHaveBeenCalledWith(1);
        expect(hikeAPI.confirmHikeArrival).toHaveBeenCalledOnce();

        expect(await screen.findByRole('status')).toHaveTextContent(
            'Hike #1 has been marked as safely returned.'
        );

        expect(screen.getByText('returned')).toBeInTheDocument();

        expect(
            screen.queryByRole('button', { name: 'Confirm safe arrival' })
        ).not.toBeInTheDocument();
    });

    it('updates only the confirmed hike', async () => {
        hikeAPI.confirmHikeArrival.mockResolvedValue({
            hikeId: 1,
            status: 'returned',
        });

        renderPage([
            makeHike({ hikeId: 1 }),
            makeHike({ hikeId: 2, destination: 'Gran Paradiso' }),
        ]);

        await screen.findByRole('heading', { name: 'Hike #2' });

        const firstHike = screen.getByRole(
            'heading', { name: 'Hike #1' }
        ).closest('article');

        await userEvent.click(
            within(firstHike).getByRole('button', {
                name: 'Confirm safe arrival',
            })
        );

        await screen.findByText(
            'Hike #1 has been marked as safely returned.'
        );

        const articles = screen.getAllByRole('article');

        expect(within(articles[0]).getByText('returned')).toBeInTheDocument();
        expect(within(articles[1]).getByText('scheduled')).toBeInTheDocument();

        expect(
            within(articles[1]).getByRole('button', {
                name: 'Confirm safe arrival',
            })
        ).toBeEnabled();
    });

    it('disables the confirmation button while the request is pending', async () => {
        let finishConfirmation;

        hikeAPI.confirmHikeArrival.mockReturnValue(
            new Promise((resolve) => {
                finishConfirmation = resolve;
            })
        );

        renderPage();

        await screen.findByRole('heading', { name: 'Hike #1' });

        await userEvent.click(confirmButton());

        const pendingButton = screen.getByRole('button', {
            name: 'Confirming...',
        });

        expect(pendingButton).toBeDisabled();
        expect(hikeAPI.confirmHikeArrival).toHaveBeenCalledOnce();

        finishConfirmation({
            hikeId: 1,
            status: 'returned',
        });

        await waitFor(() => {
            expect(screen.getByText('returned')).toBeInTheDocument();
        });
    });

    it('prevents duplicate confirmation requests for the same hike', async () => {
        let finishConfirmation;

        hikeAPI.confirmHikeArrival.mockReturnValue(
            new Promise((resolve) => {
                finishConfirmation = resolve;
            })
        );

        renderPage();

        await screen.findByRole('heading', { name: 'Hike #1' });

        await userEvent.click(confirmButton());

        const pendingButton = screen.getByRole('button', {
            name: 'Confirming...',
        });

        expect(pendingButton).toBeDisabled();

        await userEvent.click(pendingButton);

        expect(hikeAPI.confirmHikeArrival).toHaveBeenCalledOnce();

        finishConfirmation({
            hikeId: 1,
            status: 'returned',
        });

        await screen.findByText(
            'Hike #1 has been marked as safely returned.'
        );
    });

    it('shows an error when confirmation fails', async () => {
        hikeAPI.confirmHikeArrival.mockRejectedValue(
            new Error('This hike has already been marked as returned.')
        );

        renderPage();

        await screen.findByRole('heading', { name: 'Hike #1' });

        await userEvent.click(confirmButton());

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'This hike has already been marked as returned.'
        );

        expect(screen.getByText('scheduled')).toBeInTheDocument();
        expect(confirmButton()).toBeEnabled();
    });

    it('keeps the hike scheduled after a failed confirmation', async () => {
        hikeAPI.confirmHikeArrival.mockRejectedValue(
            new Error('Network error')
        );

        renderPage();

        await screen.findByRole('heading', { name: 'Hike #1' });

        await userEvent.click(confirmButton());

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Network error'
        );

        expect(screen.getByText('scheduled')).toBeInTheDocument();
        expect(screen.queryByText('returned')).not.toBeInTheDocument();
    });

    it('allows retrying after a failed confirmation', async () => {
        hikeAPI.confirmHikeArrival
            .mockRejectedValueOnce(new Error('Temporary error'))
            .mockResolvedValueOnce({
                hikeId: 1,
                status: 'returned',
            });

        renderPage();

        await screen.findByRole('heading', { name: 'Hike #1' });

        await userEvent.click(confirmButton());

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Temporary error'
        );

        await userEvent.click(confirmButton());

        expect(await screen.findByRole('status')).toHaveTextContent(
            'Hike #1 has been marked as safely returned.'
        );

        expect(hikeAPI.confirmHikeArrival).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('clears the previous confirmation error when retrying', async () => {
        let finishRetry;

        hikeAPI.confirmHikeArrival
            .mockRejectedValueOnce(new Error('Temporary error'))
            .mockImplementationOnce(
                () => new Promise((resolve) => {
                    finishRetry = resolve;
                })
            );

        renderPage();

        await screen.findByRole('heading', { name: 'Hike #1' });

        await userEvent.click(confirmButton());

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Temporary error'
        );

        await userEvent.click(confirmButton());

        expect(
            screen.queryByRole('alert')
        ).not.toBeInTheDocument();

        expect(
            screen.getByRole('button', { name: 'Confirming...' })
        ).toBeDisabled();

        finishRetry({ hikeId: 1, status: 'returned' });

        await screen.findByText(
            'Hike #1 has been marked as safely returned.'
        );
    });

    it('does not reload the hikes after successful confirmation', async () => {
        hikeAPI.confirmHikeArrival.mockResolvedValue({
            hikeId: 1,
            status: 'returned',
        });

        renderPage();

        await screen.findByRole('heading', { name: 'Hike #1' });

        await userEvent.click(confirmButton());

        await screen.findByText(
            'Hike #1 has been marked as safely returned.'
        );

        expect(hikeAPI.getHikerHikes).toHaveBeenCalledOnce();
    });

    it('does not confirm hikes that are already returned', async () => {
        renderPage([
            makeHike({ status: 'returned' }),
        ]);

        await screen.findByRole('heading', { name: 'Hike #1' });

        expect(
            screen.queryByRole('button', {
                name: 'Confirm safe arrival',
            })
        ).not.toBeInTheDocument();

        expect(hikeAPI.confirmHikeArrival).not.toHaveBeenCalled();
    });

    it('does not confirm cancelled hikes', async () => {
        renderPage([
            makeHike({ status: 'cancelled' }),
        ]);

        await screen.findByRole('heading', { name: 'Hike #1' });

        expect(
            screen.queryByRole('button', {
                name: 'Confirm safe arrival',
            })
        ).not.toBeInTheDocument();

        expect(hikeAPI.confirmHikeArrival).not.toHaveBeenCalled();
    });

    it('does not update the page after unmounting during loading', async () => {
        let finishLoading;

        hikeAPI.getHikerHikes.mockReturnValue(
            new Promise((resolve) => {
                finishLoading = resolve;
            })
        );

        const { unmount } = render(<MyHikesPage />);

        expect(screen.getByText('Loading your hikes...')).toBeInTheDocument();

        unmount();

        finishLoading([makeHike()]);

        await Promise.resolve();

        expect(
            screen.queryByRole('heading', { name: 'Hike #1' })
        ).not.toBeInTheDocument();
    });
});
