import { writePluginPackage } from '@nexora/plugin-runtime';
import type { Page } from '@playwright/test';
import {
  apiAsUser,
  expect,
  expectNoHorizontalOverflow,
  isDesktop,
  navigate,
  signIn,
  test,
} from './helpers';

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

/** A small plugin package, unique per viewport (ids and shortcode names must not collide). */
function greeterPackage(width: string): Buffer {
  const manifest = {
    id: `acme.greeter-${width}`,
    name: `Greeter ${width}`,
    version: '1.0.0',
    apiVersion: 1,
    main: 'plugin.js',
    description: 'Greets visitors in bold.',
    settings: [{ key: 'greeting', label: 'Greeting', type: 'text', default: 'Hello' }],
    shortcodes: [
      {
        name: `greet_${width}`,
        label: 'Greet',
        example: `[greet_${width} name="you"]`,
        attributes: { name: { type: 'string', required: true } },
      },
    ],
  };
  const code = `export default { shortcodes: { greet_${width}(attrs, ctx) {
    return { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: ctx.settings.greeting + ', ' + attrs.name + '!', marks: [{ type: 'bold' }] },
    ] }] };
  } } };`;
  return writePluginPackage([
    { name: 'nexora-plugin.json', data: Buffer.from(JSON.stringify(manifest)) },
    { name: 'plugin.js', data: Buffer.from(code) },
    { name: 'README.md', data: Buffer.from('# Greeter\n\nSays hello.') },
  ]);
}

test.describe('Plugins', () => {
  test('an administrator installs, reviews, configures and deactivates plugins; their shortcodes render on the site', async ({
    page,
  }) => {
    const width = suffix(page);
    await signIn(page);
    await navigate(page, 'Plugins');
    await expect(page.getByRole('heading', { level: 1, name: 'Plugins' })).toBeVisible();

    if (isDesktop(page)) {
      // A first-party plugin from the bundled folder (installed once; other viewports reuse it).
      await page.getByRole('button', { name: 'Install Reading time' }).click();
      await expect(
        page.getByText('Reading time is installed. Review it before activating.'),
      ).toBeVisible();
      const card = page
        .getByRole('listitem')
        .filter({ has: page.getByRole('link', { name: 'Reading time' }) });
      await card.getByRole('button', { name: 'Activate' }).click();
      const dialog = page.getByRole('dialog', { name: 'Activate Reading time?' });
      await expect(dialog.getByText(/No permissions/)).toBeVisible();
      await dialog.getByRole('button', { name: 'Activate' }).click();
      await expect(page.getByText('Reading time is active.')).toBeVisible();
    }

    // Upload a package: installed inactive, then reviewed and activated on its page.
    await page.getByRole('button', { name: 'Upload plugin' }).click();
    const upload = page.getByRole('dialog', { name: 'Upload a plugin' });
    await upload.getByLabel('Plugin package').setInputFiles({
      name: 'greeter.zip',
      mimeType: 'application/zip',
      buffer: greeterPackage(width),
    });
    await upload.getByRole('button', { name: 'Upload' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/plugins/acme\\.greeter-${width}$`));
    await expect(page.getByRole('heading', { level: 1, name: `Greeter ${width}` })).toBeVisible();
    await expect(page.getByText('Says hello.')).toBeVisible();
    await page.getByRole('button', { name: 'Activate' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Activate' }).click();
    await expect(page.getByText(`Greeter ${width} is active.`)).toBeVisible();

    // Settings (generated form).
    await page.getByLabel('Greeting').fill('Welcome');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Plugin settings saved.')).toBeVisible();

    // The shortcodes on the public site.
    const post = (await apiAsUser(page, 'POST', '/entries', {
      type: 'post',
      status: 'published',
      title: `Plugin showcase ${width}`,
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `Hi: [greet_${width} name="Playwright"]` }],
          },
          { type: 'paragraph', content: [{ type: 'text', text: 'Time: [reading_time]' }] },
        ],
      },
    })) as { url: string };
    const violations = await watchCsp(page);
    await page.goto(post.url);
    await expect(page.locator('strong', { hasText: 'Welcome, Playwright!' })).toBeVisible();
    await expect(page.getByText('Time: 1 min read')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(await violations()).toEqual([]);

    // Deactivated: the shortcode shows as plain text again.
    await page.goto(`/admin/plugins/acme.greeter-${width}`);
    await page.getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByText(`Greeter ${width} is inactive.`)).toBeVisible();
    await page.goto(post.url);
    await expect(page.getByText(`Hi: [greet_${width} name="Playwright"]`)).toBeVisible();
  });

  test('invalid packages are refused with the reason', async ({ page }) => {
    await signIn(page, undefined, undefined, '/admin/plugins');
    await expect(page.getByRole('heading', { level: 1, name: 'Plugins' })).toBeVisible();
    await page.getByRole('button', { name: 'Upload plugin' }).click();
    const upload = page.getByRole('dialog', { name: 'Upload a plugin' });
    await upload.getByLabel('Plugin package').setInputFiles({
      name: 'broken.zip',
      mimeType: 'application/zip',
      buffer: writePluginPackage([
        {
          name: 'nexora-plugin.json',
          data: Buffer.from(
            JSON.stringify({
              id: 'nodot',
              name: 'Bad',
              version: '1',
              apiVersion: 1,
              main: 'plugin.js',
            }),
          ),
        },
        { name: 'plugin.js', data: Buffer.from('export default {}') },
      ]),
    });
    await upload.getByRole('button', { name: 'Upload' }).click();
    await expect(upload.getByText('nexora-plugin.json is invalid.')).toBeVisible();
    await expect(upload.getByText(/^id: /)).toBeVisible();
    await expect(upload.getByText(/^version: /)).toBeVisible();
  });
});
