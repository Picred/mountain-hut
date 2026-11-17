import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../frontend/src/api/reservation_api', () => ({
    searchHikers: vi.fn(),
}));

import { searchHikers } from '../../../frontend/src/api/reservation_api';
import { HikerPicker } from '../../../frontend/src/components/HikerPicker';

describe('HikerPicker component', () => {
    let onChange;

    beforeEach(() => {
        vi.clearAllMocks();
        onChange = vi.fn();
    });

    afterEach(() => {
        cleanup();
    });

    it('renders tabs and defaults to "existing" tab calling onChange with null initially', () => {
        render(<HikerPicker onChange={onChange} />);

        expect(screen.getByRole('tab', { name: 'Existing hiker' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'New hiker' })).toHaveAttribute('aria-selected', 'false');
        expect(screen.getByRole('tab', { name: 'Quick entry' })).toHaveAttribute('aria-selected', 'false');

        expect(screen.getByLabelText(/Search by name, email or phone/i)).toBeInTheDocument();
        expect(onChange).toHaveBeenCalledWith(null);
    });

    describe('Existing hiker tab', () => {
        it('shows prompt to type at least 2 characters when search is short', async () => {
            const user = userEvent.setup();
            render(<HikerPicker onChange={onChange} />);

            const searchInput = screen.getByLabelText(/Search by name, email or phone/i);
            await user.type(searchInput, 'a');

            expect(screen.getByText(/Type at least 2 characters to search/i)).toBeInTheDocument();
            expect(searchHikers).not.toHaveBeenCalled();
        });

        it('searches hikers after debounce when 2 or more characters are entered', async () => {
            const user = userEvent.setup();
            const mockResults = [
                { userId: 1, name: 'Mario Rossi', email: 'mario@example.com', phone: '333111222' },
                { userId: 2, name: 'Mario Bianchi', email: 'bianchi@example.com', phone: '333444555' },
            ];
            searchHikers.mockResolvedValueOnce(mockResults);

            render(<HikerPicker onChange={onChange} />);
            const searchInput = screen.getByLabelText(/Search by name, email or phone/i);

            await user.type(searchInput, 'Mar');

            await waitFor(() => {
                expect(searchHikers).toHaveBeenCalledWith('Mar');
            });

            expect(await screen.findByText('Mario Rossi')).toBeInTheDocument();
            expect(screen.getByText('Mario Bianchi')).toBeInTheDocument();
        });

        it('shows "No hiker found" when search returns empty array', async () => {
            const user = userEvent.setup();
            searchHikers.mockResolvedValueOnce([]);

            render(<HikerPicker onChange={onChange} />);
            const searchInput = screen.getByLabelText(/Search by name, email or phone/i);

            await user.type(searchInput, 'NonExistent');

            expect(await screen.findByText(/No hiker found/i)).toBeInTheDocument();
        });

        it('shows error alert when searchHikers rejects', async () => {
            const user = userEvent.setup();
            searchHikers.mockRejectedValueOnce(new Error('Network error'));

            render(<HikerPicker onChange={onChange} />);
            const searchInput = screen.getByLabelText(/Search by name, email or phone/i);

            await user.type(searchInput, 'ErrorUser');

            expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
        });

        it('selects a hiker from results, calls onChange({ userId }), and allows clearing selection', async () => {
            const user = userEvent.setup();
            const mockResults = [
                { userId: 42, name: 'Anna Winden', email: 'anna@example.com', phone: '3456789' },
            ];
            searchHikers.mockResolvedValueOnce(mockResults);

            render(<HikerPicker onChange={onChange} />);
            const searchInput = screen.getByLabelText(/Search by name, email or phone/i);

            await user.type(searchInput, 'Anna');

            const hikerItem = await screen.findByRole('button', { name: /Anna Winden/i });
            await user.click(hikerItem);

            expect(screen.getByText('Selected hiker')).toBeInTheDocument();
            expect(onChange).toHaveBeenLastCalledWith({ userId: 42 });

            const changeBtn = screen.getByRole('button', { name: 'Change' });
            await user.click(changeBtn);

            expect(screen.queryByText('Selected hiker')).not.toBeInTheDocument();
            expect(onChange).toHaveBeenLastCalledWith(null);
        });
    });

    describe('New hiker tab', () => {
        it('switches to new hiker tab and calls onChange only when name, valid email, and phone are present', async () => {
            const user = userEvent.setup();
            render(<HikerPicker onChange={onChange} />);

            await user.click(screen.getByRole('tab', { name: 'New hiker' }));
            expect(onChange).toHaveBeenLastCalledWith(null);

            const nameInput = screen.getByLabelText(/^Name$/i);
            const emailInput = screen.getByLabelText(/^Email$/i);
            const phoneInput = screen.getByLabelText(/^Phone$/i);

            await user.type(nameInput, 'Luigi Verde');
            expect(onChange).toHaveBeenLastCalledWith(null);

            // Invalid email
            await user.type(emailInput, 'invalid-email');
            expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
            expect(onChange).toHaveBeenLastCalledWith(null);

            await user.clear(emailInput);
            await user.type(emailInput, 'luigi@example.com');
            expect(screen.queryByText('Enter a valid email address.')).not.toBeInTheDocument();
            expect(onChange).toHaveBeenLastCalledWith(null);

            await user.type(phoneInput, '+39333999888');
            expect(onChange).toHaveBeenLastCalledWith({
                name: 'Luigi Verde',
                email: 'luigi@example.com',
                phone: '+39333999888'
            });
        });
    });

    describe('Quick entry tab', () => {
        it('switches to quick entry tab and calls onChange with name (and optional phone)', async () => {
            const user = userEvent.setup();
            render(<HikerPicker onChange={onChange} />);

            await user.click(screen.getByRole('tab', { name: 'Quick entry' }));
            expect(onChange).toHaveBeenLastCalledWith(null);

            const nameInput = screen.getByLabelText(/^Name$/i);
            const phoneInput = screen.getByLabelText(/^Phone \(optional\)$/i);

            await user.type(nameInput, 'Quick Walker');
            expect(onChange).toHaveBeenLastCalledWith({ name: 'Quick Walker' });

            await user.type(phoneInput, '123456');
            expect(onChange).toHaveBeenLastCalledWith({
                name: 'Quick Walker',
                phone: '123456'
            });

            await user.clear(nameInput);
            expect(onChange).toHaveBeenLastCalledWith(null);
        });
    });
});
