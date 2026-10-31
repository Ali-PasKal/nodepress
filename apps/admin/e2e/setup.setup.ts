import { rm } from 'node:fs/promises';
import { E2E_MAIL_DIR, E2E_SETUP_TOKEN, OWNER } from './constants';
import { expect, test } from './helpers';

test('completes the setup wizard once', async ({ page }) => {
  await rm(E2E_MAIL_DIR, { recursive: true, force: true });
  await page.goto('/admin/');
  await expect(page).toHaveURL(/\/admin\/setup$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Set up NEXORA' })).toBeVisible();

  // Step 1: environment checks.
  await expect(page.getByText('Database connection')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2: site.
  await page.getByLabel('Site name').fill('E2E Site');
  await page.getByLabel('Public base URL').fill('http://127.0.0.1:4199');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: administrator (client-side validation first).
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Name is required.')).toBeVisible();
  await page.getByLabel('Your name').fill(OWNER.name);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
  await page.getByLabel('Confirm password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 4: a wrong token is rejected by the API; the right one installs.
  await expect(page.getByText('Super Administrator')).toBeVisible();
  await page.getByLabel('Setup token').fill('this-is-not-the-setup-token');
  await page.getByRole('button', { name: 'Install NEXORA' }).click();
  await expect(page.getByText('The setup token is not valid', { exact: false })).toBeVisible();
  await page.getByLabel('Setup token').fill(E2E_SETUP_TOKEN);
  await page.getByRole('button', { name: 'Install NEXORA' }).click();
  await expect(page.getByRole('heading', { name: 'NEXORA is installed' })).toBeVisible();

  // The wizard is now permanently closed.
  await page.goto('/admin/setup');
  await expect(page).toHaveURL(/\/admin\/login$/);
});
