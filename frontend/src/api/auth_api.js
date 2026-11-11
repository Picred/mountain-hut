const SERVER_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

// 1. REGISTRAZIONE
async function register(name, email, phone, password, role = 'hiker') {
  const response = await fetch(`${SERVER_URL}/api/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ name, email, phone, password, role }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || 'Registration failed');
  }

  return await response.json();
}

// 2. LOGIN
async function login(email, password) {
  const response = await fetch(`${SERVER_URL}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || 'Login failed');
  }

  return await response.json();
}

// 3. RECUPERO UTENTE CORRENTE
async function getCurrentUser() {
  const response = await fetch(`${SERVER_URL}/api/sessions/current`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 401) {
      return null;
    }
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || 'Failed to retrieve the session');
  }

  return await response.json();
}

// 4. LOGOUT
async function logout() {
  const response = await fetch(`${SERVER_URL}/api/sessions/current`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || 'Logout failed');
  }

  return true;
}

// 5. CHANGE PASSWORD (mandatory after temporary password)
async function changePassword(newPassword) {
  const response = await fetch(`${SERVER_URL}/api/users/password`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ newPassword }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || 'Password change failed');
  }

  // The updated user, with passwordToChange set to false
  return await response.json();
}

// 6. RECOVER PASSWORD
async function resetPassword(email) {
  const response = await fetch(`${SERVER_URL}/api/users/password-reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || 'Password recovery failed');
  }

  return true;
}

// 7. NEW PASSWORD FROM THE RECOVERY LINK
async function confirmPasswordReset(token, newPassword) {

  const response = await fetch(`${SERVER_URL}/api/users/password-reset/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ token, newPassword }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (errorData.error === 'INVALID_OR_EXPIRED_TOKEN') {
      throw new Error('This link is invalid or has expired. Request a new one.');
    }
    if (errorData.error === 'INVALID_OR_EXPIRED_TOKEN' || errorData.error === 'INVALID_INPUT') {
      throw new Error('This link is invalid or has expired. Request a new one.');
    }
    throw new Error(errorData.message || errorData.error || 'Password reset failed');
  }

  return true;
}

const authAPI = { register, login, logout, getCurrentUser, changePassword, resetPassword, confirmPasswordReset };
export default authAPI;