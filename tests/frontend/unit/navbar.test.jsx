
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { Navbar } from '../../../frontend/src/components/Navbar';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}));

const HIKER = {
  user_id: 1,
  name: 'Mario Rossi',
  role: 'hiker',
};

const EMPLOYEE = {
  user_id: 2,
  name: 'Anna Winden',
  role: 'employee',
};

function renderNavbar({ user = null, loggedIn = false, onLogout = vi.fn() } = {}) {
  return render(
    <MemoryRouter>
      <Navbar user={user} loggedIn={loggedIn} onLogout={onLogout} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('Navbar', () => {
  it('shows login and reservation options to guests', () => {
    renderNavbar();

    expect(screen.getAllByRole('button', { name: 'Login' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Reserve a table|Book/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
  });

  it('shows the logged-in user and logout option', () => {
    renderNavbar({ user: HIKER, loggedIn: true });

    expect(screen.getByText('Mario Rossi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Login' })).not.toBeInTheDocument();
  });

  it('hides the reservation button for employees', () => {
    renderNavbar({ user: EMPLOYEE, loggedIn: true });

    expect(screen.getByText('Anna Winden')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reserve a table|Book/ })).not.toBeInTheDocument();
  });

  it('navigates to the homepage when the logo is clicked', async () => {
    const user = userEvent.setup();
    renderNavbar();

    await user.click(screen.getByRole('button', { name: 'Mountain Hut' }));

    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('navigates to reservations when the booking button is clicked', async () => {
    const user = userEvent.setup();
    renderNavbar({ user: HIKER, loggedIn: true });

    await user.click(screen.getByRole('button', { name: /Reserve a table|Book/ }));

    expect(navigate).toHaveBeenCalledWith('/reservations');
  });

  it('navigates to My reservations when clicked by a hiker', async () => {
    const user = userEvent.setup();
    renderNavbar({ user: HIKER, loggedIn: true });

    await user.click(screen.getByRole('button', { name: 'My reservations' }));

    expect(navigate).toHaveBeenCalledWith('/my-reservations');
  });

  describe('Navbar while the password must be changed', () => {
    it('hides the reservation button and My reservations to a hiker', () => {
      renderNavbar({ user: { ...HIKER, passwordToChange: true }, loggedIn: true });

      expect(screen.queryByRole('button', { name: /Reserve a table|Book/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'My reservations' })).not.toBeInTheDocument();
    });

    it('hides the new reservation button and the capacity management to an employee', () => {
      renderNavbar({ user: { ...EMPLOYEE, passwordToChange: true }, loggedIn: true });

      expect(screen.queryByRole('button', { name: /New reservation/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Capacity Management' })).not.toBeInTheDocument();
    });

    it('still lets the user log out', async () => {
      const user = userEvent.setup();
      const onLogout = vi.fn();
      renderNavbar({ user: { ...HIKER, passwordToChange: true }, loggedIn: true, onLogout });

      await user.click(screen.getByRole('button', { name: 'Logout' }));

      expect(onLogout).toHaveBeenCalled();
    });

    it('shows everything again once the password is changed', () => {
      renderNavbar({ user: { ...HIKER, passwordToChange: false }, loggedIn: true });

      expect(screen.getByRole('button', { name: /Reserve a table|Book/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'My reservations' })).toBeInTheDocument();
    });
  });

});
