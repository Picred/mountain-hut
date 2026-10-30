import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import authAPI from '../../../frontend/src/api/auth_api';
import LoginForm from '../../../frontend/src/components/AuthComponents/LoginForm';
import RegisterForm from '../../../frontend/src/components/AuthComponents/RegistrationForm';

// Navigation is mocked: the components are tested alone, without real routes
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}));

const SERVER_URL = 'http://localhost:3001';

function mockResponse({ ok = true, status = 200, body = {}, invalidJson = false } = {}) {
  return {
    ok,
    status,
    json: invalidJson
      ? vi.fn().mockRejectedValue(new SyntaxError('Unexpected token'))
      : vi.fn().mockResolvedValue(body),
  };
}

// Promise that stays pending until resolve() is called, to inspect the loading state
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// MemoryRouter only provides the context needed by <Link>
const renderForm = (element) => render(<MemoryRouter>{element}</MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('authAPI', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('register sends a POST to /api/users with the default role and returns the created user', async () => {
    const user = { user_id: 1, name: 'Mario Rossi', email: 'mario@example.com', role: 'hiker' };
    fetchMock.mockResolvedValue(mockResponse({ status: 201, body: user }));

    const result = await authAPI.register('Mario Rossi', 'mario@example.com', '3331234567', 'secret1');

    expect(result).toEqual(user);
    expect(fetchMock).toHaveBeenCalledWith(`${SERVER_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name: 'Mario Rossi',
        email: 'mario@example.com',
        phone: '3331234567',
        password: 'secret1',
        role: 'hiker',
      }),
    });
  });

  it('login sends a POST to /api/sessions with the credentials and returns the user', async () => {
    const user = { user_id: 1, email: 'mario@example.com' };
    fetchMock.mockResolvedValue(mockResponse({ status: 201, body: user }));

    const result = await authAPI.login('mario@example.com', 'secret1');

    expect(result).toEqual(user);
    expect(fetchMock).toHaveBeenCalledWith(`${SERVER_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: 'mario@example.com', password: 'secret1' }),
    });
  });

  it('getCurrentUser returns the logged user sending the session cookie', async () => {
    const user = { user_id: 1, email: 'mario@example.com' };
    fetchMock.mockResolvedValue(mockResponse({ body: user }));

    await expect(authAPI.getCurrentUser()).resolves.toEqual(user);
    expect(fetchMock).toHaveBeenCalledWith(`${SERVER_URL}/api/sessions/current`, {
      method: 'GET',
      credentials: 'include',
    });
  });

  it('getCurrentUser returns null when the user is not authenticated (401)', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 401 }));

    await expect(authAPI.getCurrentUser()).resolves.toBeNull();
  });

  it('logout sends a DELETE to /api/sessions/current and returns true', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 204 }));

    await expect(authAPI.logout()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(`${SERVER_URL}/api/sessions/current`, {
      method: 'DELETE',
      credentials: 'include',
    });
  });

  // All four functions share the same error handling: it is checked once
  it('throws the error sent by the server', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 409, body: { error: 'Email già in uso' } }));

    await expect(authAPI.register('Mario', 'mario@example.com', '333', 'secret1')).rejects.toThrow('Email già in uso');
  });

  it('throws a default message when the error body is not valid JSON', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 500, invalidJson: true }));

    await expect(authAPI.login('mario@example.com', 'secret1')).rejects.toThrow('Errore durante il login');
  });
});

describe('LoginForm', () => {
  async function fillForm(user) {
    await user.type(screen.getByPlaceholderText('mario@example.com'), 'mario@example.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'secret1');
  }

  it('calls onLogin with the typed email and password', async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn().mockResolvedValue();
    renderForm(<LoginForm onLogin={onLogin} />);

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onLogin).toHaveBeenCalledWith('mario@example.com', 'secret1');
  });

  it('disables the submit button while the login is pending', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    renderForm(<LoginForm onLogin={() => pending.promise} />);

    await fillForm(user);
    const submit = screen.getByRole('button', { name: 'Log in' });
    await user.click(submit);

    expect(submit).toBeDisabled();
    pending.resolve();
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeEnabled();
  });

  it('does not submit when the required fields are empty', async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    renderForm(<LoginForm onLogin={onLogin} />);

    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(onLogin).not.toHaveBeenCalled();
  });

  it('navigates to the homepage with the back button', async () => {
    const user = userEvent.setup();
    renderForm(<LoginForm onLogin={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Torna indietro' }));

    expect(navigate).toHaveBeenCalledWith('/');
  });
});

describe('RegisterForm', () => {
  it('calls onRegister with name, email, phone and password', async () => {
    const user = userEvent.setup();
    const onRegister = vi.fn().mockResolvedValue();
    renderForm(<RegisterForm onRegister={onRegister} />);

    await user.type(screen.getByPlaceholderText('Mario Rossi'), 'Mario Rossi');
    await user.type(screen.getByPlaceholderText('mario@example.com'), 'mario@example.com');
    await user.type(screen.getByPlaceholderText('333 1234567'), '3331234567');
    await user.type(screen.getByPlaceholderText('••••••••'), 'secret1');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    expect(onRegister).toHaveBeenCalledTimes(1);
    expect(onRegister).toHaveBeenCalledWith('Mario Rossi', 'mario@example.com', '3331234567', 'secret1');
  });

  // jsdom does not enforce minLength on typed values, so the constraint is checked on the input itself
  it('requires all fields and a password of at least 6 characters', () => {
    renderForm(<RegisterForm onRegister={vi.fn()} />);

    for (const placeholder of ['Mario Rossi', 'mario@example.com', '333 1234567', '••••••••']) {
      expect(screen.getByPlaceholderText(placeholder)).toBeRequired();
    }
    expect(screen.getByPlaceholderText('••••••••')).toHaveAttribute('minLength', '6');
  });
});
