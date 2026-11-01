import type { Locator, Page } from '@playwright/test';
import { apiAsUser, expect, expectNoHorizontalOverflow, isDesktop, signIn, test } from './helpers';

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

/** Drags with the mouse in small steps (the builder starts a drag after the pointer moves 6 px). */
async function dragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Drag source or target is not visible.');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + 2, { steps: 2 });
  await page.mouse.up();
}

test.describe('Visual builder', () => {
  test('lays out a page with sections, columns, widgets and shortcodes and publishes it', async ({
    page,
  }) => {
    await signIn(page);
    const title = `Builder page ${suffix(page)}`;
    const entry = (await apiAsUser(page, 'POST', '/entries', {
      type: 'page',
      title,
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original intro.' }] }],
      },
    })) as { id: string; url: string };

    // From the classic editor into the builder; the existing body becomes a text widget.
    await page.goto(`/admin/content/page/${entry.id}`);
    await page.getByRole('link', { name: 'Edit with the visual builder' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/content/page/${entry.id}/builder$`));
    const canvas = page.getByRole('main', { name: 'Canvas' });
    const library = page.getByRole('complementary', { name: 'Library' });
    const properties = page.getByRole('complementary', { name: 'Properties' });
    await expect(canvas.getByText('Original intro.')).toBeVisible();

    // A two-column section: a heading in the first column, a shortcode widget in the second.
    await canvas.getByRole('button', { name: '2 columns', exact: true }).click();
    await library.getByRole('button', { name: 'Add Heading' }).click();
    await properties.getByRole('textbox', { name: 'Text', exact: true }).fill('Built with blocks');
    await expect(canvas.getByRole('heading', { name: 'Built with blocks' })).toBeVisible();
    await properties.getByRole('spinbutton', { name: 'Font size' }).fill('48');
    // Phones get a smaller heading (a mobile-only value; tablets inherit the desktop one).
    await page.getByRole('button', { name: 'Mobile', exact: true }).click();
    await properties.getByRole('spinbutton', { name: 'Font size' }).fill('28');
    await page.getByRole('button', { name: 'Desktop', exact: true }).click();

    const secondColumn = canvas
      .getByRole('group', { name: 'Column' })
      .filter({ hasText: 'Drop a widget here' });
    await secondColumn.getByText('Drop a widget here').click();
    await library.getByRole('button', { name: 'Add Shortcode' }).click();
    const code = properties.getByRole('textbox', { name: 'Shortcode', exact: true });
    await code.fill('[button text="Shop now" url="/blog"] [nope] [[year]]');
    await expect(
      properties.getByText(/Unknown shortcode.*It will appear as plain text/),
    ).toBeVisible();

    if (isDesktop(page)) {
      // Dragging from the library works too (pointer); the divider lands in the first section.
      await dragTo(
        page,
        library.getByRole('button', { name: 'Add Divider' }),
        canvas.getByRole('button', { name: 'Text widget' }),
      );
      await expect(canvas.getByRole('button', { name: 'Divider widget' })).toHaveCount(1);
    }

    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);

    // The public page: same layout, inline builder CSS allowed only by its hash, shortcodes resolved safely.
    const violations = await watchCsp(page);
    const response = await page.goto(entry.url);
    expect(response?.status()).toBe(200);
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/style-src 'self' 'sha256-[A-Za-z0-9+/]{43}='/);
    expect(csp).not.toContain('unsafe-inline');
    await expect(page.getByText('Original intro.')).toBeVisible();
    const heading = page.getByRole('heading', { name: 'Built with blocks' });
    await expect(heading).toBeVisible();
    await expect(page.getByRole('link', { name: 'Shop now' })).toHaveAttribute('href', '/blog');
    // Unknown shortcodes and escaped ones stay literal text.
    await expect(page.getByText('[nope]', { exact: false })).toBeVisible();
    await expect(page.getByText(/\[year\]/)).toBeVisible();
    expect(await page.content()).not.toContain('[[year]]');

    const fontSize = await heading.evaluate((element) => getComputedStyle(element).fontSize);
    const columns = page.locator('.nx-b-row').last().locator(':scope > .nx-b-col');
    await expect(columns).toHaveCount(2);
    const first = await columns.nth(0).boundingBox();
    const second = await columns.nth(1).boundingBox();
    if (!first || !second) throw new Error('Columns are not visible.');
    if ((page.viewportSize()?.width ?? 0) <= 640) {
      expect(fontSize).toBe('28px');
      // Stacked on phones.
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 1);
    } else {
      expect(fontSize).toBe('48px');
      // Side by side on wider screens.
      expect(Math.abs(second.y - first.y)).toBeLessThan(2);
      expect(second.x).toBeGreaterThan(first.x + first.width - 1);
    }
    if (isDesktop(page)) await expect(page.locator('.nx-w-divider')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    expect(await violations()).toEqual([]);

    // Back in the classic editor: the entry says it uses the builder, and revisions summarise the layout.
    await page.goto(`/admin/content/page/${entry.id}`);
    await expect(page.getByText(/laid out with the/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the builder' })).toBeVisible();
    await page.getByRole('button', { name: 'Revisions' }).click();
    const revisions = page.getByRole('dialog', { name: 'Revisions' });
    await revisions.getByRole('button', { name: /Version 2/ }).click();
    await expect(revisions.getByText(/Visual builder layout: 2 sections/)).toBeVisible();
    await revisions.getByRole('button', { name: /Version 1/ }).click();
    await expect(revisions.getByText('Original intro.')).toBeVisible();
  });

  test('shortcodes work in classic rich-text content too', async ({ page }) => {
    await signIn(page);
    const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    await apiAsUser(page, 'POST', '/entries', {
      type: 'post',
      status: 'published',
      title: `Earlier post ${suffix(page)}`,
    });
    const post = (await apiAsUser(page, 'POST', '/entries', {
      type: 'post',
      status: 'published',
      title: `Shortcodes in text ${suffix(page)}`,
      body: {
        type: 'doc',
        content: [
          paragraph('Welcome to [site_name] in [year].'),
          paragraph('[button text="Read the blog" url="/blog" style="outline"]'),
          paragraph('[recent_posts count="2"]'),
          paragraph('[script src="x"] stays text, as does [[year]].'),
        ],
      },
    })) as { url: string };

    const response = await page.goto(post.url);
    expect(response?.status()).toBe(200);
    const article = page.getByRole('article');
    await expect(
      article.getByText(`Welcome to E2E Site in ${String(new Date().getFullYear())}.`),
    ).toBeVisible();
    const button = article.getByRole('link', { name: 'Read the blog' });
    await expect(button).toHaveAttribute('href', '/blog');
    await expect(button).toHaveClass(/nx-btn-outline/);
    // Resolved on the server from published posts (this one included).
    const recent = article.locator('ul.nx-sc-posts > li');
    await expect(recent).toHaveCount(2);
    await expect(article.getByText('[script src="x"] stays text, as does [year].')).toBeVisible();
    expect(await page.locator('article script').count()).toBe(0);
    await expectNoHorizontalOverflow(page);
  });

  test('HTML embeds run in a sandbox without access to the site', async ({ page }) => {
    await signIn(page);
    const html =
      '<p id="out">waiting</p><script>' +
      "let a;try{a=window.parent.document.title}catch(e){a='parent blocked'}" +
      "let b;try{b=document.cookie;b='cookies readable'}catch(e){b='no cookies'}" +
      "document.getElementById('out').textContent=a+' / '+b</script>";
    const widgetId = `emb${suffix(page).padStart(5, '0')}`.slice(0, 8);
    const entry = (await apiAsUser(page, 'POST', '/entries', {
      type: 'page',
      status: 'published',
      title: `Embed page ${suffix(page)}`,
      editor: 'builder',
      builder: {
        schemaVersion: 1,
        settings: { hideTitle: false },
        sections: [
          {
            id: 'sec00001',
            type: 'section',
            layout: 'boxed',
            styles: { desktop: {} },
            children: [
              {
                id: 'col00001',
                type: 'column',
                width: { desktop: 100 },
                verticalAlign: 'start',
                styles: { desktop: {} },
                children: [
                  {
                    id: widgetId,
                    type: 'widget',
                    widget: 'html',
                    props: { html, height: 120, title: 'Sandboxed demo' },
                    styles: { desktop: {} },
                  },
                ],
              },
            ],
          },
        ],
      },
    })) as { id: string; url: string };

    const violations = await watchCsp(page);
    const response = await page.goto(entry.url);
    expect(response?.status()).toBe(200);
    // The page itself never contains the embed's HTML.
    expect(await page.content()).not.toContain('parent blocked');
    const frame = page.frameLocator('iframe[title="Sandboxed demo"]');
    await expect(frame.locator('#out')).toHaveText('parent blocked / no cookies');
    expect(await violations()).toEqual([]);

    const direct = await page.request.get(`/_embed/${entry.id}/${widgetId}`);
    expect(direct.status()).toBe(200);
    expect(direct.headers()['content-security-policy']).toContain('sandbox allow-scripts');
  });
});
