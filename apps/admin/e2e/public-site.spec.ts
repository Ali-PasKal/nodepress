import type { Page } from '@playwright/test';
import { apiAsUser, expect, expectNoHorizontalOverflow, navigate, signIn, test } from './helpers';

function suffix(page: Page): string {
  return String(page.viewportSize()?.width ?? 0);
}

/** Collects Content Security Policy violations reported by the page (must stay empty). */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const store = window as unknown as { __csp: string[] };
    store.__csp = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      store.__csp.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

async function publish(
  page: Page,
  body: Record<string, unknown>,
): Promise<{ id: string; url: string }> {
  return (await apiAsUser(page, 'POST', '/entries', { status: 'published', ...body })) as {
    id: string;
    url: string;
  };
}

test.describe('Public site', () => {
  test('published content is rendered by the theme with a strict CSP and SEO tags', async ({
    page,
  }) => {
    const violations = await watchCsp(page);
    await signIn(page);
    const title = `Hello <world> ${suffix(page)}`;
    const post = await publish(page, {
      type: 'post',
      title,
      excerpt: 'A post rendered by the public site.',
      body: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Body text on the public site.' }] },
        ],
      },
    });
    expect(post.url).toBe(`/blog/hello-world-${suffix(page)}`);
    await apiAsUser(page, 'POST', '/entries', {
      type: 'post',
      title: `Secret draft ${suffix(page)}`,
    });

    const response = await page.goto(post.url);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-security-policy']).toContain("default-src 'none'");
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText('Body text on the public site.')).toBeVisible();
    await expect(page).toHaveTitle(`${title} – E2E Site`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `http://127.0.0.1:4199${post.url}`,
    );
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
    // The theme stylesheet applies (no inline styles are needed).
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(font).toContain('system-ui');
    await expectNoHorizontalOverflow(page);

    // The archive and home page list it; drafts are never public.
    await page.goto('/blog');
    await expect(page.getByRole('link', { name: title })).toBeVisible();
    await expect(page.getByText(`Secret draft ${suffix(page)}`)).toHaveCount(0);
    const draft = await page.goto(`/blog/secret-draft-${suffix(page)}`);
    expect(draft?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('link', { name: title })).toBeVisible();
    expect(await violations()).toEqual([]);
  });

  test('appearance settings and menus change the rendered site', async ({ page }) => {
    await signIn(page);
    const about = await publish(page, { type: 'page', title: `About us ${suffix(page)}` });

    await navigate(page, 'Appearance');
    await expect(page.getByRole('heading', { level: 1, name: 'Appearance' })).toBeVisible();
    const tagline = `Fresh ideas ${suffix(page)}`;
    await page.getByRole('textbox', { name: 'Tagline' }).fill(tagline);
    await page.getByRole('button', { name: 'Save site settings' }).click();
    await expect(page.getByText('Site settings saved.')).toBeVisible();
    await page.getByLabel('Accent colour', { exact: true }).fill('#b91c1c');
    await page.getByLabel('Footer text').fill(`© E2E ${suffix(page)}`);
    await page.getByRole('button', { name: 'Save theme settings' }).click();
    await expect(page.getByText('Theme settings saved.')).toBeVisible();

    await navigate(page, 'Menus');
    await expect(page.getByRole('heading', { level: 1, name: 'Menus' })).toBeVisible();
    await page.getByLabel('New menu').fill(`Main ${suffix(page)}`);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Menu created.')).toBeVisible();
    await page.getByLabel('Show in').selectOption('primary');
    await page.getByLabel('Content type').selectOption('page');
    await page.getByLabel('Search entries').fill(`About us ${suffix(page)}`);
    await page.getByRole('button', { name: `Add About us ${suffix(page)} to the menu` }).click();
    await page.getByRole('tab', { name: 'Link' }).click();
    await page.getByLabel('Link text').fill('Docs');
    await page.getByLabel('URL').fill('https://example.org/docs');
    await page.getByRole('button', { name: 'Add link' }).click();
    // On phones the "Menu created." toast can cover the button; submit with the keyboard.
    await page.getByRole('button', { name: 'Save menu' }).press('Enter');
    await expect(page.getByText('Menu saved.')).toBeVisible();

    await page.goto(about.url);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: `About us ${suffix(page)}` })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: 'Docs' })).toHaveAttribute(
      'href',
      'https://example.org/docs',
    );
    await expect(page.getByText(tagline)).toBeVisible();
    await expect(page.getByText(`© E2E ${suffix(page)}`)).toBeVisible();
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--nx-accent').trim(),
    );
    expect(accent).toBe('#b91c1c');
    await expectNoHorizontalOverflow(page);
  });

  test('editors preview drafts through a private link and see their SEO settings applied', async ({
    page,
    context,
  }) => {
    await signIn(page);
    const draft = (await apiAsUser(page, 'POST', '/entries', {
      type: 'post',
      title: `Preview me ${suffix(page)}`,
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft body.' }] }],
      },
    })) as { id: string };
    await page.goto(`/admin/content/post/${draft.id}`);
    await page.getByLabel('SEO title').fill(`Custom SEO title ${suffix(page)}`);
    await page.getByLabel('Meta description').fill('A hand-written description.');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Post saved.')).toBeVisible();

    const popup = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Preview' }).click();
    const preview = await popup;
    await preview.waitForURL(/\/_preview\/[A-Za-z0-9_-]{43}$/);
    await expect(preview.getByRole('status')).toContainText('Preview');
    await expect(
      preview.getByRole('heading', { level: 1, name: `Preview me ${suffix(page)}` }),
    ).toBeVisible();
    await expect(preview).toHaveTitle(`Custom SEO title ${suffix(page)} – E2E Site`);
    await expect(preview.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
    await expect(preview.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      'A hand-written description.',
    );
    await preview.close();

    // The draft itself is still not public.
    const direct = await page.goto(`/blog/preview-me-${suffix(page)}`);
    expect(direct?.status()).toBe(404);
  });

  test('SEO settings control robots.txt and manual redirects work', async ({ page }) => {
    await signIn(page);
    const target = await publish(page, { type: 'page', title: `Contact ${suffix(page)}` });

    await navigate(page, 'Redirects');
    await expect(page.getByRole('heading', { level: 1, name: 'Redirects' })).toBeVisible();
    await page.getByRole('button', { name: 'Add redirect' }).first().click();
    await page.getByLabel('Old path').fill(`/old-contact-${suffix(page)}`);
    await page.getByLabel('New address').fill(target.url);
    await page.getByRole('dialog').getByRole('button', { name: 'Add redirect' }).click();
    await expect(page.getByText('Redirect created.')).toBeVisible();
    await page.goto(`/old-contact-${suffix(page)}`);
    await expect(page).toHaveURL(new RegExp(`${target.url}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: `Contact ${suffix(page)}` }),
    ).toBeVisible();

    expect(await (await page.request.get('/robots.txt')).text()).toContain(
      'Sitemap: http://127.0.0.1:4199/sitemap.xml',
    );
    const sitemap = await (await page.request.get('/sitemap.xml')).text();
    expect(sitemap).toContain(`<loc>http://127.0.0.1:4199${target.url}</loc>`);
    const feed = await page.request.get('/feed.xml');
    expect(feed.headers()['content-type']).toContain('application/rss+xml');

    await page.goto('/admin/seo');
    await expect(page.getByRole('heading', { level: 1, name: 'SEO' })).toBeVisible();
    await page.getByLabel('Allow search engines to index this site').uncheck();
    await page.getByRole('button', { name: 'Save SEO settings' }).click();
    await expect(page.getByText('SEO settings saved.')).toBeVisible();
    expect(await (await page.request.get('/robots.txt')).text()).toBe(
      'User-agent: *\nDisallow: /\n',
    );
    await page.getByLabel('Allow search engines to index this site').check();
    await page.getByRole('button', { name: 'Save SEO settings' }).click();
    await expect
      .poll(async () => (await page.request.get('/robots.txt')).text())
      .toContain('Sitemap:');
  });
});
