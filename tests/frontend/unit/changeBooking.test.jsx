
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const bookingAPI = vi.hoisted(() => ({
    getHikerReservations: vi.fn(),
    updateHikerReservation: vi.fn(),
}));

const reservationAPI = vi.hoisted(() => ({
    listAvailableSlots: vi.fn(),
}));

vi.mock('../../../frontend/src/api/booking_api', () => ({
    getHikerReservations: bookingAPI.getHikerReservations,
    updateHikerReservation: bookingAPI.updateHikerReservation,
}));

vi.mock('../../../frontend/src/api/reservation_api', () => ({
    listAvailableSlots: reservationAPI.listAvailableSlots,
}));

import { MyReservationsPage } from '../../../frontend/src/pages/MyReservationsPage';

const reservation = {
    reservationId: 1,
    slotId: 10,
    // More than 48 hours ahead, so the reservation can still be changed
    startAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    partySize: 2,
    status: 'confirmed',
    requirements: [],
    tableAllocation: [],
};

const slots = [
    {
        slotId: 10,
        startTime: '18:00',
        endTime: '19:00',
        availableSeats: 4,
        bookingAllowed: true,
    },
    {
        slotId: 11,
        startTime: '19:00',
        endTime: '20:00',
        availableSeats: 4,
        bookingAllowed: true,
    },
];

beforeEach(() => {
    vi.clearAllMocks();
    bookingAPI.getHikerReservations.mockResolvedValue([reservation]);
    reservationAPI.listAvailableSlots.mockResolvedValue(slots);
});

afterEach(() => {
    cleanup();
});

describe('MyReservationsPage', () => {
    it('loads and displays reservations', async () => {
        render(<MyReservationsPage />);

        expect(
            await screen.findByText('Reservation #1')
        ).toBeInTheDocument();

        expect(bookingAPI.getHikerReservations).toHaveBeenCalledOnce();
    });

    it('displays an empty state when there are no reservations', async () => {
        bookingAPI.getHikerReservations.mockResolvedValue([]);

        render(<MyReservationsPage />);

        expect(
            await screen.findByText('No reservations yet')
        ).toBeInTheDocument();
    });

    it('displays an error when reservations cannot be loaded', async () => {
        bookingAPI.getHikerReservations.mockRejectedValue(
            new Error('Network error')
        );

        render(<MyReservationsPage />);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Network error'
        );
    });

    it('does not allow changes less than 48 hours before the booked slot', async () => {
        bookingAPI.getHikerReservations.mockResolvedValue([{
            ...reservation,
            startAt: new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString(),
        }]);

        render(<MyReservationsPage />);

        expect(
            await screen.findByText('Changes are no longer allowed less than 48 hours before the booked date.')
        ).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Change reservation' })
        ).not.toBeInTheDocument();
    });

    it('opens the reservation editor', async () => {
        const user = userEvent.setup();

        render(<MyReservationsPage />);

        await user.click(
            await screen.findByRole('button', {
                name: 'Change reservation',
            })
        );

        expect(
            screen.getByRole('dialog')
        ).toBeInTheDocument();

        expect(
            screen.getByRole('heading', {
                name: 'Change your booking',
            })
        ).toBeInTheDocument();
    });

    it('updates a reservation successfully', async () => {
        const user = userEvent.setup();

        render(<MyReservationsPage />);

        await user.click(
            await screen.findByRole('button', {
                name: 'Change reservation',
            })
        );

        await waitFor(() => {
            expect(reservationAPI.listAvailableSlots).toHaveBeenCalled();
        });

        await user.selectOptions(
            screen.getByLabelText('Time slot'),
            '11'
        );

        await user.click(
            screen.getByRole('button', {
                name: 'Save changes',
            })
        );

        await waitFor(() => {
            expect(bookingAPI.updateHikerReservation).toHaveBeenCalledWith(
                1,
                { slotId: 11 }
            );
        });

        expect(
            await screen.findByRole('status')
        ).toHaveTextContent('Your reservation was updated.');
    });

    it('displays an error when the update fails', async () => {
        const user = userEvent.setup();

        bookingAPI.updateHikerReservation.mockRejectedValue(
            new Error('Update failed')
        );

        render(<MyReservationsPage />);

        await user.click(
            await screen.findByRole('button', {
                name: 'Change reservation',
            })
        );

        await waitFor(() => {
            expect(reservationAPI.listAvailableSlots).toHaveBeenCalled();
        });

        await user.selectOptions(
            screen.getByLabelText('Time slot'),
            '11'
        );

        await user.click(
            screen.getByRole('button', {
                name: 'Save changes',
            })
        );

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Update failed'
        );
    });
});
