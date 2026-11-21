import { test, expect } from '@playwright/test';

const API = 'http://localhost:3002';
const EMPLOYEE = { email: 'employee@mountainhut.test', password: 'password' };
const HIKER = { email: 'anna@mountainhut.test', password: 'password' };

async function loginUser(page, { email, password }) {
  await page.goto('/login');
  await page.getByPlaceholder('mario@example.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL('/');
}

function getLocalDateKey(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function at(offsetDays, hours) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hours, 0, 0, 0);
  return d.toISOString();
}

async function selectDate(page, key) {
  const dateButton = page.locator(`button[aria-label^="${key}"]`);
  while (!(await dateButton.isVisible())) {
    await page.getByRole('button', { name: 'Next month' }).click();
  }
  await dateButton.click();
}

test.describe('Monitor Occupancy (Frontend E2E)', () => {
  test('access control: unauthenticated users and hikers cannot access occupancy', async ({ page }) => {
    await page.goto('/occupancy');
    await expect(page).toHaveURL(/\/login/);

    await loginUser(page, HIKER);
    await page.goto('/occupancy');
    await expect(page).toHaveURL('/');
  });

  test('access control: employees can open occupancy', async ({ page }) => {
    await loginUser(page, EMPLOYEE);
    await page.goto('/occupancy');
    await expect(page).toHaveURL('/occupancy');
    await expect(page.getByRole('heading', { name: 'Occupancy' })).toBeVisible();
  });

  test('employee navigates to occupancy page from the user menu in the navbar', async ({ page }) => {
    await loginUser(page, EMPLOYEE);

    await page.getByRole('button', { name: 'Carl Smith' }).click();
    await page.getByRole('button', { name: 'Monitor occupancy' }).click();

    await expect(page).toHaveURL('/occupancy');
    await expect(page.getByRole('heading', { name: 'Occupancy' })).toBeVisible();
    await expect(
      page.getByText('Check how booked and free seats are distributed across the tables of every time slot.')
    ).toBeVisible();
  });

  test('employee views slot occupancy summary and expands table details', async ({ page }) => {
    const day = 45;
    const dateKeyStr = getLocalDateKey(day);

    const employeeSession = await page.request.post(`${API}/api/sessions`, {
      data: { email: EMPLOYEE.email, password: EMPLOYEE.password },
    });
    expect(employeeSession.status()).toBe(201);

    const slotStart = at(day, 12);
    const slotEnd = at(day, 13);
    const createdSlotRes = await page.request.post(`${API}/api/slots`, {
      data: { startAt: slotStart, endAt: slotEnd },
    });
    expect(createdSlotRes.status()).toBe(201);
    const createdSlot = await createdSlotRes.json();

    const assignTablesRes = await page.request.post(`${API}/api/slots/${createdSlot.slotId}/tables`, {
      data: { tableIds: [1, 4] },
    });
    expect(assignTablesRes.status()).toBe(201);

    const hikerSession = await page.request.post(`${API}/api/sessions`, {
      data: { email: HIKER.email, password: HIKER.password },
    });
    expect(hikerSession.status()).toBe(201);

    const bookingRes = await page.request.post(`${API}/api/reservations`, {
      data: { slotId: createdSlot.slotId, partySize: 4 },
    });
    expect(bookingRes.status()).toBe(201);

    await loginUser(page, EMPLOYEE);
    await page.goto('/occupancy');

    await selectDate(page, dateKeyStr);

    const slotCard = page.locator('article').filter({ hasText: '12:00 – 13:00' });
    await expect(slotCard).toBeVisible();

    await expect(slotCard).toContainText('4 / 6 seats booked');
    await expect(slotCard).toContainText('(67%)');
    await expect(slotCard).toContainText('2 seats free');

    const detailsButton = slotCard.getByRole('button', { name: 'View details' });
    await expect(detailsButton).toBeVisible();
    await detailsButton.click();

    await expect(slotCard.getByRole('heading', { name: 'Tables' })).toBeVisible();
    await expect(slotCard.getByText('T1')).toBeVisible();
    await expect(slotCard.getByText('T4')).toBeVisible();

    const hideDetailsButton = slotCard.getByRole('button', { name: 'Hide details' });
    await expect(hideDetailsButton).toBeVisible();
    await hideDetailsButton.click();
    await expect(slotCard.getByRole('heading', { name: 'Tables' })).not.toBeVisible();
  });

  test('employee transitions from capacity management to occupancy view for a configured slot', async ({ page }) => {
    const day = 46;
    const dateKeyStr = getLocalDateKey(day);

    const employeeSession = await page.request.post(`${API}/api/sessions`, {
      data: { email: EMPLOYEE.email, password: EMPLOYEE.password },
    });
    expect(employeeSession.status()).toBe(201);

    const slotStart = at(day, 19);
    const slotEnd = at(day, 20);
    const createdSlotRes = await page.request.post(`${API}/api/slots`, {
      data: { startAt: slotStart, endAt: slotEnd },
    });
    expect(createdSlotRes.status()).toBe(201);
    const createdSlot = await createdSlotRes.json();

    await page.request.post(`${API}/api/slots/${createdSlot.slotId}/tables`, {
      data: { tableIds: [2] },
    });

    await loginUser(page, EMPLOYEE);
    await page.goto('/capacity');

    await selectDate(page, dateKeyStr);

    const capacityCard = page.locator('article').filter({ hasText: '19:00 – 20:00' });
    await expect(capacityCard).toBeVisible();

    const viewOccupancyLink = capacityCard.getByRole('button', { name: 'View occupancy' });
    await expect(viewOccupancyLink).toBeVisible();
    await viewOccupancyLink.click();

    await expect(page).toHaveURL('/occupancy');
    const occupancyCard = page.locator('article').filter({ hasText: '19:00 – 20:00' });
    await expect(occupancyCard).toBeVisible();
    await expect(occupancyCard.getByRole('heading', { name: 'Tables' })).toBeVisible();
  });
});
