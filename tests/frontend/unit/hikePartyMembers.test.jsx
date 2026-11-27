import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('react-router', async (importOriginal) => ({
    ...(await importOriginal()),
    useNavigate: () => vi.fn(),
}));

vi.mock('../../../frontend/src/api/hike_api', () => ({
    default: {
        registerHike: vi.fn(),
        getHikerHikes: vi.fn(),
        confirmHikeArrival: vi.fn(),
        getActiveHikes: vi.fn(),
    },
}));

import hikeAPI from '../../../frontend/src/api/hike_api';
import { HikeRegistrationPage } from '../../../frontend/src/pages/HikeRegistrationPage';
import { MyHikesPage } from '../../../frontend/src/pages/MyHikesPage';
import { ActiveHikesPage } from '../../../frontend/src/pages/ActiveHikesPage';

const MARCO = { name: 'Marco Rossi', phone: '+393331111111' };
const GIULIA = { name: 'Giulia Bianchi', phone: null };
const LUCA = { name: 'Luca Verdi', phone: '+393332222222' };

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    cleanup();
});

// ============================================================
// HIKE REGISTRATION: party members
// ============================================================

describe('HikeRegistrationPage: party members', () => {
    const renderPage = () =>
        render(
            <MemoryRouter>
                <HikeRegistrationPage />
            </MemoryRouter>
        );

    const addMemberButton = () => screen.getByRole('button', { name: /add member/i });
    const submitButton = () => screen.getByRole('button', { name: /register hike/i });
    const submitForm = () => fireEvent.submit(submitButton().closest('form'));

    // fills the required fields; the party size is changed only if given
    const fillHike = async (user, { partySize } = {}) => {
        await user.type(screen.getByLabelText(/destination/i), 'Monte Viso');
        await user.type(screen.getByLabelText(/route/i), 'Normal route');
        await user.type(screen.getByLabelText(/scheduled departure/i), '2099-06-01T08:00');
        await user.type(screen.getByLabelText(/expected arrival/i), '2099-06-01T17:00');

        if (partySize !== undefined) {
            await setPartySize(user, partySize);
        }
    };

    const setPartySize = async (user, value) => {
        const input = screen.getByLabelText(/party size/i);
        await user.clear(input);
        await user.type(input, String(value));
    };

    // adds a member and fills its fields (the member form fields are in the order they were added)
    const addMember = async (user, { name, phone }) => {
        await user.click(addMemberButton());

        const nameInputs = screen.getAllByLabelText(/^name/i);
        const phoneInputs = screen.getAllByLabelText(/^phone/i);

        if (name) await user.type(nameInputs.at(-1), name);
        if (phone) await user.type(phoneInputs.at(-1), phone);
    };

    const sentHike = () => hikeAPI.registerHike.mock.calls[0][0];

    it('registers a hike without any member', async () => {
        const user = userEvent.setup();
        hikeAPI.registerHike.mockResolvedValueOnce({ hikeId: 1 });
        renderPage();

        await fillHike(user);
        submitForm();

        await waitFor(() => expect(hikeAPI.registerHike).toHaveBeenCalledTimes(1));
        expect(sentHike().members).toEqual([]);
    });

    it('sends a member who has only a name, with the phone as null', async () => {
        const user = userEvent.setup();
        hikeAPI.registerHike.mockResolvedValueOnce({ hikeId: 1 });
        renderPage();

        await fillHike(user, { partySize: 2 });
        await addMember(user, { name: 'Giulia Bianchi' });
        submitForm();

        await waitFor(() => expect(hikeAPI.registerHike).toHaveBeenCalledTimes(1));
        expect(sentHike().members).toEqual([GIULIA]);
    });

    it('sends the name and the phone of a member without the surrounding spaces', async () => {
        const user = userEvent.setup();
        hikeAPI.registerHike.mockResolvedValueOnce({ hikeId: 1 });
        renderPage();

        await fillHike(user, { partySize: 2 });
        await addMember(user, { name: '  Marco Rossi ', phone: ' +393331111111  ' });
        submitForm();

        await waitFor(() => expect(hikeAPI.registerHike).toHaveBeenCalledTimes(1));
        expect(sentHike().members).toEqual([MARCO]);
    });

    it('registers a hike with details of only some of the members (partial details)', async () => {
        const user = userEvent.setup();
        hikeAPI.registerHike.mockResolvedValueOnce({ hikeId: 1 });
        renderPage();

        await fillHike(user, { partySize: 4 });
        await addMember(user, { name: 'Marco Rossi', phone: '+393331111111' });
        submitForm();

        await waitFor(() => expect(hikeAPI.registerHike).toHaveBeenCalledTimes(1));
        expect(sentHike().partySize).toBe(4);
        expect(sentHike().members).toEqual([MARCO]);
    });

    it('sends the members in the order they were added', async () => {
        const user = userEvent.setup();
        hikeAPI.registerHike.mockResolvedValueOnce({ hikeId: 1 });
        renderPage();

        await fillHike(user, { partySize: 4 });
        await addMember(user, { name: 'Luca Verdi', phone: '+393332222222' });
        await addMember(user, { name: 'Marco Rossi', phone: '+393331111111' });
        submitForm();

        await waitFor(() => expect(hikeAPI.registerHike).toHaveBeenCalledTimes(1));
        expect(sentHike().members).toEqual([LUCA, MARCO]);
    });

    it('does not allow more members than the other people of the party', async () => {
        const user = userEvent.setup();
        renderPage();

        // the hiker who registers the hike is not a member: a party of one has nobody else
        expect(addMemberButton()).toBeDisabled();

        await setPartySize(user, 3);
        expect(addMemberButton()).toBeEnabled();

        await addMember(user, { name: 'Marco Rossi' });
        expect(addMemberButton()).toBeEnabled();

        await addMember(user, { name: 'Luca Verdi' });
        expect(addMemberButton()).toBeDisabled();
        expect(screen.getAllByLabelText(/^name/i)).toHaveLength(2);
    });

    it('allows adding a member again after one is removed', async () => {
        const user = userEvent.setup();
        renderPage();

        await setPartySize(user, 2);
        await addMember(user, { name: 'Marco Rossi' });
        expect(addMemberButton()).toBeDisabled();

        await user.click(screen.getByRole('button', { name: /remove member 1/i }));

        expect(screen.queryByLabelText(/^name/i)).not.toBeInTheDocument();
        expect(addMemberButton()).toBeEnabled();
    });

    it('does not send a member that has been removed', async () => {
        const user = userEvent.setup();
        hikeAPI.registerHike.mockResolvedValueOnce({ hikeId: 1 });
        renderPage();

        await fillHike(user, { partySize: 3 });
        await addMember(user, { name: 'Marco Rossi', phone: '+393331111111' });
        await addMember(user, { name: 'Luca Verdi', phone: '+393332222222' });

        await user.click(screen.getByRole('button', { name: /remove member 1/i }));
        submitForm();

        await waitFor(() => expect(hikeAPI.registerHike).toHaveBeenCalledTimes(1));
        expect(sentHike().members).toEqual([LUCA]);
    });

    it('does not register the hike if the party size is lowered below the number of members', async () => {
        const user = userEvent.setup();
        renderPage();

        await fillHike(user, { partySize: 3 });
        await addMember(user, { name: 'Marco Rossi' });
        await addMember(user, { name: 'Luca Verdi' });

        await setPartySize(user, 2);
        submitForm();

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(hikeAPI.registerHike).not.toHaveBeenCalled();
    });

    it('does not register the hike if a member has no name', async () => {
        const user = userEvent.setup();
        renderPage();

        await fillHike(user, { partySize: 3 });
        await addMember(user, { name: 'Marco Rossi' });
        await addMember(user, { phone: '+393332222222' });
        submitForm();

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(hikeAPI.registerHike).not.toHaveBeenCalled();
    });

    it('keeps the members entered when the registration fails', async () => {
        const user = userEvent.setup();
        hikeAPI.registerHike.mockRejectedValueOnce(new Error('Something went wrong'));
        renderPage();

        await fillHike(user, { partySize: 3 });
        await addMember(user, { name: 'Marco Rossi', phone: '+393331111111' });
        await addMember(user, { name: 'Luca Verdi' });
        submitForm();

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.getAllByLabelText(/^name/i).map(input => input.value)).toEqual([
            'Marco Rossi',
            'Luca Verdi',
        ]);
        expect(screen.getAllByLabelText(/^phone/i)[0]).toHaveValue('+393331111111');
    });

    it('shows the members of the registered hike in the confirmation', async () => {
        const user = userEvent.setup();
        hikeAPI.registerHike.mockResolvedValueOnce({
            hikeId: 42,
            destination: 'Monte Viso',
            route: 'Normal route',
            scheduledDeparture: '2099-06-01T08:00:00.000Z',
            expectedArrival: '2099-06-01T17:00:00.000Z',
            partySize: 4,
            passages: [],
            members: [MARCO, GIULIA],
            status: 'scheduled',
        });
        renderPage();

        await fillHike(user, { partySize: 4 });
        await addMember(user, { name: 'Marco Rossi', phone: '+393331111111' });
        await addMember(user, { name: 'Giulia Bianchi' });
        submitForm();

        expect(await screen.findByText(/Marco Rossi/)).toBeInTheDocument();
        expect(screen.getByText(/\+393331111111/)).toBeInTheDocument();
        expect(screen.getByText(/Giulia Bianchi/)).toBeInTheDocument();
    });
});

// ============================================================
// MY HIKES: party members
// ============================================================

describe('MyHikesPage: party members', () => {
    const makeHike = (overrides = {}) => ({
        hikeId: 1,
        destination: 'Monte Viso',
        route: 'Normal route',
        passages: [],
        scheduledDeparture: '2099-06-01T08:00:00.000Z',
        expectedArrival: '2099-06-01T17:00:00.000Z',
        partySize: 4,
        members: [],
        status: 'scheduled',
        createdAt: '2099-05-01T10:00:00.000Z',
        ...overrides,
    });

    it('shows the members of a hike, with the phone when it is known', async () => {
        hikeAPI.getHikerHikes.mockResolvedValueOnce([makeHike({ members: [MARCO, GIULIA] })]);

        render(<MyHikesPage />);

        expect(await screen.findByText(/Marco Rossi/)).toBeInTheDocument();
        expect(screen.getByText(/\+393331111111/)).toBeInTheDocument();
        expect(screen.getByText(/Giulia Bianchi/)).toBeInTheDocument();
    });

    it('shows each member with the hike it belongs to', async () => {
        hikeAPI.getHikerHikes.mockResolvedValueOnce([
            makeHike({ hikeId: 1, destination: 'Monte Viso', members: [MARCO] }),
            makeHike({ hikeId: 2, destination: 'Lago Fiorenza', members: [LUCA] }),
        ]);

        render(<MyHikesPage />);

        const [first, second] = await screen.findAllByRole('article');

        expect(within(first).getByText(/Marco Rossi/)).toBeInTheDocument();
        expect(within(first).queryByText(/Luca Verdi/)).not.toBeInTheDocument();
        expect(within(second).getByText(/Luca Verdi/)).toBeInTheDocument();
        expect(within(second).queryByText(/Marco Rossi/)).not.toBeInTheDocument();
    });

    it('shows a hike without members', async () => {
        hikeAPI.getHikerHikes.mockResolvedValueOnce([makeHike({ members: [] })]);

        render(<MyHikesPage />);

        expect(await screen.findByText(/Monte Viso/)).toBeInTheDocument();
        expect(screen.queryByText(/party members/i)).not.toBeInTheDocument();
    });
});

// ============================================================
// ACTIVE HIKES (employee): party members
// ============================================================

describe('ActiveHikesPage: party members', () => {
    const makeActiveHike = (overrides = {}) => ({
        hikeId: 1,
        destination: 'Monte Viso',
        route: 'Normal route',
        passages: [],
        scheduledDeparture: '2099-06-01T08:00:00.000Z',
        expectedArrival: '2099-06-01T17:00:00.000Z',
        partySize: 4,
        members: [],
        status: 'scheduled',
        createdAt: '2099-05-01T10:00:00.000Z',
        isOverdue: false,
        hiker: {
            userId: 10,
            name: 'Mario Rossi',
            email: 'mario@example.com',
            phone: '123456789',
            notes: null,
            emergencyContact: null,
        },
        ...overrides,
    });

    const openDetails = async (user, index = 0) => {
        const buttons = await screen.findAllByRole('button', { name: /details/i });
        await user.click(buttons[index]);
    };

    it('shows the members of a hike only in its details', async () => {
        const user = userEvent.setup();
        hikeAPI.getActiveHikes.mockResolvedValueOnce([makeActiveHike({ members: [MARCO, GIULIA] })]);

        render(<ActiveHikesPage />);

        await screen.findByText(/Monte Viso/);
        expect(screen.queryByText(/Marco Rossi/)).not.toBeInTheDocument();

        await openDetails(user);

        expect(screen.getByText(/Marco Rossi/)).toBeInTheDocument();
        expect(screen.getByText(/\+393331111111/)).toBeInTheDocument();
        expect(screen.getByText(/Giulia Bianchi/)).toBeInTheDocument();
    });

    it('shows the members of the opened hike only', async () => {
        const user = userEvent.setup();
        hikeAPI.getActiveHikes.mockResolvedValueOnce([
            makeActiveHike({ hikeId: 1, members: [MARCO] }),
            makeActiveHike({ hikeId: 2, members: [LUCA] }),
        ]);

        render(<ActiveHikesPage />);

        await openDetails(user, 1);

        expect(screen.getByText(/Luca Verdi/)).toBeInTheDocument();
        expect(screen.queryByText(/Marco Rossi/)).not.toBeInTheDocument();
    });

    it('opens the details of a hike without members', async () => {
        const user = userEvent.setup();
        hikeAPI.getActiveHikes.mockResolvedValueOnce([makeActiveHike({ members: [] })]);

        render(<ActiveHikesPage />);

        await openDetails(user);

        expect(screen.getByRole('button', { name: /hide details/i })).toBeInTheDocument();
        expect(screen.queryByText(/Marco Rossi/)).not.toBeInTheDocument();
    });

    it('does not show the party members for a hiker who is alone', async () => {
        const user = userEvent.setup();
        hikeAPI.getActiveHikes.mockResolvedValueOnce([makeActiveHike({ partySize: 1, members: [] })]);

        render(<ActiveHikesPage />);

        await openDetails(user);

        expect(screen.queryByText(/party members/i)).not.toBeInTheDocument();
    });
});
