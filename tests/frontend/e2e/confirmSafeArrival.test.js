import { test, expect } from '@playwright/test';

const API = 'http://localhost:3002';
const HIKER = { email: 'anna@mountainhut.test', password: 'password' };
const EMPLOYEE = { email: 'employee@mountainhut.test', password: 'password' };

async function loginUser(page, { email, password }) {
  await page.goto('/login');
  await page.getByPlaceholder('mario@example.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL('/');
}

const at = (offsetDays, hours) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hours, 0, 0, 0);
  return d.toISOString();
};

test.describe('My Hikes - Confirm Safe Arrival (E2E)', () => {
  test('access control: unauthenticated users are redirected to login and employees to home', async ({ page }) => {
    await page.goto('/my-hikes');
    await expect(page).toHaveURL(/\/login/);

    await loginUser(page, EMPLOYEE);
    await page.goto('/my-hikes');
    await expect(page).toHaveURL('/');
  });

  test('hiker navigates to My Hikes from the user menu and sees registered hikes', async ({ page }) => {
    await loginUser(page, HIKER);

    await page.getByRole('button', { name: 'Anna Winden' }).click();
    await page.getByRole('button', { name: 'My hikes' }).click();
    await expect(page).toHaveURL('/my-hikes');

    await expect(page.getByRole('heading', { name: 'My hikes' })).toBeVisible();
    await expect(page.getByText('View your registered hikes and confirm when you have arrived safely.')).toBeVisible();

    await expect(page.getByText('Lake Chiaretto')).toBeVisible();
  });

  test('hiker confirms safe arrival for a scheduled hike', async ({ page }) => {
    const loginRes = await page.request.post(`${API}/api/sessions`, {
      data: { email: HIKER.email, password: HIKER.password },
    });
    expect(loginRes.status()).toBe(201);

    const createRes = await page.request.post(`${API}/api/hikes`, {
      data: {
        destination: 'Monte Viso Safe Journey',
        route: 'Normal path to refuge and back',
        scheduledDeparture: at(10, 7),
        expectedArrival: at(10, 16),
        partySize: 2,
        passages: ['Refuge Point', 'Summit Crossing'],
      },
    });
    expect(createRes.status()).toBe(201);
    const createdHike = await createRes.json();

    await loginUser(page, HIKER);
    await page.goto('/my-hikes');

    const hikeCard = page.locator('article').filter({ hasText: `Hike #${createdHike.hikeId}` });
    await expect(hikeCard).toBeVisible();
    await expect(hikeCard).toContainText('scheduled');
    await expect(hikeCard).toContainText('Monte Viso Safe Journey');
    await expect(hikeCard).toContainText('Normal path to refuge and back');
    await expect(hikeCard).toContainText('Refuge Point');
    await expect(hikeCard).toContainText('Summit Crossing');

    const confirmButton = hikeCard.getByRole('button', { name: 'Confirm safe arrival' });
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    await expect(page.getByRole('status')).toHaveText(`Hike #${createdHike.hikeId} has been marked as safely returned.`);
    await expect(hikeCard).toContainText('returned');
    await expect(hikeCard.getByRole('button', { name: 'Confirm safe arrival' })).not.toBeVisible();

    await page.reload();
    const reloadedCard = page.locator('article').filter({ hasText: `Hike #${createdHike.hikeId}` });
    await expect(reloadedCard).toContainText('returned');
    await expect(reloadedCard.getByRole('button', { name: 'Confirm safe arrival' })).not.toBeVisible();
  });

  test('returned hikes do not display the confirmation button', async ({ page }) => {
    await loginUser(page, HIKER);
    await page.goto('/my-hikes');

    const completedCard = page.locator('article').filter({ hasText: 'Pian del Re' });
    await expect(completedCard).toBeVisible();
    await expect(completedCard).toContainText('returned');
    await expect(completedCard.getByRole('button', { name: 'Confirm safe arrival' })).not.toBeVisible();
  });
});
