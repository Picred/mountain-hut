import { test, expect } from '@playwright/test';

const API = 'http://localhost:3002'; // e2e backend, see playwright.config.js
const EMPLOYEE = { email: 'employee@mountainhut.test', password: 'password' };
const HIKER = { email: 'anna@mountainhut.test', password: 'password' };

// Helper to log in through the UI
async function loginUser(page, { email, password }) {
  await page.goto('/login');
  await page.getByPlaceholder('mario@example.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL('/');
}

// Local date as YYYY-MM-DD and ISO timestamp of a local time, far from the demo slots
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

// Moves the calendar forward until the day is shown, then selects it
async function selectDate(page, key) {
  const dateButton = page.locator(`button[aria-label^="${key}"]`);
  while (!(await dateButton.isVisible())) {
    await page.getByRole('button', { name: 'Next month' }).click();
  }
  await dateButton.click();
}

async function createSlotFromUI(page, start, end) {
  await page.getByRole('button', { name: 'Create New Slot' }).click();
  await page.getByLabel('Start Time').fill(start);
  await page.getByLabel('End Time').fill(end);
  await page.getByRole('button', { name: 'Create Slot' }).click();
}

// Card of the slot with the given time range
const slotCard = (page, range) => page.locator('article').filter({ hasText: range });

// Checkbox of a table in the "Select available tables" list
const tableCheckbox = (card, code) =>
  card.locator('label', { has: card.page().getByText(code, { exact: true }) }).getByRole('checkbox');

test.describe('Capacity Management (E2E)', () => {
  test('only employees can open the capacity page', async ({ page }) => {
    await page.goto('/capacity');
    await expect(page).toHaveURL(/\/login/);

    await loginUser(page, HIKER);
    await page.goto('/capacity');
    await expect(page).toHaveURL('/');
  });

  test('employee creates a slot and assigns a set of tables, including a new one', async ({ page }) => {
    const code = 'T6';

    // 1. Log in and open the page from the navbar
    await loginUser(page, EMPLOYEE);
    await page.getByRole('button', { name: 'Carl Smith' }).click();
    await page.getByRole('button', { name: 'Capacity Management' }).click();
    await expect(page.getByRole('heading', { name: 'Slot Management' })).toBeVisible();

    // 2. Create a slot: it starts without tables
    await selectDate(page, getLocalDateKey(30));
    await createSlotFromUI(page, '12:00', '13:00');
    const card = slotCard(page, '12:00 – 13:00');
    await expect(card).toContainText('0 tables · 0 seats');
    await expect(card).toContainText('No tables assigned · Not bookable');

    // 3. Add a new table to the list and assign it together with T4 (2 seats)
    await card.getByRole('button', { name: 'Assign Tables' }).click();
    await card.getByRole('button', { name: '+ Create New Table' }).click();
    await card.getByPlaceholder('e.g. T1').fill(code);
    await card.getByPlaceholder('e.g. 4').fill('8');
    await card.getByRole('button', { name: 'Create Table' }).click();
    await tableCheckbox(card, code).check();
    await tableCheckbox(card, 'T4').check();
    await card.getByRole('button', { name: 'Save Tables' }).click();

    await expect(card).toContainText('2 tables · 10 seats');
    await expect(card).toContainText('Table set configured');

    // 4. Another slot in the same meal service cannot overlap it
    await createSlotFromUI(page, '12:30', '13:30');
    await expect(page.getByRole('alert')).toHaveText('This time slot overlaps with an existing slot.');
  });

  test('employee reuses the tables of a previous slot', async ({ page }) => {
    await loginUser(page, EMPLOYEE);
    const day = 31;

    // Lunch already configured with T2 + T3 (10 seats), dinner still empty
    const lunch = await (await page.request.post(`${API}/api/slots`, { data: { startAt: at(day, 12), endAt: at(day, 13) } })).json();
    await page.request.post(`${API}/api/slots/${lunch.slotId}/tables`, { data: { tableIds: [2, 3] } });
    await page.request.post(`${API}/api/slots`, { data: { startAt: at(day, 19), endAt: at(day, 20) } });

    await page.goto('/capacity');
    await selectDate(page, getLocalDateKey(day));
    const dinner = slotCard(page, '19:00 – 20:00');
    await dinner.getByRole('button', { name: 'Assign Tables' }).click();
    await dinner.getByRole('button', { name: 'Copy Tables' }).click();
    await dinner.getByRole('combobox').selectOption({
      label: `${new Date(lunch.startAt).toLocaleDateString('en-GB')} | 12:00 | 2 tables`,
    });
    await dinner.getByRole('button', { name: 'Copy Tables' }).last().click();

    await expect(dinner).toContainText('2 tables · 10 seats');
    await dinner.getByRole('button', { name: 'View Tables' }).click();
    await expect(dinner).toContainText('T2');
    await expect(dinner).toContainText('T3');
  });
});
