import { expect, test, type Page } from '@playwright/test';

const DESKTOP_BREAKPOINT = 1024;

async function openStatusPage(page: Page): Promise<void> {
  await page.goto('/admin/system/status');
  await expect(page.getByTestId('overall-status')).toBeVisible();
}

function isDesktop(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= DESKTOP_BREAKPOINT;
}

test.describe('System status (real API + database)', () => {
  test('redirects the admin root to the status page', async ({ page }) => {
    await page.goto('/admin/');
    await expect(page).toHaveURL(/\/admin\/system\/status$/);
    await expect(page.getByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
    await expect(page).toHaveTitle('System status · NEXORA CMS');
  });

  test('shows live readiness reported by the API', async ({ page }) => {
    await openStatusPage(page);
    await expect(page.getByTestId('overall-status')).toHaveAttribute('data-status', 'ok');
    await expect(page.getByRole('heading', { name: 'All systems operational' })).toBeVisible();
    await expect(
      page.getByTestId('component-database').getByText('Up', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId('component-migrations').getByText('Current', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId('component-process').getByText('Running', { exact: true }),
    ).toBeVisible();
  });

  test('reports that initial setup has not been completed on a fresh database', async ({
    page,
  }) => {
    await openStatusPage(page);
    await expect(page.getByText('Initial setup has not been completed')).toBeVisible();
  });

  test('refreshes on demand', async ({ page }) => {
    await openStatusPage(page);
    const readyRequest = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/health/ready'),
    );
    await page.getByRole('button', { name: 'Refresh' }).click();
    expect((await readyRequest).status()).toBe(200);
  });

  test('shows a not-found page for unknown admin routes', async ({ page }) => {
    await page.goto('/admin/does-not-exist');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to system status' }).click();
    await expect(page).toHaveURL(/\/admin\/system\/status$/);
  });

  test('is not indexable by search engines', async ({ page }) => {
    await page.goto('/admin/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
  });
});

test.describe('Responsive layout', () => {
  test('has no horizontal overflow', async ({ page }) => {
    await openStatusPage(page);
    await expect(page.getByTestId('component-database')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('component cards stay within the viewport', async ({ page }) => {
    await openStatusPage(page);
    const width = page.viewportSize()?.width ?? 0;
    for (const id of ['database', 'migrations', 'cache', 'process']) {
      const box = await page.getByTestId(`component-${id}`).boundingBox();
      expect(box, `component-${id} should be rendered`).not.toBeNull();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    }
  });

  test('desktop shows a collapsible sidebar', async ({ page }) => {
    test.skip(!isDesktop(page), 'desktop-only behaviour');
    await openStatusPage(page);
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden();

    const expandedWidth = (await sidebar.boundingBox())?.width ?? 0;
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
    await expect
      .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
      .toBeLessThan(expandedWidth);

    // The collapsed preference survives a reload.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
  });

  test('tablet and mobile use an accessible navigation drawer', async ({ page }) => {
    test.skip(isDesktop(page), 'drawer is used below the desktop breakpoint');
    await openStatusPage(page);
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeHidden();

    const menuButton = page.getByRole('button', { name: 'Open navigation' });
    await menuButton.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'System status' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menuButton).toBeFocused();

    // Navigating from the drawer closes it.
    await menuButton.click();
    await page.getByRole('dialog').getByRole('link', { name: 'System status' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});

test.describe('Preferences and accessibility', () => {
  test('theme choice applies immediately and persists across reloads', async ({ page }) => {
    await openStatusPage(page);
    await page.getByTitle('Dark').click();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await page.getByTitle('Light').click();
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  });

  test('the first Tab stop is the skip link, which moves focus to the main content', async ({
    page,
  }) => {
    await openStatusPage(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });
});

test.describe('Security', () => {
  test('the admin is served with a strict Content Security Policy', async ({ request }) => {
    const response = await request.get('/admin/');
    const headers = response.headers();
    expect(headers['content-security-policy']).toContain("script-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
  });

  test('runs without Content Security Policy violations', async ({ page }) => {
    const consoleViolations: string[] = [];
    page.on('console', (message) => {
      if (/content security policy/i.test(message.text())) {
        consoleViolations.push(message.text());
      }
    });
    await page.addInitScript(() => {
      const store = window as unknown as { __cspViolations: string[] };
      store.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        store.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });

    await openStatusPage(page);
    // Exercise the interactive parts that inject styles or scripts at runtime.
    if (isDesktop(page)) {
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await page.getByRole('button', { name: 'Expand sidebar' }).click();
    } else {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await page.getByTitle('Dark').click();

    const pageViolations = await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    );
    expect([...consoleViolations, ...pageViolations]).toEqual([]);
  });
});
