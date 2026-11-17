import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-router', async (importOriginal) => ({
    ...(await importOriginal()),
    useNavigate: () => navigate,
}));

vi.mock('../../../frontend/src/api/hike_api', () => ({
    default: {
        registerHike: vi.fn(),
    },
}));

import hikeAPI from '../../../frontend/src/api/hike_api';
import { HikeRegistrationPage } from '../../../frontend/src/pages/HikeRegistrationPage';

function renderPage() {
    return render(
        <MemoryRouter>
            <HikeRegistrationPage />
        </MemoryRouter>
    );
}

describe('HikeRegistrationPage component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('renders the form with initial values and allows navigating back to homepage', async () => {
        const user = userEvent.setup();
        renderPage();

        expect(screen.getByRole('heading', { level: 1, name: 'Register a hike' })).toBeInTheDocument();
        expect(screen.getByLabelText(/Destination/i)).toHaveValue('');
        expect(screen.getByLabelText(/Route/i)).toHaveValue('');
        expect(screen.getByLabelText(/Scheduled departure/i)).toHaveValue('');
        expect(screen.getByLabelText(/Expected arrival/i)).toHaveValue('');
        expect(screen.getByLabelText(/Party size/i)).toHaveValue(1);

        const backBtn = screen.getByRole('button', { name: /Back to homepage/i });
        await user.click(backBtn);
        expect(navigate).toHaveBeenCalledWith('/');
    });

    it('allows adding and removing passages', async () => {
        const user = userEvent.setup();
        renderPage();

        expect(screen.queryByPlaceholderText('Passage 1')).not.toBeInTheDocument();

        const addPassageBtn = screen.getByRole('button', { name: '+ Add passage' });
        await user.click(addPassageBtn);

        expect(screen.getByPlaceholderText('Passage 1')).toBeInTheDocument();

        await user.type(screen.getByPlaceholderText('Passage 1'), 'Col A');
        await user.click(addPassageBtn);
        await user.type(screen.getByPlaceholderText('Passage 2'), 'Col B');

        await user.click(screen.getByRole('button', { name: 'Remove passage 1' }));

        expect(screen.queryByPlaceholderText('Passage 2')).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText('Passage 1')).toHaveValue('Col B');

        // passages are optional: the last one can be removed too
        await user.click(screen.getByRole('button', { name: 'Remove passage 1' }));

        expect(screen.queryByPlaceholderText('Passage 1')).not.toBeInTheDocument();
    });

    describe('client-side validations on form submission', () => {
        it('validates that empty required fields show error', () => {
            renderPage();

            const form = screen.getByRole('button', { name: 'Register hike' }).closest('form');
            fireEvent.submit(form);

            expect(screen.getByRole('alert')).toHaveTextContent('Complete all required fields.');
            expect(hikeAPI.registerHike).not.toHaveBeenCalled();
        });

        it('validates that empty passage fields prevent submission', async () => {
            const user = userEvent.setup();
            renderPage();

            await user.type(screen.getByLabelText(/Destination/i), 'Monte Rosa');
            await user.type(screen.getByLabelText(/Route/i), 'Normal route');
            await user.type(screen.getByLabelText(/Scheduled departure/i), '2028-06-01T08:00');
            await user.type(screen.getByLabelText(/Expected arrival/i), '2028-06-01T17:00');

            await user.click(screen.getByRole('button', { name: '+ Add passage' }));
            // Leave passage empty

            const form = screen.getByRole('button', { name: 'Register hike' }).closest('form');
            fireEvent.submit(form);

            expect(screen.getByRole('alert')).toHaveTextContent(
                'Remove empty passage fields or enter a passage name.'
            );
            expect(hikeAPI.registerHike).not.toHaveBeenCalled();
        });

        it('validates departure in the past', async () => {
            const user = userEvent.setup();
            renderPage();

            await user.type(screen.getByLabelText(/Destination/i), 'Monte Rosa');
            await user.type(screen.getByLabelText(/Route/i), 'Normal route');
            await user.type(screen.getByLabelText(/Scheduled departure/i), '2020-01-01T08:00');
            await user.type(screen.getByLabelText(/Expected arrival/i), '2028-06-01T17:00');

            const form = screen.getByRole('button', { name: 'Register hike' }).closest('form');
            fireEvent.submit(form);

            expect(screen.getByRole('alert')).toHaveTextContent('Departure must be in the future.');
            expect(hikeAPI.registerHike).not.toHaveBeenCalled();
        });

        it('validates arrival is after departure', async () => {
            const user = userEvent.setup();
            renderPage();

            await user.type(screen.getByLabelText(/Destination/i), 'Monte Rosa');
            await user.type(screen.getByLabelText(/Route/i), 'Normal route');
            await user.type(screen.getByLabelText(/Scheduled departure/i), '2028-06-01T17:00');
            await user.type(screen.getByLabelText(/Expected arrival/i), '2028-06-01T08:00');

            const form = screen.getByRole('button', { name: 'Register hike' }).closest('form');
            fireEvent.submit(form);

            expect(screen.getByRole('alert')).toHaveTextContent('Expected arrival must be after departure.');
            expect(hikeAPI.registerHike).not.toHaveBeenCalled();
        });

        it('validates party size is positive whole number', async () => {
            const user = userEvent.setup();
            renderPage();

            await user.type(screen.getByLabelText(/Destination/i), 'Monte Rosa');
            await user.type(screen.getByLabelText(/Route/i), 'Normal route');
            await user.type(screen.getByLabelText(/Scheduled departure/i), '2028-06-01T08:00');
            await user.type(screen.getByLabelText(/Expected arrival/i), '2028-06-01T17:00');

            await user.clear(screen.getByLabelText(/Party size/i));
            await user.type(screen.getByLabelText(/Party size/i), '0');

            const form = screen.getByRole('button', { name: 'Register hike' }).closest('form');
            fireEvent.submit(form);

            expect(screen.getByRole('alert')).toHaveTextContent('Party size must be a positive whole number.');
            expect(hikeAPI.registerHike).not.toHaveBeenCalled();
        });
    });

    describe('successful submission and success view', () => {
        it('submits form data and displays confirmation screen on success', async () => {
            const user = userEvent.setup();
            const mockRegisteredHike = {
                hikeId: 42,
                destination: 'Monte Viso',
                route: 'Pian del Re - Traversette',
                scheduledDeparture: '2028-06-01T08:00:00.000Z',
                expectedArrival: '2028-06-01T17:00:00.000Z',
                partySize: 2,
                passages: ['Passage A', 'Passage B'],
                status: 'scheduled'
            };
            hikeAPI.registerHike.mockResolvedValueOnce(mockRegisteredHike);

            renderPage();

            await user.type(screen.getByLabelText(/Destination/i), 'Monte Viso');
            await user.type(screen.getByLabelText(/Route/i), 'Pian del Re - Traversette');
            await user.type(screen.getByLabelText(/Scheduled departure/i), '2028-06-01T08:00');
            await user.type(screen.getByLabelText(/Expected arrival/i), '2028-06-01T17:00');
            await user.clear(screen.getByLabelText(/Party size/i));
            await user.type(screen.getByLabelText(/Party size/i), '2');

            await user.click(screen.getByRole('button', { name: '+ Add passage' }));
            await user.type(screen.getByPlaceholderText('Passage 1'), 'Passage A');

            await user.click(screen.getByRole('button', { name: '+ Add passage' }));
            await user.type(screen.getByPlaceholderText('Passage 2'), 'Passage B');

            const form = screen.getByRole('button', { name: 'Register hike' }).closest('form');
            fireEvent.submit(form);

            await waitFor(() => {
                expect(hikeAPI.registerHike).toHaveBeenCalledTimes(1);
            });

            expect(hikeAPI.registerHike).toHaveBeenCalledWith({
                destination: 'Monte Viso',
                route: 'Pian del Re - Traversette',
                scheduledDeparture: new Date('2028-06-01T08:00').toISOString(),
                expectedArrival: new Date('2028-06-01T17:00').toISOString(),
                partySize: 2,
                passages: ['Passage A', 'Passage B']
            });

            expect(await screen.findByRole('heading', { level: 1, name: 'Hike registered!' })).toBeInTheDocument();
            expect(screen.getByText('#42')).toBeInTheDocument();
            expect(screen.getByText('Passage A')).toBeInTheDocument();
            expect(screen.getByText('Passage B')).toBeInTheDocument();

            const returnHomeBtn = screen.getByRole('button', { name: 'Return to homepage' });
            await user.click(returnHomeBtn);
            expect(navigate).toHaveBeenCalledWith('/');
        });

        it('displays error message from API failure', async () => {
            const user = userEvent.setup();
            hikeAPI.registerHike.mockRejectedValueOnce(
                new Error('You already have another scheduled hike during this period. Choose a different time.')
            );

            renderPage();

            await user.type(screen.getByLabelText(/Destination/i), 'Monte Viso');
            await user.type(screen.getByLabelText(/Route/i), 'Pian del Re');
            await user.type(screen.getByLabelText(/Scheduled departure/i), '2028-06-01T08:00');
            await user.type(screen.getByLabelText(/Expected arrival/i), '2028-06-01T17:00');

            const form = screen.getByRole('button', { name: 'Register hike' }).closest('form');
            fireEvent.submit(form);

            expect(await screen.findByRole('alert')).toHaveTextContent(
                'You already have another scheduled hike during this period. Choose a different time.'
            );
        });
    });
});
