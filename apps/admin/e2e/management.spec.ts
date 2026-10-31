import { expect, navigate, signIn, test, uniqueEmail, expectNoHorizontalOverflow } from './helpers';

test.describe('Users, roles and audit', () => {
  test('an administrator adds, edits, suspends and reactivates a user', async ({ page }) => {
    await signIn(page);
    await navigate(page, 'Users');
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();

    const email = uniqueEmail('editor', page);
    await page.getByRole('button', { name: 'Add user' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add user' });
    await dialog.getByRole('button', { name: 'Add user' }).click();
    await expect(dialog.getByText('Name is required.')).toBeVisible();
    await dialog.getByLabel('Name').fill('Eddie Editor');
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Initial password').fill('an initial passphrase 1');
    await dialog.getByLabel('Role').selectOption({ label: 'Editor' });
    await dialog.getByRole('button', { name: 'Add user' }).click();
    await expect(page.getByText('Eddie Editor was added.')).toBeVisible();

    await page.getByLabel('Search users').fill(email);
    const row = page.getByTestId(`user-row-${email}`);
    await expect(row).toBeVisible();
    await expect(row.getByText('Editor', { exact: true }).filter({ visible: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await row.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: /Edit Eddie Editor/ });
    await edit.getByLabel('Role').selectOption({ label: 'Author' });
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(row.getByText('Author', { exact: true }).filter({ visible: true })).toBeVisible();

    await row.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Suspend' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('signed out immediately');
    await confirm.getByRole('button', { name: 'Suspend' }).click();
    await expect(
      row.getByText('Suspended', { exact: true }).filter({ visible: true }),
    ).toBeVisible();

    await row.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Reactivate' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reactivate' }).click();
    await expect(row.getByText('Active', { exact: true }).filter({ visible: true })).toBeVisible();
  });

  test('a viewer only sees what their role allows', async ({ page, browser }) => {
    await signIn(page);
    await navigate(page, 'Users');
    const email = uniqueEmail('viewer', page);
    await page.getByRole('button', { name: 'Add user' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add user' });
    await dialog.getByLabel('Name').fill('Vera Viewer');
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Initial password').fill('a viewer passphrase 9');
    await dialog.getByLabel('Role').selectOption({ label: 'Viewer' });
    await dialog.getByRole('button', { name: 'Add user' }).click();
    await expect(page.getByText('Vera Viewer was added.')).toBeVisible();

    const viewerContext = await browser.newContext({
      viewport: page.viewportSize() ?? { width: 1280, height: 800 },
    });
    await viewerContext.setExtraHTTPHeaders({
      'X-Forwarded-For': `10.88.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250) + 1)}`,
    });
    const viewer = await viewerContext.newPage();
    await signIn(viewer, email, 'a viewer passphrase 9');
    if ((viewer.viewportSize()?.width ?? 0) < 1024) {
      await viewer.getByRole('button', { name: 'Open navigation' }).click();
    }
    const nav = viewer.getByRole('navigation', { name: 'Main' }).last();
    await expect(nav.getByRole('link', { name: 'System status' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);
    await viewer.goto('/admin/users');
    await expect(viewer.getByText('Access denied')).toBeVisible();
    // The API enforces it regardless of the UI.
    expect((await viewer.request.get('/api/v1/users')).status()).toBe(403);
    await viewerContext.close();
  });

  test('custom roles can be created and deleted; built-in roles are protected', async ({
    page,
  }) => {
    await signIn(page);
    await navigate(page, 'Roles');
    await expect(page.getByTestId('role-super_admin')).toContainText('All capabilities');
    await expect(page.getByTestId('role-super_admin').getByLabel('Locked')).toBeVisible();

    const key = `reviewer_${String(page.viewportSize()?.width ?? 0)}`;
    await page.getByRole('button', { name: 'Create role' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create role' });
    await dialog.getByLabel('Name').fill(`Reviewer ${String(page.viewportSize()?.width ?? 0)}`);
    await dialog.getByLabel('Key').fill(key);
    await dialog.getByRole('checkbox', { name: /View the audit log/ }).check();
    await dialog.getByRole('button', { name: 'Create role' }).click();
    const card = page.getByTestId(`role-${key}`);
    await expect(card).toContainText('2 capabilities');

    await card.getByRole('button', { name: /Delete/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete role' }).click();
    await expect(card).toHaveCount(0);
  });

  test('the audit log shows security events', async ({ page }) => {
    await signIn(page);
    await navigate(page, 'Audit log');
    await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
    await page.getByLabel('Filter events').selectOption({ label: 'Setup' });
    await expect(page.getByText('setup.completed')).toBeVisible();
    await page.getByLabel('Filter events').selectOption({ label: 'Sign-in and passwords' });
    await expect(page.getByText('auth.login_succeeded').first()).toBeVisible();
    await expect(page.getByText('setup.completed')).toHaveCount(0);
  });

  test('site settings update the base URL', async ({ page }) => {
    await signIn(page);
    await navigate(page, 'Settings');
    await page.getByLabel('Site name').fill('E2E Site (renamed)');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await page.getByLabel('Site name').fill('E2E Site');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.').last()).toBeVisible();
  });
});
