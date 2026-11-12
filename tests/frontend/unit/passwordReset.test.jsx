import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import authAPI from '../../../frontend/src/api/auth_api';
import ForgotPasswordForm from '../../../frontend/src/components/AuthComponents/ForgotPasswordForm';
import ChangePasswordForm from '../../../frontend/src/components/AuthComponents/ChangePasswordForm';

const SERVER_URL = 'http://localhost:3001';

function mockResponse({ ok = true, status = 200, body = {} } = {}) {
  return { ok, status, json: vi.fn().mockResolvedValue(body) };
}

const renderForm = (element) => render(<MemoryRouter>{element}</MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('authAPI - password recovery', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('resetPassword sends a POST to /api/users/password-reset with the email', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 204 }));

    await expect(authAPI.resetPassword('anna@mountainhut.test')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(`${SERVER_URL}/api/users/password-reset`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'anna@mountainhut.test' }),
    }));
  });

  it('confirmPasswordReset sends the token and the new password', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 204 }));

    await expect(authAPI.confirmPasswordReset('abc123', 'new-secret')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(`${SERVER_URL}/api/users/password-reset/confirm`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: 'abc123', newPassword: 'new-secret' }),
    }));
  });

  it.each(['INVALID_OR_EXPIRED_TOKEN', 'INVALID_INPUT'])(
    'confirmPasswordReset turns %s into a readable message',
    async (error) => {
      fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 400, body: { error } }));

      await expect(authAPI.confirmPasswordReset('abc123', 'new-secret'))
        .rejects.toThrow('This link is invalid or has expired. Request a new one.');
    }
  );
});

describe('ForgotPasswordForm', () => {
  it('sends the trimmed email and says that a link has been sent', async () => {
    const user = userEvent.setup();
    const onResetPassword = vi.fn().mockResolvedValue(true);
    renderForm(<ForgotPasswordForm onResetPassword={onResetPassword} />);

    await user.type(screen.getByLabelText('Email address'), ' anna@mountainhut.test ');
    await user.click(screen.getByRole('button', { name: 'Send link' }));

    expect(onResetPassword).toHaveBeenCalledWith('anna@mountainhut.test');
    expect(await screen.findByRole('status')).toHaveTextContent('a link to choose a new password has been sent');
  });

  it('shows the error when the request fails', async () => {
    const user = userEvent.setup();
    renderForm(<ForgotPasswordForm onResetPassword={vi.fn().mockRejectedValue(new Error('Password recovery failed'))} />);

    await user.type(screen.getByLabelText('Email address'), 'anna@mountainhut.test');
    await user.click(screen.getByRole('button', { name: 'Send link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Password recovery failed');
  });
});

describe('ChangePasswordForm for the reset link', () => {
  it('shows the subtitle it receives instead of the default one', () => {
    renderForm(<ChangePasswordForm onChangePassword={vi.fn()} subtitle="The link is valid for 24 hours." />);

    expect(screen.getByText('The link is valid for 24 hours.')).toBeInTheDocument();
    expect(screen.queryByText(/You logged in with a temporary password/)).not.toBeInTheDocument();
  });
});