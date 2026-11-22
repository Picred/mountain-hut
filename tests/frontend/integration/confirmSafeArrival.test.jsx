import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { App } from '../../../frontend/src/App';

const SERVER_URL = 'http://localhost:3001';
const ANNA = { user_id: 3, name: 'Anna Winden', email: 'anna@mountainhut.test', phone: '+393401234567', role: 'hiker' };
const CARL = { user_id: 2, name: 'Carl Smith', email: 'employee@mountainhut.test', phone: '3331234567', role: 'employee' };

let server;

function mockServer(routes) {
    server = vi.fn(async (url, { method = 'GET' } = {}) => {
        const path = url.replace(SERVER_URL, '').split('?')[0];
        const key = `${method} ${path}`;
        const configured = routes[key] ?? { status: 404 };
        const status = configured.status ?? 200;
        const body = configured.body;

        return new Response(body === undefined ? null : JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
        });
    });
    vi.stubGlobal('fetch', server);
}

const renderApp = (initialPath = '/') =>
    render(
        <MemoryRouter initialEntries={[initialPath]}>
            <App />
        </MemoryRouter>
    );

const calls = (method, path) =>
    server.mock.calls.filter(([url, opts = {}]) =>
        url.replace(SERVER_URL, '').split('?')[0] === path && (opts.method ?? 'GET') === method
    );

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('Confirm Safe Arrival (Frontend Integration)', () => {
    const sampleHikes = [
        {
            hikeId: 10,
            destination: 'Lake Chiaretto',
            route: 'Via the lake path',
            scheduledDeparture: '2026-11-25T07:00:00.000Z',
            expectedArrival: '2026-11-25T15:00:00.000Z',
            partySize: 2,
            status: 'scheduled',
            passages: ['Passage Alpha', 'Passage Beta'],
        },
        {
            hikeId: 11,
            destination: 'Pian del Re',
            route: 'Valley road',
            scheduledDeparture: '2026-11-26T08:00:00.000Z',
            expectedArrival: '2026-11-26T16:00:00.000Z',
            partySize: 1,
            status: 'returned',
            passages: [],
        },
    ];

    describe('Access control and routing', () => {
        it('redirects unauthenticated users from /my-hikes to /login', async () => {
            mockServer({
                'GET /api/sessions/current': { status: 401 },
            });

            renderApp('/my-hikes');

            expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
            expect(screen.queryByRole('heading', { name: 'My hikes' })).not.toBeInTheDocument();
        });

        it('redirects employees trying to open /my-hikes to the home page', async () => {
            mockServer({
                'GET /api/sessions/current': { body: CARL },
            });

            renderApp('/my-hikes');

            expect(await screen.findByRole('heading', { name: 'Welcome to Mountain Hut' })).toBeInTheDocument();
            expect(screen.queryByRole('heading', { name: 'My hikes' })).not.toBeInTheDocument();
        });
    });

    describe('Navigation and display of hikes', () => {
        it('allows an authenticated hiker to navigate to My Hikes from the Navbar menu', async () => {
            const user = userEvent.setup();
            mockServer({
                'GET /api/sessions/current': { body: ANNA },
                'GET /api/hikes': { body: sampleHikes },
            });

            renderApp('/');

            const userMenuButton = await screen.findByRole('button', { name: ANNA.name });
            await user.click(userMenuButton);

            const myHikesMenuItem = await screen.findByRole('button', { name: 'My hikes' });
            await user.click(myHikesMenuItem);

            expect(await screen.findByRole('heading', { name: 'My hikes' })).toBeInTheDocument();
            expect(await screen.findByText('Lake Chiaretto')).toBeInTheDocument();
            expect(screen.getByText('Pian del Re')).toBeInTheDocument();
            expect(calls('GET', '/api/hikes').length).toBe(1);
        });

        it('shows an empty state message when the hiker has no registered hikes', async () => {
            mockServer({
                'GET /api/sessions/current': { body: ANNA },
                'GET /api/hikes': { body: [] },
            });

            renderApp('/my-hikes');

            expect(await screen.findByRole('heading', { name: 'No hikes yet' })).toBeInTheDocument();
            expect(screen.getByText('Your registered hikes will appear here.')).toBeInTheDocument();
        });

        it('displays load errors when the backend fails to provide hikes', async () => {
            mockServer({
                'GET /api/sessions/current': { body: ANNA },
                'GET /api/hikes': { status: 500 },
            });

            renderApp('/my-hikes');

            expect(await screen.findByRole('alert')).toBeInTheDocument();
            expect(screen.getByText(/A server error occurred while loading your hikes/i)).toBeInTheDocument();
        });
    });
});
