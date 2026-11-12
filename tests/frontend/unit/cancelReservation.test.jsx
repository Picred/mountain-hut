import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { cancelHikerReservation } = await vi.importActual(
    '../../../frontend/src/api/booking_api'
);

import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';


const SERVER_URL = 'http://localhost:3001/api';

const mockResponse = ({
    ok = true,
    status = 200,
    body = {},
    invalidJson = false,
} = {}) => ({
    ok,
    status,
    json: invalidJson
        ? vi.fn().mockRejectedValue(new SyntaxError('Invalid JSON'))
        : vi.fn().mockResolvedValue(body),
});


const bookingAPI = vi.hoisted(() => ({
    getHikerReservations: vi.fn(),
    updateHikerReservation: vi.fn(),
    cancelHikerReservation: vi.fn(),
}));

const reservationAPI = vi.hoisted(() => ({
    listAvailableSlots: vi.fn(),
}));

vi.mock('../../../frontend/src/api/booking_api', async (importOriginal) => ({
    ...(await importOriginal()),
    getHikerReservations: bookingAPI.getHikerReservations,
    updateHikerReservation: bookingAPI.updateHikerReservation,
    cancelHikerReservation: bookingAPI.cancelHikerReservation,
}));

vi.mock('../../../frontend/src/api/reservation_api', () => ({
    listAvailableSlots: reservationAPI.listAvailableSlots,
}));

import { MyReservationsPage } from '../../../frontend/src/pages/MyReservationsPage';


describe('booking_api – cancelHikerReservation', () => {
    let fetchMock;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends DELETE to the correct reservation endpoint with credentials', async () => {
        const cancelledReservation = {
            reservationId: 42,
            status: 'cancelled',
        };

        fetchMock.mockResolvedValue(
            mockResponse({ body: cancelledReservation })
        );

        const result = await cancelHikerReservation(42);

        expect(result).toEqual(cancelledReservation);

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledWith(
            `${SERVER_URL}/reservations/42`,
            {
                method: 'DELETE',
                credentials: 'include',
            }
        );
    });

    it('converts the reservation id to a number', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({
                body: { reservationId: 42, status: 'cancelled' },
            })
        );

        await cancelHikerReservation('42');

        expect(fetchMock).toHaveBeenCalledWith(
            `${SERVER_URL}/reservations/42`,
            expect.objectContaining({ method: 'DELETE' })
        );
    });

    it('throws an authentication error on 401', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({ ok: false, status: 401 })
        );

        await expect(cancelHikerReservation(42))
            .rejects.toThrow('Please log in to manage your reservations.');
    });

    it('throws an authorization error on 403', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({ ok: false, status: 403 })
        );

        await expect(cancelHikerReservation(42))
            .rejects.toThrow('You can only change your own reservations.');
    });

    it('handles a reservation that does not exist', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({
                ok: false,
                status: 404,
                body: { error: 'RESERVATION_NOT_FOUND' },
            })
        );

        await expect(cancelHikerReservation(42))
            .rejects.toThrow('This reservation could not be found.');
    });

    it('handles a reservation that cannot be cancelled', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({
                ok: false,
                status: 404,
                body: { error: 'RESERVATION_NOT_CANCELLABLE' },
            })
        );

        await expect(cancelHikerReservation(42))
            .rejects.toThrow(
                'This reservation has already been cancelled or can no longer be cancelled.'
            );
    });

    it('handles invalid reservation input', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({
                ok: false,
                status: 400,
                body: { error: 'INVALID_INPUT' },
            })
        );

        await expect(cancelHikerReservation(0))
            .rejects.toThrow(
                'Some booking details are invalid. Please review them and try again.'
            );
    });

    it('returns a generic error for unexpected server failures', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({ ok: false, status: 500 })
        );

        await expect(cancelHikerReservation(42))
            .rejects.toThrow('Something went wrong. Please try again.');
    });

    it('handles an invalid JSON error response', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({
                ok: false,
                status: 500,
                invalidJson: true,
            })
        );

        await expect(cancelHikerReservation(42))
            .rejects.toThrow('Something went wrong. Please try again.');
    });

    // Optional rule: cancellation is forbidden once the slot has started.
    // Enable this test together with the RESERVATION_ALREADY_STARTED
    // error mapping in frontend/src/api/booking_api.js.
    /*
    it('handles cancellation after the booked slot has started', async () => {
        fetchMock.mockResolvedValue(
            mockResponse({
                ok: false,
                status: 409,
                body: { error: 'RESERVATION_ALREADY_STARTED' },
            })
        );

        await expect(cancelHikerReservation(42))
            .rejects.toThrow(
                'This reservation can no longer be cancelled because the booked time slot has already started.'
            );
    });
    */
});


const sampleReservation = {
    reservationId: 42,
    slotId: 10,
    startAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    partySize: 2,
    status: 'confirmed',
    requirements: [],
    tableAllocation: [
        { tableId: 1, tableCode: 'A1', allocatedSeats: 2 },
    ],
};

describe('MyReservationsPage – cancellation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        bookingAPI.getHikerReservations.mockResolvedValue([sampleReservation]);
        bookingAPI.cancelHikerReservation.mockResolvedValue({
            reservationId: 42,
            status: 'cancelled',
        });
        reservationAPI.listAvailableSlots.mockResolvedValue([]);
    });

    afterEach(() => {
        cleanup();
    });

    it.each(['confirmed', 'waiting'])(
        'shows the cancel button for a %s reservation',
        async (status) => {
            bookingAPI.getHikerReservations.mockResolvedValue([
                { ...sampleReservation, status },
            ]);

            render(<MyReservationsPage />);

            expect(
                await screen.findByRole('button', { name: 'Cancel booking' })
            ).toBeInTheDocument();
        }
    );

    it('does not show the cancel button for an already cancelled reservation', async () => {
        bookingAPI.getHikerReservations.mockResolvedValue([
            { ...sampleReservation, status: 'cancelled' },
        ]);

        render(<MyReservationsPage />);

        expect(
            await screen.findByText('This reservation has been cancelled.')
        ).toBeInTheDocument();

        expect(
            screen.queryByRole('button', { name: 'Cancel booking' })
        ).not.toBeInTheDocument();
    });

    it('allows cancellation less than 48 hours before the booked slot', async () => {
        bookingAPI.getHikerReservations.mockResolvedValue([
            {
                ...sampleReservation,
                startAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            },
        ]);

        render(<MyReservationsPage />);

        expect(
            await screen.findByRole('button', { name: 'Cancel booking' })
        ).toBeInTheDocument();

        expect(
            screen.queryByRole('button', { name: 'Change reservation' })
        ).not.toBeInTheDocument();
    });

    it('opens the cancellation confirmation dialog', async () => {
        const user = userEvent.setup();
        render(<MyReservationsPage />);

        await user.click(
            await screen.findByRole('button', { name: 'Cancel booking' })
        );

        const dialog = screen.getByRole('dialog');

        expect(
            within(dialog).getByRole('heading', { name: 'Cancel reservation?' })
        ).toBeInTheDocument();

        expect(dialog).toHaveTextContent('Are you sure you want to cancel reservation');
        expect(dialog).toHaveTextContent('#42?');
        expect(dialog).toHaveTextContent('This action cannot be undone.');
    });

    it('closes the dialog without cancelling when Keep reservation is clicked', async () => {
        const user = userEvent.setup();
        render(<MyReservationsPage />);

        await user.click(
            await screen.findByRole('button', { name: 'Cancel booking' })
        );

        await user.click(
            screen.getByRole('button', { name: 'Keep reservation' })
        );

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(bookingAPI.cancelHikerReservation).not.toHaveBeenCalled();
    });

    it('cancels the reservation after confirmation', async () => {
        const user = userEvent.setup();

        bookingAPI.getHikerReservations
            .mockResolvedValueOnce([sampleReservation])
            .mockResolvedValueOnce([
                {
                    ...sampleReservation,
                    status: 'cancelled',
                    tableAllocation: [],
                },
            ]);

        render(<MyReservationsPage />);

        await user.click(
            await screen.findByRole('button', { name: 'Cancel booking' })
        );

        await user.click(
            screen.getByRole('button', { name: 'Yes, cancel booking' })
        );

        await waitFor(() => {
            expect(bookingAPI.cancelHikerReservation).toHaveBeenCalledWith(42);
        });

        expect(
            await screen.findByRole('status')
        ).toHaveTextContent(
            'Reservation #42 has been cancelled successfully.'
        );

        await waitFor(() => {
            expect(bookingAPI.getHikerReservations).toHaveBeenCalledTimes(2);
        });

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Cancel booking' })
        ).not.toBeInTheDocument();
    });

    it('displays an error and keeps the dialog open when cancellation fails', async () => {
        const user = userEvent.setup();

        bookingAPI.cancelHikerReservation.mockRejectedValue(
            new Error('Cancellation failed')
        );

        render(<MyReservationsPage />);

        await user.click(
            await screen.findByRole('button', { name: 'Cancel booking' })
        );

        await user.click(
            screen.getByRole('button', { name: 'Yes, cancel booking' })
        );

        expect(
            await screen.findByRole('alert')
        ).toHaveTextContent('Cancellation failed');

        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('keeps the successful cancellation when refreshing the list fails', async () => {
        const user = userEvent.setup();

        bookingAPI.getHikerReservations
            .mockResolvedValueOnce([sampleReservation])
            .mockRejectedValueOnce(new Error('Network error'));

        render(<MyReservationsPage />);

        await user.click(
            await screen.findByRole('button', { name: 'Cancel booking' })
        );

        await user.click(
            screen.getByRole('button', { name: 'Yes, cancel booking' })
        );

        expect(
            await screen.findByRole('status')
        ).toHaveTextContent(
            'Reservation #42 has been cancelled successfully.'
        );

        expect(
            await screen.findByRole('alert')
        ).toHaveTextContent(
            'The reservation was cancelled, but the list could not be refreshed: Network error'
        );

        expect(
            screen.queryByRole('button', { name: 'Cancel booking' })
        ).not.toBeInTheDocument();
    });

    // Optional rule: cancellation is forbidden once the booked slot has started.
    // Enable this test together with the time restriction in MyReservationsPage.jsx.
    /*
    it('does not allow cancellation after the booked slot has started', async () => {
        bookingAPI.getHikerReservations.mockResolvedValue([
            {
                ...sampleReservation,
                startAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            },
        ]);

        render(<MyReservationsPage />);

        expect(
            await screen.findByText('Reservation #42')
        ).toBeInTheDocument();

        expect(
            screen.queryByRole('button', { name: 'Cancel booking' })
        ).not.toBeInTheDocument();
    });
    */
});

