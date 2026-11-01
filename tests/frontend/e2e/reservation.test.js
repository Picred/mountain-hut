import { test, expect } from '@playwright/test';

const API = 'http://localhost:3002'; // e2e backend, see playwright.config.js

// Helper to create a unique test user via API
async function createUniqueUser(request) {
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const user = {
    name: 'Test Hiker',
    email: `hiker.${unique}@example.com`,
    phone: '3331112233',
    password: 'password123',
  };
  const res = await request.post(`${API}/api/users`, { data: user });
  expect(res.status()).toBe(201);
  return user;
}

// Helper to log in through the UI
async function loginUser(page, { email, password }) {
  await page.goto('/login');
  await page.getByPlaceholder('mario@example.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
}

// Format local date as YYYY-MM-DD
function getLocalDateKey(offsetDays = 1) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

test.describe('Reservation Flow (E2E)', () => {
  test('unauthenticated user is redirected to /login when navigating to /reservations', async ({ page }) => {
    await page.goto('/reservations');
    // Protected route redirects unauthenticated visitor to login
    await expect(page).toHaveURL(/\/login/);
  });

  test('authenticated user can select date, slot, party size and book a table', async ({ page, request }) => {
    // 1. Register a fresh user
    const user = await createUniqueUser(request);

    // 2. Log in through UI
    await loginUser(page, user);
    await expect(page).toHaveURL('/');

    // 3. Navigate to /reservations
    await page.goto('/reservations');
    await expect(page).toHaveURL('/reservations');
    await expect(page.getByRole('heading', { name: 'Reserve your table' })).toBeVisible();

    // 4. Select tomorrow on the calendar (navigate to next month if across month boundary)
    const tomorrowKey = getLocalDateKey(1);
    const dateButton = page.locator(`button[aria-label^="${tomorrowKey}"]`);

    if (!(await dateButton.isVisible())) {
      await page.getByRole('button', { name: 'Next month' }).click();
    }

    await expect(dateButton).toBeVisible();
    await dateButton.click();

    // 5. Wait for slots to load and select the first available slot
    const slotButton = page.locator('button:has-text("–"), button:has-text("-")').first();
    await expect(slotButton).toBeVisible();
    await slotButton.click();

    // 6. Adjust party size: click "+" to increase to 2 guests
    const plusButton = page.getByRole('button', { name: 'Add one guest' });
    await plusButton.click();
    const guestCounter = page.locator('div:has(> button[aria-label="Add one guest"]) > span');
    await expect(guestCounter).toHaveText('2');

    // 7. Submit reservation
    const reserveButton = page.getByRole('button', { name: /Check & Reserve|Checking reservation/i });
    await expect(reserveButton).toBeEnabled();
    await reserveButton.click();

    // 8. Verify confirmation screen
    await expect(page.getByText(/Reservation confirmed!/i)).toBeVisible();
    await expect(page.getByText(/Reservation code/i)).toBeVisible();

    // 9. Click return to homepage
    await page.getByRole('button', { name: 'Return to homepage' }).click();
    await expect(page).toHaveURL('/');
  });
});
