import type { Page } from '@playwright/test';
import { SAMPLE_PNG } from './fixtures';
import {
  apiAsUser,
  expect,
  expectNoHorizontalOverflow,
  navigate,
  signIn,
  test,
  uniqueEmail,
} from './helpers';

function suffix(page: Page): string {
  return String(page.viewportSize()?.width ?? 0);
}

async function contentTypeId(page: Page, key: string): Promise<string> {
  const model = (await (await page.request.get('/api/v1/content-model')).json()) as {
    contentTypes: { id: string; key: string }[];
    taxonomies: { id: string; key: string }[];
  };
  return model.contentTypes.find((type) => type.key === key)!.id;
}

async function taxonomyId(page: Page, key: string): Promise<string> {
  const model = (await (await page.request.get('/api/v1/content-model')).json()) as {
    taxonomies: { id: string; key: string }[];
  };
  return model.taxonomies.find((taxonomy) => taxonomy.key === key)!.id;
}

async function typeInEditor(page: Page, label: string, text: string): Promise<void> {
  const editor = page.getByRole('textbox', { name: label });
  await editor.click();
  await page.keyboard.type(text);
}

test.describe('Content', () => {
  test('an editor writes, categorises and publishes a post with a featured image', async ({
    page,
  }) => {
    await signIn(page);
    const category = `Announcements ${suffix(page)}`;
    await apiAsUser(page, 'POST', `/taxonomies/${await taxonomyId(page, 'category')}/terms`, {
      name: category,
    });

    await navigate(page, 'Posts');
    await expect(page.getByRole('heading', { level: 1, name: 'Posts' })).toBeVisible();
    await page.getByRole('link', { name: 'New post' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'New post' })).toBeVisible();

    const title = `Launch day ${suffix(page)}`;
    await page.getByLabel('Title').fill(title);
    await expect(page.getByLabel('Slug')).toHaveValue(`launch-day-${suffix(page)}`);
    await typeInEditor(page, 'Post content', 'We are live. ');
    await page.getByRole('button', { name: 'Bold' }).click();
    await page.keyboard.type('Welcome!');
    await page.getByLabel('Excerpt').fill('The site is live.');
    await page.getByRole('checkbox', { name: category }).check();
    const tagInput = page.getByLabel('Add tag');
    await tagInput.fill(`launch-${suffix(page)}`);
    await tagInput.press('Enter');
    await expect(page.getByRole('list', { name: 'Selected tags' })).toContainText(
      `launch-${suffix(page)}`,
    );

    await page.getByRole('button', { name: 'Choose image' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose a featured image' });
    await picker
      .getByLabel('Upload a file')
      .setInputFiles({ name: 'hero.png', mimeType: 'image/png', buffer: SAMPLE_PNG });
    await expect(picker).toBeHidden();
    await expect(
      page.getByRole('img', { name: '' }).or(page.locator('img[src*="/uploads/"]')).first(),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Post published.')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/content\/post\/[0-9a-f-]{36}$/);
    await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('link', { name: 'All posts' }).click();
    const row = page.getByTestId('entry-row').filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(
      row.getByText('Published', { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('edits keep revisions that can be restored, and unsaved changes are protected', async ({
    page,
  }) => {
    await signIn(page);
    const created = (await apiAsUser(page, 'POST', '/entries', {
      type: 'post',
      title: `Original title ${suffix(page)}`,
    })) as { id: string };
    await page.goto(`/admin/content/post/${created.id}`);
    await page.getByLabel('Title').fill(`Changed title ${suffix(page)}`);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Post saved.')).toBeVisible();

    // Leaving with unsaved changes asks first.
    await page.getByLabel('Title').fill(`Unsaved ${suffix(page)}`);
    await page.getByRole('link', { name: 'All posts' }).click();
    const leave = page.getByRole('alertdialog', { name: 'Leave without saving?' });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Title')).toHaveValue(`Unsaved ${suffix(page)}`);
    await page.getByLabel('Title').fill(`Changed title ${suffix(page)}`);

    await page.getByRole('button', { name: 'Revisions' }).click();
    const dialog = page.getByRole('dialog', { name: 'Revisions' });
    await dialog.getByRole('button', { name: /Version 1/ }).click();
    await expect(
      dialog.getByRole('heading', { name: `Original title ${suffix(page)}` }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Restore this version' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('Revision restored.')).toBeVisible();
    await expect(page.getByLabel('Title')).toHaveValue(`Original title ${suffix(page)}`);
  });

  test('a concurrent edit is detected instead of silently overwritten', async ({ page }) => {
    await signIn(page);
    const created = (await apiAsUser(page, 'POST', '/entries', {
      type: 'post',
      title: `Shared draft ${suffix(page)}`,
    })) as { id: string; version: number };
    await page.goto(`/admin/content/post/${created.id}`);
    await expect(page.getByLabel('Title')).toHaveValue(`Shared draft ${suffix(page)}`);
    // Someone else saves first.
    await apiAsUser(page, 'PATCH', `/entries/${created.id}`, {
      version: created.version,
      title: `Their edit ${suffix(page)}`,
    });
    await page.getByLabel('Title').fill(`My edit ${suffix(page)}`);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Someone else changed this post')).toBeVisible();
    await page.getByRole('button', { name: 'Load latest version' }).click();
    await expect(page.getByLabel('Title')).toHaveValue(`Their edit ${suffix(page)}`);
  });

  test('a contributor submits for review and an editor publishes from the list', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const email = uniqueEmail('contributor', page);
    const roles = (await (await page.request.get('/api/v1/roles')).json()) as {
      roles: { id: string; key: string }[];
    };
    await apiAsUser(page, 'POST', '/users', {
      email,
      displayName: 'Cora Contributor',
      password: 'a contributor passphrase',
      roleId: roles.roles.find((role) => role.key === 'contributor')!.id,
    });

    const context = await browser.newContext({
      viewport: page.viewportSize() ?? { width: 1280, height: 800 },
    });
    await context.setExtraHTTPHeaders({
      'X-Forwarded-For': `10.99.${String(Math.floor(Math.random() * 250))}.7`,
    });
    const contributor = await context.newPage();
    await signIn(contributor, email, 'a contributor passphrase');
    await contributor.goto('/admin/content/post/new');
    const title = `For review ${suffix(page)}`;
    await contributor.getByLabel('Title').fill(title);
    await expect(contributor.getByRole('button', { name: 'Publish' })).toHaveCount(0);
    await contributor.getByRole('button', { name: 'Submit for review' }).click();
    await expect(contributor.getByText('Pending review').first()).toBeVisible();
    await context.close();

    await navigate(page, 'Posts');
    await page.getByRole('button', { name: /^Pending/ }).click();
    const row = page.getByTestId('entry-row').filter({ hasText: title });
    await row.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText(/1 post updated/)).toBeVisible();
    await page.getByRole('button', { name: /^Published/ }).click();
    await expect(page.getByTestId('entry-row').filter({ hasText: title })).toBeVisible();
  });

  test('pages form a hierarchy and can be trashed and restored', async ({ page }) => {
    await signIn(page);
    const parent = (await apiAsUser(page, 'POST', '/entries', {
      type: 'page',
      title: `About ${suffix(page)}`,
    })) as {
      id: string;
      slug: string;
    };
    await navigate(page, 'Pages');
    await page.getByRole('link', { name: 'New page' }).first().click();
    await page.getByLabel('Title').fill('Team');
    await page.getByLabel('Parent page').selectOption({ label: `About ${suffix(page)}` });
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Page saved.')).toBeVisible();
    await page.getByRole('link', { name: 'All pages' }).click();
    const child = page.getByTestId('entry-row').filter({ hasText: `/${parent.slug}/team` });
    await expect(child).toBeVisible();

    await child.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Move to trash' }).click();
    await expect(page.getByText(/Moved “Team” to the trash/)).toBeVisible();
    await page.getByRole('button', { name: /^Trash/ }).click();
    const trashed = page.getByTestId('entry-row').filter({ hasText: `/${parent.slug}/team` });
    await trashed.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Restore' }).click();
    await expect(page.getByText(/Restored “Team”/)).toBeVisible();
  });

  test('custom content types with custom fields can be defined and used', async ({ page }) => {
    await signIn(page);
    const key = `product_${suffix(page)}`;
    await navigate(page, 'Content types');
    await page.getByRole('button', { name: 'New content type' }).click();
    const dialog = page.getByRole('dialog', { name: 'New content type' });
    await dialog.getByLabel('Name (singular)').fill(`Product ${suffix(page)}`);
    await dialog.getByLabel('Name (plural)').fill(`Products ${suffix(page)}`);
    await dialog.getByLabel('Key').fill(key);
    await dialog.getByRole('button', { name: 'Add field' }).click();
    const field = dialog.getByTestId('field-row');
    await field.getByLabel('Label').fill('Price');
    await field.getByLabel('Type').selectOption({ label: 'Number' });
    await field.getByLabel('Minimum').fill('0');
    await field.getByRole('checkbox', { name: 'Required' }).check();
    await dialog.getByRole('button', { name: 'Create content type' }).click();
    await expect(page.getByText(`Product ${suffix(page)} was created.`)).toBeVisible();
    await expect(page.getByTestId(`content-type-${key}`)).toContainText('1 custom field');

    await page.goto(`/admin/content/${key}/new`);
    await page.getByLabel('Title').fill('Widget');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText(/Price is required|Enter a number/)).toBeVisible();
    await page.getByLabel('Price *').fill('19.5');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText(`Product ${suffix(page)} saved.`)).toBeVisible();
    expect(await contentTypeId(page, key)).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('categories are managed as a tree', async ({ page }) => {
    await signIn(page);
    await navigate(page, 'Categories');
    const name = `Regions ${suffix(page)}`;
    await page.getByRole('button', { name: 'Add category' }).click();
    let dialog = page.getByRole('dialog', { name: 'Add category' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByText(`${name} was created.`)).toBeVisible();
    await page.getByRole('button', { name: 'Add category' }).click();
    dialog = page.getByRole('dialog', { name: 'Add category' });
    await dialog.getByLabel('Name').fill(`Europe ${suffix(page)}`);
    await dialog.getByLabel('Parent').selectOption({ label: name });
    await dialog.getByRole('button', { name: 'Add category' }).click();
    await expect(
      page.getByTestId('term-row').filter({ hasText: `— Europe ${suffix(page)}` }),
    ).toBeVisible();

    await page.getByRole('button', { name: `Delete ${name}` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(`${name} was deleted.`)).toBeVisible();
    // The child moved up a level.
    await expect(
      page.getByTestId('term-row').filter({ hasText: `Europe ${suffix(page)}` }),
    ).not.toContainText('—');
  });
});

test.describe('Media library', () => {
  test('uploads, describes and deletes files', async ({ page }) => {
    await signIn(page);
    await navigate(page, 'Media');
    await expect(page.getByRole('heading', { level: 1, name: 'Media' })).toBeVisible();
    const name = `diagram-${suffix(page)}.png`;
    await page
      .getByLabel('Choose files to upload')
      .setInputFiles({ name, mimeType: 'image/png', buffer: SAMPLE_PNG });
    await expect(page.getByTestId('upload-item').filter({ hasText: name })).toContainText(
      'Uploaded',
    );
    const tile = page.getByRole('button', { name: `Details for diagram-${suffix(page)}` });
    await expect(tile).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await tile.click();
    const details = page.getByRole('dialog');
    await expect(details).toContainText('image/png');
    await details.getByLabel('Alternative text').fill('A blue rectangle');
    await details.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Details saved.')).toBeVisible();

    // Files that are not on the allowlist are refused by content, whatever their name.
    await page.keyboard.press('Escape');
    await page.getByLabel('Choose files to upload').setInputFiles({
      name: 'not-really.png',
      mimeType: 'image/png',
      buffer: Buffer.from('<script>alert(1)</script>'),
    });
    await expect(
      page.getByTestId('upload-item').filter({ hasText: 'not-really.png' }),
    ).toContainText('not supported');

    await tile.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete file' }).click();
    await expect(page.getByText('File deleted.')).toBeVisible();
    await expect(tile).toHaveCount(0);
  });
});

test.describe('Operations', () => {
  test('the jobs page shows a running worker and the queue', async ({ page }) => {
    await signIn(page);
    await navigate(page, 'Background jobs');
    await expect(page.getByRole('heading', { level: 1, name: 'Background jobs' })).toBeVisible();
    await expect(page.getByText('No worker is running')).toHaveCount(0);
    await expect(page.getByTestId('job-row').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('the command palette navigates and finds content', async ({ page }) => {
    await signIn(page);
    const title = `Palette target ${suffix(page)}`;
    const created = (await apiAsUser(page, 'POST', '/entries', { type: 'post', title })) as {
      id: string;
    };
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Search and commands' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('media');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/media$/);

    await page.keyboard.press('Control+k');
    await palette.getByRole('combobox').fill(title);
    await expect(palette.getByRole('option', { name: title })).toBeVisible();
    await palette.getByRole('option', { name: title }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/content/post/${created.id}$`));
  });
});
