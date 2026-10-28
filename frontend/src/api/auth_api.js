const SERVER_URL = "http://localhost:3001";

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
    throw new Error(errorData.message || errorData.error || 'Errore durante la registrazione');
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
    throw new Error(errorData.message || errorData.error || 'Errore durante il login');
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
    throw new Error(errorData.message || errorData.error || 'Errore durante il recupero della sessione');
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
    throw new Error(errorData.message || errorData.error || 'Errore durante il logout');
  }

  return true;
}

const authAPI = { register, login, logout, getCurrentUser };
export default authAPI;