import { expect, expectNoHorizontalOverflow, isDesktop, navigate, signIn, test } from './helpers';

test.describe('Layout, accessibility and security', () => {
  test('sign-in page fits the viewport and is not indexable', async ({ page }) => {
    await page.goto('/admin/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
  });

  test('system status reports a healthy instance', async ({ page }) => {
    await signIn(page);
    await navigate(page, 'System status');
    await expect(page.getByTestId('overall-status')).toHaveAttribute('data-status', 'ok');
    await expect(
      page.getByTestId('component-database').getByText('Up', { exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('navigation adapts to the viewport', async ({ page }) => {
    await signIn(page);
    if (isDesktop(page)) {
      const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
      await expect(sidebar).toBeVisible();
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
      await page.reload();
      await page.getByRole('button', { name: 'Expand sidebar' }).click();
    } else {
      await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeHidden();
      const menu = page.getByRole('button', { name: 'Open navigation' });
      await menu.click();
      await expect(page.getByRole('dialog').getByRole('link', { name: 'Users' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(menu).toBeFocused();
    }
  });

  test('theme choice persists across reloads', async ({ page }) => {
    await signIn(page);
    await page.getByTitle('Dark').click();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await page.getByTitle('Light').click();
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  });

  test('the first Tab stop is the skip link', async ({ page }) => {
    await signIn(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });

  test('unknown routes show a not-found page', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/does-not-exist');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  });

  test('the admin is served with a strict Content Security Policy', async ({ request }) => {
    const headers = (await request.get('/admin/')).headers();
    expect(headers['content-security-policy']).toContain("script-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options']).toBe('DENY');
  });

  test('runs without Content Security Policy violations', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/content security policy/i.test(message.text())) violations.push(message.text());
    });
    await page.addInitScript(() => {
      const store = window as unknown as { __csp: string[] };
      store.__csp = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        store.__csp.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });
    await signIn(page);
    await navigate(page, 'Users');
    await page.getByRole('button', { name: 'Add user' }).click();
    await expect(page.getByRole('dialog', { name: 'Add user' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Account menu/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    await page.keyboard.press('Escape');
    const fromPage = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    expect([...violations, ...fromPage]).toEqual([]);
  });
});
