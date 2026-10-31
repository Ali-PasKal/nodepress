import { OWNER } from './constants';
import { expect, signIn, test } from './helpers';

test.describe('Authentication', () => {
  test('protected pages redirect to sign-in and return afterwards', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/admin\/login\?next=%2Fusers$/);
    await page.getByLabel('Email').fill(OWNER.email);
    await page.getByLabel('Password').fill(OWNER.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  });

  test('wrong credentials show a generic error and no session is created', async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(OWNER.email);
    await page.getByLabel('Password').fill('definitely not it');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name.endsWith('nexora_session'))).toBeUndefined();
  });

  test('the session cookie is HttpOnly and SameSite=Strict', async ({ page }) => {
    await signIn(page);
    const cookie = (await page.context().cookies()).find(
      (candidate) => candidate.name === 'nexora_session',
    );
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    // Not readable from page scripts.
    expect(await page.evaluate(() => document.cookie)).not.toContain('nexora_session');
  });

  test('signing out ends the session server-side', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/admin\/login\?next=/);
    const session = await page.request.get('/api/v1/auth/session');
    expect(await session.json()).toEqual({ authenticated: false });
  });
});
