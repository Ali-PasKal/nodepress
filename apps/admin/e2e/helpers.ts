import { expect, test as base, type Page } from '@playwright/test';
import { OWNER } from './constants';

let ipCounter = Math.floor(Math.random() * 1_000);

/**
 * Every test models a distinct client address (the API trusts the preview proxy as one hop), so the
 * real per-IP sign-in limits apply without tests interfering with each other.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    ipCounter += 1;
    await page.context().setExtraHTTPHeaders({
      'X-Forwarded-For': `10.77.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter % 250) + 1)}`,
    });
    await use(page);
  },
});
export { expect };

export const DESKTOP_BREAKPOINT = 1024;
export function isDesktop(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= DESKTOP_BREAKPOINT;
}

export async function signIn(
  page: Page,
  email = OWNER.email,
  password = OWNER.password,
  path = '/admin/',
): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: /Account menu/ })).toBeVisible();
}

/** Opens a navigation link, via the drawer on narrow viewports. */
export async function navigate(page: Page, label: string): Promise<void> {
  if (!isDesktop(page)) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('dialog').getByRole('link', { name: label }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  } else {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label }).click();
  }
}

/** Calls the API as the signed-in user from the page's browser context (cookies + CSRF token). */
export async function apiAsUser(
  page: Page,
  method: 'POST' | 'PATCH',
  path: string,
  data: unknown,
): Promise<unknown> {
  const session = (await (await page.request.get('/api/v1/auth/session')).json()) as {
    csrfToken: string;
  };
  const response = await page.request.fetch(`/api/v1${path}`, {
    method,
    data,
    headers: { 'X-CSRF-Token': session.csrfToken },
  });
  expect(response.ok(), `${method} ${path} → ${String(response.status())}`).toBe(true);
  return response.json();
}

export function uniqueEmail(prefix: string, page: Page): string {
  return `${prefix}-${String(page.viewportSize()?.width ?? 0)}-${String(Date.now())}@example.test`;
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}
