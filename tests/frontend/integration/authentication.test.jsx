import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { App } from '../../../frontend/src/App';

// The real app is rendered (App, routes, Navbar, forms, authAPI): only the network is fake
const SERVER_URL = 'http://localhost:3001';
const ANNA = { user_id: 3, name: 'Anna Winden', email: 'anna@mountainhut.test', phone: '+393401234567', role: 'hiker' };

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

const renderApp = (path = '/') => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

const calls = (method, path) => server.mock.calls.filter(([url, opts = {}]) =>
  url === `${SERVER_URL}${path}` && (opts.method ?? 'GET') === method);

const navbar = () => within(screen.getByRole('banner'));

// Logged out: the Navbar shows the Login button; logged in: the user's name and the Logout button
async function expectLoggedInAs(name) {
  expect(await navbar().findByText(name)).toBeInTheDocument();
  expect(navbar().getByRole('button', { name: 'Logout' })).toBeInTheDocument();
}

async function expectLoggedOut() {
  expect((await navbar().findAllByRole('button', { name: 'Login' })).length).toBeGreaterThan(0);
  expect(navbar().queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
}

async function logIn(user) {
  await user.type(screen.getByPlaceholderText('mario@example.com'), ANNA.email);
  await user.type(screen.getByPlaceholderText('••••••••'), 'password');
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Authentication flow', () => {
  it('restores the session of an already logged user on load', async () => {
    mockServer({ 'GET /api/sessions/current': { body: ANNA } });

    renderApp();

    await expectLoggedInAs('Anna Winden');
  });

  it('logs in, shows the user in the Navbar and goes back to the homepage', async () => {
    const user = userEvent.setup();
    mockServer({
      'GET /api/sessions/current': { status: 401 },
      'POST /api/sessions': { status: 201, body: ANNA },
    });
    renderApp('/login');

    await logIn(user);

    await expectLoggedInAs('Anna Winden');
    expect(await screen.findByRole('heading', { name: 'Welcome to Mountain Hut' })).toBeInTheDocument();
    expect(JSON.parse(calls('POST', '/api/sessions')[0][1].body)).toEqual({ email: ANNA.email, password: 'password' });
  });

  it('shows the server error and stays logged out when the credentials are wrong', async () => {
    const user = userEvent.setup();
    mockServer({
      'GET /api/sessions/current': { status: 401 },
      'POST /api/sessions': { status: 401, body: { error: 'Invalid email or password.' } },
    });
    renderApp('/login');

    await logIn(user);

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
    await expectLoggedOut();
  });

  it('registers a new user and logs them in', async () => {
    const user = userEvent.setup();
    const mario = { user_id: 6, name: 'Mario Rossi', email: 'mario@example.com', phone: '3331234567', role: 'hiker' };
    mockServer({
      'GET /api/sessions/current': { status: 401 },
      'POST /api/users': { status: 201, body: mario },
    });
    renderApp('/register');

    await user.type(screen.getByPlaceholderText('Mario Rossi'), 'Mario Rossi');
    await user.type(screen.getByPlaceholderText('mario@example.com'), 'mario@example.com');
    await user.type(screen.getByPlaceholderText('333 1234567'), '3331234567');
    await user.type(screen.getByPlaceholderText('••••••••'), 'secret1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await expectLoggedInAs('Mario Rossi');
    expect(calls('POST', '/api/users')).toHaveLength(1);
  });

  it('logs out from the Navbar', async () => {
    const user = userEvent.setup();
    mockServer({
      'GET /api/sessions/current': { body: ANNA },
      'DELETE /api/sessions/current': { status: 204 },
    });
    renderApp();
    await expectLoggedInAs('Anna Winden');

    await user.click(navbar().getByRole('button', { name: 'Logout' }));

    await expectLoggedOut();
    expect(calls('DELETE', '/api/sessions/current')).toHaveLength(1);
  });

  it('sends a logged out user to the login and then back to the reservation page', async () => {
    const user = userEvent.setup();
    mockServer({
      'GET /api/sessions/current': { status: 401 },
      'POST /api/sessions': { status: 201, body: ANNA },
      'GET /api/slots': { body: [] },
    });
    renderApp('/reservations');

    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
    await logIn(user);

    expect(await screen.findByRole('heading', { name: 'Reserve your table' })).toBeInTheDocument();
  });
});
