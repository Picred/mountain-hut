import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { App } from '../../../frontend/src/App';

// The real app is rendered (App, routes, Navbar, forms, authAPI): only the network is fake
const SERVER_URL = 'http://localhost:3001';
const ANNA = { user_id: 3, name: 'Anna Winden', email: 'anna@mountainhut.test', phone: '+393401234567', role: 'hiker' };
const CARL = { user_id: 1, name: 'Carl Smith', email: 'employee@mountainhut.test', phone: '+390000000000', role: 'employee' };

let server;

// Fake backend: answers each "METHOD /path" with the configured { status, body }.
// A route can also be a function returning { status, body }: it runs at every call,
// so the answer of a GET can change after a POST.
function mockServer(routes) {
  server = vi.fn(async (url, { method = 'GET' } = {}) => {
    const path = url.replace(SERVER_URL, '').split('?')[0];
    const route = routes[`${method} ${path}`] ?? { status: 404 };
    const { status = 200, body } = typeof route === 'function' ? route() : route;
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', server);
}

const renderApp = (path = '/') => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

// Calls with that exact method and path (no query string)
const calls = (method, path) => server.mock.calls.filter(([url, opts = {}]) =>
  url === `${SERVER_URL}${path}` && (opts.method ?? 'GET') === method);

// Calls whose URL starts with the path (needed when there is a query string)
const callsTo = (path) => server.mock.calls.filter(([url]) => url.startsWith(`${SERVER_URL}${path}`));

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

// Fills the login form with the given account (Anna by default)
async function logIn(user, account = ANNA) {
  await user.type(screen.getByPlaceholderText('mario@example.com'), account.email);
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

  it('allows a guest to check availability, then log in and return to the reservation page', async () => {
    const user = userEvent.setup();

    mockServer({
      'GET /api/sessions/current': { status: 401 },
      'POST /api/sessions': { status: 201, body: ANNA },
      'GET /api/slots': {
        body: [
          {
            slotId: 1,
            startTime: '12:00',
            endTime: '13:00',
            bookingAllowed: true,
          },
        ],
      },
      'GET /api/slots/1/availability': {
        body: {
          slotId: 1,
          partySize: 1,
          available: true,
          tableAllocation: [
            { tableId: 1, tableCode: 'T1', allocatedSeats: 1 },
          ],
        },
      },
    });

    renderApp('/reservations');

    expect(
      await screen.findByRole('heading', { name: 'Reserve your table' })
    ).toBeInTheDocument();

    await expectLoggedOut();

    const today = new Date();
    const dateKey = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');

    await user.click(screen.getByRole('button', { name: dateKey }));

    await user.click(
      await screen.findByRole('button', { name: /12:00.*13:00/ })
    );

    await user.click(
      screen.getByRole('button', { name: 'Check availability' })
    );

    expect(
      await screen.findByText('Table available for 1 guest')
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Log in to reserve' })
    );

    expect(
      await screen.findByRole('button', { name: 'Log in' })
    ).toBeInTheDocument();

    await logIn(user);

    await expectLoggedInAs('Anna Winden');

    expect(
      await screen.findByRole('heading', { name: 'Reserve your table' })
    ).toBeInTheDocument();
  });
});

describe('Access to the employee area', () => {
  it('sends a logged out user who opens the capacity page to the login', async () => {
    mockServer({ 'GET /api/sessions/current': { status: 401 } });

    renderApp('/capacity');

    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(callsTo('/api/slots/capacity')).toHaveLength(0);
  });

  it('sends a hiker who opens the capacity page back to the homepage', async () => {
    mockServer({ 'GET /api/sessions/current': { body: ANNA } });

    renderApp('/capacity');

    expect(await screen.findByRole('heading', { name: 'Welcome to Mountain Hut' })).toBeInTheDocument();
    expect(callsTo('/api/slots/capacity')).toHaveLength(0);
  });

  it('sends an employee who opens the reservation page back to the homepage', async () => {
    mockServer({ 'GET /api/sessions/current': { body: CARL } });

    renderApp('/reservations');

    expect(await screen.findByRole('heading', { name: 'Welcome to Mountain Hut' })).toBeInTheDocument();
    expect(callsTo('/api/slots')).toHaveLength(0);
  });

  it('shows the capacity management link and hides the booking button to an employee', async () => {
    mockServer({ 'GET /api/sessions/current': { body: CARL } });

    renderApp();

    await expectLoggedInAs('Carl Smith');
    expect(navbar().getByRole('button', { name: 'Capacity Management' })).toBeInTheDocument();
    expect(navbar().queryByRole('button', { name: /reserve a table/i })).not.toBeInTheDocument();
  });

  it('shows the booking button and hides the capacity management link to a hiker', async () => {
    mockServer({ 'GET /api/sessions/current': { body: ANNA } });

    renderApp();

    await expectLoggedInAs('Anna Winden');
    expect(navbar().getByRole('button', { name: /reserve a table/i })).toBeInTheDocument();
    expect(navbar().queryByRole('button', { name: 'Capacity Management' })).not.toBeInTheDocument();
  });

  it('logs in an employee and shows the employee Navbar', async () => {
    const user = userEvent.setup();
    mockServer({
      'GET /api/sessions/current': { status: 401 },
      'POST /api/sessions': { status: 201, body: CARL },
    });
    renderApp('/login');

    await logIn(user, CARL);

    await expectLoggedInAs('Carl Smith');
    expect(navbar().getByRole('button', { name: 'Capacity Management' })).toBeInTheDocument();
    expect(JSON.parse(calls('POST', '/api/sessions')[0][1].body)).toEqual({ email: CARL.email, password: 'password' });
  });
});

// ---- Capacity management page ----
const NOON = '12:00 – 13:00';
const EVENING = '19:00 – 21:00';

const T1 = { tableId: 1, code: 'T1', seats: 4 };
const T2 = { tableId: 2, code: 'T2', seats: 4 };
const T3 = { tableId: 3, code: 'T3', seats: 6 };

// Local time, like the page: the slot shows exactly the hour written here
const at = (hour, day = 15) => new Date(2030, 0, day, hour).toISOString();

const slot = (slotId, from, to, tables = [], day = 15) => ({
  slotId,
  startAt: at(from, day),
  endAt: at(to, day),
  hasTables: tables.length > 0,
  totalSeats: tables.reduce((sum, t) => sum + t.seats, 0),
  tables,
});

// The card (<article>) of the slot with that time label
const slotCard = (time) => within(screen.getByText(time).closest('article'));

describe('Capacity management page', () => {
  let slots;
  let tables;

  // The page opens on "today". Faking only Date (timers stay real) lets us put slots on that day
  // and makes the "must start in the future" rule predictable: it is 15 Jan 2030, 09:00.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2030, 0, 15, 9, 0));
    slots = [];
    tables = [T1, T2, T3];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // GETs read the current `slots` / `tables`, so a POST can change what the next GET returns
  async function openCapacityPage(extraRoutes = {}) {
    mockServer({
      'GET /api/sessions/current': { body: CARL },
      'GET /api/slots/capacity': () => ({ body: slots }),
      'GET /api/tables': () => ({ body: tables }),
      ...extraRoutes,
    });
    renderApp('/capacity');
    await screen.findByRole('heading', { name: 'Slot Management' });
    await waitFor(() => expect(screen.queryByText('Loading slots...')).not.toBeInTheDocument());
  }

  describe('slot list', () => {
    it('shows the slots of the selected day with their configuration status', async () => {
      slots = [slot(1, 12, 13, [T1, T3]), slot(2, 19, 21)];

      await openCapacityPage();

      expect(screen.getByText('2 slots defined')).toBeInTheDocument();
      expect(slotCard(NOON).getByText('Table set configured')).toBeInTheDocument();
      expect(slotCard(NOON).getByText(/2 tables.*10 seats/)).toBeInTheDocument();
      expect(slotCard(EVENING).getByText('No tables assigned · Not bookable')).toBeInTheDocument();
      expect(callsTo('/api/slots/capacity')).toHaveLength(1);
      expect(calls('GET', '/api/tables')).toHaveLength(1);
    });

    it('does not show the slots of other days', async () => {
      slots = [slot(1, 12, 13), slot(2, 10, 11, [], 16)];

      await openCapacityPage();

      expect(screen.getByText('1 slot defined')).toBeInTheDocument();
      expect(screen.getByText(NOON)).toBeInTheDocument();
      expect(screen.queryByText('10:00 – 11:00')).not.toBeInTheDocument();
    });

    it('shows the empty state when the day has no slots', async () => {
      await openCapacityPage();

      expect(screen.getByRole('heading', { name: 'No slots for this day' })).toBeInTheDocument();
      expect(screen.getByText('0 slots defined')).toBeInTheDocument();
    });

    it('shows an error when the slots cannot be loaded', async () => {
      await openCapacityPage({ 'GET /api/slots/capacity': { status: 500 } });

      expect(await screen.findByText('Unable to retrieve slots')).toBeInTheDocument();
    });

    it('shows the assigned tables of a configured slot', async () => {
      const user = userEvent.setup();
      slots = [slot(1, 12, 13, [T1, T3])];
      await openCapacityPage();
      const card = slotCard(NOON);

      await user.click(card.getByRole('button', { name: 'View Tables' }));

      expect(card.getByRole('heading', { name: 'Assigned Tables' })).toBeInTheDocument();
      expect(card.getByText('T1')).toBeInTheDocument();
      expect(card.getByText('4 seats')).toBeInTheDocument();
      expect(card.getByText('T3')).toBeInTheDocument();
      expect(card.getByText('6 seats')).toBeInTheDocument();

      await user.click(card.getByRole('button', { name: 'Close' }));
      expect(card.queryByRole('heading', { name: 'Assigned Tables' })).not.toBeInTheDocument();
    });
  });

  describe('creating a slot', () => {
    // type="time" inputs: fireEvent.change is more reliable than typing key by key
    const fillSlotForm = (start, end) => {
      fireEvent.change(screen.getByLabelText('Start Time'), { target: { value: start } });
      fireEvent.change(screen.getByLabelText('End Time'), { target: { value: end } });
    };

    it('creates a slot and shows it in the list', async () => {
      const user = userEvent.setup();
      await openCapacityPage({
        'POST /api/slots': () => {
          slots = [slot(1, 12, 13)];
          return { status: 201, body: slots[0] };
        },
      });

      await user.click(screen.getByRole('button', { name: 'Create New Slot' }));
      fillSlotForm('12:00', '13:00');
      await user.click(screen.getByRole('button', { name: 'Create Slot' }));

      expect(await screen.findByText(NOON)).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByLabelText('Start Time')).not.toBeInTheDocument());
      expect(JSON.parse(calls('POST', '/api/slots')[0][1].body)).toEqual({ startAt: at(12), endAt: at(13) });
    });

    it.each([
      ['the end is not after the start', '13:00', '12:00', 'End time must be after start time.'],
      ['the slot starts in the past', '08:00', '10:00', 'The slot must start in the future.'],
    ])('shows an error and sends nothing when %s', async (_label, start, end, message) => {
      const user = userEvent.setup();
      await openCapacityPage();

      await user.click(screen.getByRole('button', { name: 'Create New Slot' }));
      fillSlotForm(start, end);
      await user.click(screen.getByRole('button', { name: 'Create Slot' }));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(calls('POST', '/api/slots')).toHaveLength(0);
    });

    it('shows a friendly message when the slot overlaps another one', async () => {
      const user = userEvent.setup();
      await openCapacityPage({ 'POST /api/slots': { status: 409, body: { error: 'SLOT_OVERLAP' } } });

      await user.click(screen.getByRole('button', { name: 'Create New Slot' }));
      fillSlotForm('12:00', '13:00');
      await user.click(screen.getByRole('button', { name: 'Create Slot' }));

      expect(await screen.findByText('This time slot overlaps with an existing slot.')).toBeInTheDocument();
      expect(screen.getByLabelText('Start Time')).toBeInTheDocument(); // the form stays open
    });

    it('closes the form with Cancel without sending anything', async () => {
      const user = userEvent.setup();
      await openCapacityPage();

      await user.click(screen.getByRole('button', { name: 'Create New Slot' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByLabelText('Start Time')).not.toBeInTheDocument();
      expect(calls('POST', '/api/slots')).toHaveLength(0);
    });
  });

  describe('assigning tables to a slot', () => {
    it('assigns the selected tables to an empty slot', async () => {
      const user = userEvent.setup();
      slots = [slot(1, 12, 13)];
      await openCapacityPage({
        'POST /api/slots/1/tables': () => {
          slots = [slot(1, 12, 13, [T1, T3])];
          return { status: 201, body: slots[0] };
        },
      });
      const card = slotCard(NOON);

      await user.click(card.getByRole('button', { name: 'Assign Tables' }));
      expect(card.getByRole('button', { name: 'Save Tables' })).toBeDisabled();
      await user.click(card.getByRole('checkbox', { name: /^T1/ }));
      await user.click(card.getByRole('checkbox', { name: /^T3/ }));
      await user.click(card.getByRole('button', { name: 'Save Tables' }));

      expect(await card.findByText('Table set configured')).toBeInTheDocument();
      expect(JSON.parse(calls('POST', '/api/slots/1/tables')[0][1].body)).toEqual({ tableIds: [1, 3] });
    });

    it('shows a friendly message when two tables have the same code', async () => {
      const user = userEvent.setup();
      slots = [slot(1, 12, 13)];
      await openCapacityPage({
        'POST /api/slots/1/tables': { status: 400, body: { error: 'DUPLICATE_TABLE_CODE' } },
      });
      const card = slotCard(NOON);

      await user.click(card.getByRole('button', { name: 'Assign Tables' }));
      await user.click(card.getByRole('checkbox', { name: /^T1/ }));
      await user.click(card.getByRole('checkbox', { name: /^T2/ }));
      await user.click(card.getByRole('button', { name: 'Save Tables' }));

      expect(await card.findByText('You cannot assign two tables with the same code to the same slot.')).toBeInTheDocument();
      expect(card.getByText('No tables assigned · Not bookable')).toBeInTheDocument();
    });

    it('shows a message when the catalogue has no tables', async () => {
      const user = userEvent.setup();
      slots = [slot(1, 12, 13)];
      tables = [];
      await openCapacityPage();
      const card = slotCard(NOON);

      await user.click(card.getByRole('button', { name: 'Assign Tables' }));

      expect(card.getByText('No tables available.')).toBeInTheDocument();
      expect(card.getByRole('button', { name: 'Save Tables' })).toBeDisabled();
    });
  });

  describe('copying tables from another slot', () => {
    it('copies the tables of a configured slot', async () => {
      const user = userEvent.setup();
      slots = [slot(1, 12, 13, [T1, T2]), slot(2, 19, 21)];
      await openCapacityPage({
        'POST /api/slots/2/copy-tables': () => {
          slots = [slots[0], slot(2, 19, 21, [T1, T2])];
          return { status: 201, body: slots[1] };
        },
      });
      const card = slotCard(EVENING);

      await user.click(card.getByRole('button', { name: 'Assign Tables' }));
      await user.click(card.getByRole('button', { name: 'Copy Tables' })); // mode tab
      expect(card.getByRole('option', { name: /12:00 \| 2 tables/ })).toBeInTheDocument();

      // in copy mode two buttons are called "Copy Tables": the tab and the action (the last one)
      const copyButton = () => card.getAllByRole('button', { name: 'Copy Tables' }).at(-1);
      expect(copyButton()).toBeDisabled();
      await user.selectOptions(card.getByRole('combobox'), '1');
      await user.click(copyButton());

      expect(await card.findByText('Table set configured')).toBeInTheDocument();
      expect(JSON.parse(calls('POST', '/api/slots/2/copy-tables')[0][1].body)).toEqual({ fromSlotId: 1 });
    });

    it('tells the user when there is no configured slot to copy from', async () => {
      const user = userEvent.setup();
      slots = [slot(1, 12, 13)];
      await openCapacityPage();
      const card = slotCard(NOON);

      await user.click(card.getByRole('button', { name: 'Assign Tables' }));
      await user.click(card.getByRole('button', { name: 'Copy Tables' }));

      expect(card.getByText('No configured source slots available.')).toBeInTheDocument();
    });

    it('shows the server error when the copy fails', async () => {
      const user = userEvent.setup();
      slots = [slot(1, 12, 13, [T1, T2]), slot(2, 19, 21)];
      await openCapacityPage({
        'POST /api/slots/2/copy-tables': { status: 409, body: { error: 'SLOT_HAS_RESERVATIONS' } },
      });
      const card = slotCard(EVENING);

      await user.click(card.getByRole('button', { name: 'Assign Tables' }));
      await user.click(card.getByRole('button', { name: 'Copy Tables' }));
      await user.selectOptions(card.getByRole('combobox'), '1');
      await user.click(card.getAllByRole('button', { name: 'Copy Tables' }).at(-1));

      expect(await card.findByText('SLOT_HAS_RESERVATIONS')).toBeInTheDocument();
      expect(card.getByText('No tables assigned · Not bookable')).toBeInTheDocument();
    });
  });

  describe('creating a table', () => {
    // The labels of this form are not linked to the inputs, so the fields are found by placeholder
    async function openCreateTableForm(user, card) {
      await user.click(card.getByRole('button', { name: 'Assign Tables' }));
      await user.click(card.getByRole('button', { name: '+ Create New Table' }));
    }

    it('creates a table and adds it to the selectable list', async () => {
      const user = userEvent.setup();
      slots = [slot(1, 12, 13)];
      await openCapacityPage({
        'POST /api/tables': () => {
          const created = { tableId: 9, code: 'T9', seats: 4 };
          tables = [...tables, created];
          return { status: 201, body: created };
        },
      });
      const card = slotCard(NOON);
      await openCreateTableForm(user, card);

      await user.type(card.getByPlaceholderText('e.g. T1'), 'T9');
      await user.type(card.getByPlaceholderText('e.g. 4'), '4');
      await user.click(card.getByRole('button', { name: 'Create Table' }));

      expect(await card.findByRole('checkbox', { name: /^T9/ })).toBeInTheDocument();
      expect(card.queryByPlaceholderText('e.g. T1')).not.toBeInTheDocument(); // form closed
      expect(JSON.parse(calls('POST', '/api/tables')[0][1].body)).toEqual({ code: 'T9', seats: 4 });
    });

    it('rejects a code made only of spaces without calling the server', async () => {
      const user = userEvent.setup();
      slots = [slot(1, 12, 13)];
      await openCapacityPage();
      const card = slotCard(NOON);
      await openCreateTableForm(user, card);

      await user.type(card.getByPlaceholderText('e.g. T1'), '   ');
      await user.type(card.getByPlaceholderText('e.g. 4'), '4');
      await user.click(card.getByRole('button', { name: 'Create Table' }));

      expect(await card.findByText('Table code must contain between 1 and 20 characters.')).toBeInTheDocument();
      expect(calls('POST', '/api/tables')).toHaveLength(0);
    });

    it('shows a message when the table already exists', async () => {
      const user = userEvent.setup();
      slots = [slot(1, 12, 13)];
      await openCapacityPage({ 'POST /api/tables': { status: 409, body: { error: 'TABLE_ALREADY_EXISTS' } } });
      const card = slotCard(NOON);
      await openCreateTableForm(user, card);

      await user.type(card.getByPlaceholderText('e.g. T1'), 'T1');
      await user.type(card.getByPlaceholderText('e.g. 4'), '4');
      await user.click(card.getByRole('button', { name: 'Create Table' }));

      expect(
        await card.findByText('A table with this code and number of seats already exists.')
      ).toBeInTheDocument();

      expect(card.getByPlaceholderText('e.g. T1')).toBeInTheDocument(); // the form stays open
    });

    it('closes the form with Cancel', async () => {
      const user = userEvent.setup();
      slots = [slot(1, 12, 13)];
      await openCapacityPage();
      const card = slotCard(NOON);
      await openCreateTableForm(user, card);

      // two buttons are called "Cancel" (the slot toggle and the table form): the last one is the form's
      await user.click(card.getAllByRole('button', { name: 'Cancel' }).at(-1));

      expect(card.queryByPlaceholderText('e.g. T1')).not.toBeInTheDocument();
    });
  });
});
