import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { E2E_MAIL_DIR } from './constants';
import { apiAsUser, expect, signIn, test, uniqueEmail } from './helpers';

async function latestResetLink(to: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const files = (await readdir(E2E_MAIL_DIR).catch(() => []))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .reverse();
    for (const name of files) {
      const mail = JSON.parse(await readFile(join(E2E_MAIL_DIR, name), 'utf8')) as {
        to: string;
        text: string;
      };
      const match = /(http\S+\/admin\/reset-password\?token=\S+)/.exec(mail.text);
      if (mail.to === to && match?.[1]) return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no reset email for ${to}`);
}

test.describe('Own account', () => {
  test('profile shows the current session and updates the display name', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Your profile' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Your profile' })).toBeVisible();
    await expect(page.getByTestId('session-item').filter({ hasText: 'This device' })).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('Site Owner');
    await expect(page.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  });

  test('a user resets a forgotten password through the emailed link', async ({ page, browser }) => {
    await signIn(page);
    const email = uniqueEmail('forgetful', page);
    const roles = (await (await page.request.get('/api/v1/roles')).json()) as {
      roles: { id: string; key: string }[];
    };
    await apiAsUser(page, 'POST', '/users', {
      email,
      displayName: 'Forgetful Fran',
      password: 'the original passphrase',
      roleId: roles.roles.find((role) => role.key === 'author')?.id,
    });

    const context = await browser.newContext({
      viewport: page.viewportSize() ?? { width: 1280, height: 800 },
    });
    await context.setExtraHTTPHeaders({
      'X-Forwarded-For': `10.99.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250) + 1)}`,
    });
    const visitor = await context.newPage();
    await visitor.goto('/admin/login');
    await visitor.getByRole('link', { name: 'Forgot your password?' }).click();
    await visitor.getByLabel('Email').fill(email);
    await visitor.getByRole('button', { name: 'Send reset link' }).click();
    await expect(visitor.getByText('Check your email')).toBeVisible();

    const link = await latestResetLink(email);
    await visitor.goto(link.replace(/^http:\/\/127\.0\.0\.1:4199/, ''));
    await visitor.getByLabel('New password', { exact: true }).fill('a fresh new passphrase');
    await visitor.getByLabel('Confirm new password').fill('a fresh new passphrase');
    await visitor.getByRole('button', { name: 'Change password' }).click();
    await expect(visitor.getByText('Password changed')).toBeVisible();

    await signIn(visitor, email, 'a fresh new passphrase');
    // The link is single-use.
    await visitor.goto(link.replace(/^http:\/\/127\.0\.0\.1:4199/, ''));
    await visitor.getByLabel('New password', { exact: true }).fill('yet another passphrase');
    await visitor.getByLabel('Confirm new password').fill('yet another passphrase');
    await visitor.getByRole('button', { name: 'Change password' }).click();
    await expect(visitor.getByText(/invalid or has expired/)).toBeVisible();
    await context.close();
    await rm(E2E_MAIL_DIR, { recursive: true, force: true }).catch(() => undefined);
  });
});
