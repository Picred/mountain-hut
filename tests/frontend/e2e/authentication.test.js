import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001';

// Creates a unique user through the API. The `request` fixture has its own
// context, so the browser (`page`) stays unauthenticated.
async function createUser(request) {
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const user = {
    name: 'Mario Rossi',
    email: `mario.${unique}@example.com`,
    phone: '3331234567',
    password: 'password123',
  };
  const res = await request.post(`${API}/api/users`, { data: user });
  expect(res.status()).toBe(201);
  return user;
}

async function login(page, { email, password }) {
  await page.goto('/login');
  await page.getByPlaceholder('mario@example.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
}

async function fillRegister(page, { name, email, phone, password }) {
  await page.goto('/register');
  await page.getByPlaceholder('Mario Rossi').fill(name);
  await page.getByPlaceholder('mario@example.com').fill(email);
  await page.getByPlaceholder('333 1234567').fill(phone);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Register', exact: true }).click();
}

test.describe('Login', () => {
  test('logs in successfully and redirects to the home page', async ({ page, request }) => {
    const user = await createUser(request);
    await login(page, user);

    await expect(page).toHaveURL('/');

    // Check that a session really exists (the Navbar has no "logged in" state yet)
    const res = await page.request.get(`${API}/api/sessions/current`);
    expect(res.status()).toBe(200);
    expect((await res.json()).email).toBe(user.email);
  });

  test('wrong credentials: stays on /login and shows an error', async ({ page, request }) => {
    const user = await createUser(request);
    await login(page, { email: user.email, password: 'wrong_password' });

    await expect(page).toHaveURL('/login');
    // ASSUMPTION: the app displays the backend message (which is in Italian).
    // Adjust the text if you use a toast/alert or translate the backend messages.
    await expect(page.getByText(/non valide|invalid|credenziali/i)).toBeVisible();
  });

  test('submit button is disabled while the request is in progress', async ({ page, request }) => {
    const user = await createUser(request);
    // Delay the response so the loading state can be observed
    await page.route('**/api/sessions', async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      await route.continue();
    });
    await login(page, user);

    await expect(page.locator('button[type="submit"]')).toBeDisabled();
  });

  test('"Register now" link leads to the registration page', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Register now' }).click();
    await expect(page).toHaveURL('/register');
  });

  test('back button returns to the home page', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Torna indietro' }).click();
    await expect(page).toHaveURL('/');
  });
});

test.describe('Registration', () => {
  test('registers successfully (automatic login)', async ({ page }) => {
    await fillRegister(page, {
      name: 'Luigi Verdi',
      email: `luigi.${Date.now()}@example.com`,
      phone: '3339876543',
      password: 'password123',
    });

    // ASSUMPTION: after registration the user is redirected to the home page
    await expect(page).toHaveURL('/');

    const res = await page.request.get(`${API}/api/sessions/current`);
    expect(res.status()).toBe(200);
  });

  test('email already in use: stays on /register and shows an error', async ({ page, request }) => {
    const user = await createUser(request);
    await fillRegister(page, user);

    await expect(page).toHaveURL('/register');
    // Backend message ("Email già in uso")
    await expect(page.getByText(/email già in uso/i)).toBeVisible();
  });

  test('password shorter than 6 characters: the browser blocks the submission', async ({ page }) => {
    let requestSent = false;
    page.on('request', (req) => {
      if (req.url().includes('/api/users') && req.method() === 'POST') requestSent = true;
    });

    await fillRegister(page, {
      name: 'Anna Neri',
      email: `anna.${Date.now()}@example.com`,
      phone: '3330000000',
      password: '123',
    });

    await expect(page).toHaveURL('/register');
    await expect(page.locator('input[type="password"]:invalid')).toHaveCount(1);
    expect(requestSent).toBe(false);
  });

  test('empty required fields: no request is sent', async ({ page }) => {
    await page.goto('/register');
    await page.getByRole('button', { name: 'Register', exact: true }).click();

    await expect(page).toHaveURL('/register');
    await expect(page.locator('input:invalid')).not.toHaveCount(0);
  });
});

test.describe('Current session', () => {
  test('without login: returns 401', async ({ page }) => {
    const res = await page.request.get(`${API}/api/sessions/current`);
    expect(res.status()).toBe(401);
  });

  test('session persists after a page reload', async ({ page, request }) => {
    const user = await createUser(request);
    await login(page, user);
    await expect(page).toHaveURL('/');

    await page.reload();

    const res = await page.request.get(`${API}/api/sessions/current`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ email: user.email, name: user.name, role: 'hiker' });
  });
});

test.describe('Logout', () => {
 
  test('logout ends the session', async ({ page, request }) => {
    const user = await createUser(request);
    await login(page, user);
    await expect(page).toHaveURL('/');

    await page.getByRole('button', { name: 'User Avatar' }).click(); // opens the dropdown
    await page.getByRole('button', { name: 'Logout' }).click();

    const res = await page.request.get(`${API}/api/sessions/current`);
    expect(res.status()).toBe(401);
  });
});