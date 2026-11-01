import {
  generalSettingsSchema,
  menuDetailSchema,
  menusResponseSchema,
  seoSettingsResponseSchema,
  themeSettingsResponseSchema,
  themesResponseSchema,
} from '@nexora/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEntry, signInAs } from '../helpers/content.js';
import {
  createIdentityApp,
  install,
  OWNER,
  resetIdentityData,
  signIn,
  withDb,
  type SignedIn,
} from '../helpers/identity.js';
import { MINIMAL_PDF, pngImage, upload } from '../helpers/media.js';
import type { TestApp } from '../helpers/test-app.js';

const GENERAL = {
  name: 'Renamed Site',
  tagline: 'Fresh ideas',
  language: 'fa-IR',
  homepage: { mode: 'posts' },
  postsPerPage: 5,
};
const SEO = {
  titleTemplate: '%title% | %site%',
  defaultDescription: 'About this site',
  defaultImageId: null,
  indexing: false,
};

describe('appearance, site settings and menus', () => {
  let testApp: TestApp;
  let owner: SignedIn;
  let admin: SignedIn;
  let editor: SignedIn;
  let author: SignedIn;

  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
    await install(testApp.server);
    owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    admin = await signInAs(testApp.server, owner, 'administrator');
    editor = await signInAs(testApp.server, owner, 'editor');
    author = await signInAs(testApp.server, owner, 'author');
  });
  afterAll(() => testApp.close());

  it('lets administrators edit general settings and SEO managers edit SEO settings', async () => {
    await editor.agent.get('/api/v1/settings/general').expect(403);
    await author.agent.get('/api/v1/settings/seo').expect(403);
    await author.agent.get('/api/v1/appearance/themes').expect(403);
    await editor.agent.get('/api/v1/menus').expect(403);

    const defaults = generalSettingsSchema.parse(
      (await admin.agent.get('/api/v1/settings/general').expect(200)).body,
    );
    expect(defaults).toEqual({
      name: 'Test Site',
      tagline: '',
      language: 'en',
      homepage: { mode: 'posts' },
      postsPerPage: 10,
    });
    const saved = generalSettingsSchema.parse(
      (
        await admin.agent
          .put('/api/v1/settings/general')
          .set('X-CSRF-Token', admin.csrf)
          .send(GENERAL)
          .expect(200)
      ).body,
    );
    expect(saved).toEqual(GENERAL);
    for (const body of [
      { ...GENERAL, language: 'not a language' },
      { ...GENERAL, postsPerPage: 0 },
      { ...GENERAL, name: '' },
      { ...GENERAL, homepage: { mode: 'page' } },
    ]) {
      await admin.agent
        .put('/api/v1/settings/general')
        .set('X-CSRF-Token', admin.csrf)
        .send(body)
        .expect(422);
    }

    const seo = seoSettingsResponseSchema.parse(
      (
        await editor.agent
          .put('/api/v1/settings/seo')
          .set('X-CSRF-Token', editor.csrf)
          .send(SEO)
          .expect(200)
      ).body,
    );
    expect(seo).toEqual({ ...SEO, defaultImage: null });
    const noTitle = await editor.agent
      .put('/api/v1/settings/seo')
      .set('X-CSRF-Token', editor.csrf)
      .send({ ...SEO, titleTemplate: 'Just the site' })
      .expect(422);
    expect(noTitle.body.error.issues[0].message).toBe('The template must contain %title%.');

    const pdf = (await upload(editor, MINIMAL_PDF, 'doc.pdf').expect(201)).body as { id: string };
    const notImage = await editor.agent
      .put('/api/v1/settings/seo')
      .set('X-CSRF-Token', editor.csrf)
      .send({ ...SEO, defaultImageId: pdf.id })
      .expect(422);
    expect(notImage.body.error.issues[0].path).toBe('defaultImageId');
    const image = (await upload(editor, await pngImage(1200, 630), 'share.png').expect(201))
      .body as { id: string };
    const withImage = seoSettingsResponseSchema.parse(
      (
        await editor.agent
          .put('/api/v1/settings/seo')
          .set('X-CSRF-Token', editor.csrf)
          .send({ ...SEO, defaultImageId: image.id })
          .expect(200)
      ).body,
    );
    expect(withImage.defaultImage?.id).toBe(image.id);

    // Both sections live in one JSON document; saving one never clobbers the other.
    const general = generalSettingsSchema.parse(
      (await admin.agent.get('/api/v1/settings/general').expect(200)).body,
    );
    expect(general).toEqual(GENERAL);
    const actions = await withDb(async (db) =>
      (
        await db.query(
          `SELECT action FROM audit_events WHERE action LIKE 'settings.%' ORDER BY occurred_at, id`,
        )
      ).rows.map((row: { action: string }) => row.action),
    );
    expect(actions).toEqual([
      'settings.general_updated',
      'settings.seo_updated',
      'settings.seo_updated',
    ]);
  });

  it('validates theme settings against the theme manifest', async () => {
    const themes = themesResponseSchema.parse(
      (await admin.agent.get('/api/v1/appearance/themes').expect(200)).body,
    );
    expect(themes.activeTheme).toBe('starter');
    expect(themes.themes.map((theme) => theme.key)).toEqual(['starter']);
    expect(themes.themes[0]?.menuLocations.map((location) => location.key)).toEqual([
      'primary',
      'footer',
    ]);
    await admin.agent
      .put('/api/v1/appearance/theme')
      .set('X-CSRF-Token', admin.csrf)
      .send({ theme: 'missing-theme' })
      .expect(404);
    await admin.agent
      .put('/api/v1/appearance/theme')
      .set('X-CSRF-Token', admin.csrf)
      .send({ theme: 'starter' })
      .expect(200);

    const defaults = themeSettingsResponseSchema.parse(
      (await admin.agent.get('/api/v1/appearance/themes/starter/settings').expect(200)).body,
    );
    expect(defaults.values).toEqual({
      accentColor: '#1d4ed8',
      colorScheme: 'auto',
      fontFamily: 'system',
      contentWidth: 'normal',
      logo: null,
      showTagline: true,
      footerText: '',
    });
    const put = (values: Record<string, unknown>) =>
      admin.agent
        .put('/api/v1/appearance/themes/starter/settings')
        .set('X-CSRF-Token', admin.csrf)
        .send({ values });

    const invalid: [Record<string, unknown>, string][] = [
      [{ accentColor: 'red' }, 'values.accentColor'],
      [{ accentColor: '#12345g' }, 'values.accentColor'],
      [{ accentColor: '#000; background:url(x)' }, 'values.accentColor'],
      [{ colorScheme: 'neon' }, 'values.colorScheme'],
      [{ showTagline: 'yes' }, 'values.showTagline'],
      [{ footerText: 'line\nbreak' }, 'values.footerText'],
      [{ footerText: 'x'.repeat(301) }, 'values.footerText'],
      [{ logo: 'not-a-uuid' }, 'values.logo'],
      [{ unknownSetting: true }, 'values'],
    ];
    for (const [values, path] of invalid) {
      const response = await put(values).expect(422);
      expect(response.body.error.issues[0].path, JSON.stringify(values)).toBe(path);
    }
    const pdf = (await upload(admin, MINIMAL_PDF, 'doc.pdf').expect(201)).body as { id: string };
    expect((await put({ logo: pdf.id }).expect(422)).body.error.issues[0].path).toBe('values.logo');

    const logo = (await upload(admin, await pngImage(400, 100), 'logo.png').expect(201)).body as {
      id: string;
    };
    const saved = themeSettingsResponseSchema.parse(
      (await put({ accentColor: '#B91C1C', logo: logo.id, footerText: '© Example' }).expect(200))
        .body,
    );
    expect(saved.values).toMatchObject({
      accentColor: '#b91c1c',
      logo: logo.id,
      footerText: '© Example',
      colorScheme: 'auto',
    });
    expect(saved.media.logo?.id).toBe(logo.id);
    await admin.agent.get('/api/v1/appearance/themes/other/settings').expect(404);

    // Stale stored values (e.g. after a theme update) fall back to defaults instead of failing.
    await withDb((db) =>
      db.query(
        `UPDATE sites SET theme_settings = jsonb_set(theme_settings, '{starter,colorScheme}', '"removed-option"')`,
      ),
    );
    const resolved = themeSettingsResponseSchema.parse(
      (await admin.agent.get('/api/v1/appearance/themes/starter/settings').expect(200)).body,
    );
    expect(resolved.values.colorScheme).toBe('auto');
    expect(resolved.values.accentColor).toBe('#b91c1c');
  });

  it('builds menus as trees, assigns them to theme locations and validates links', async () => {
    const about = await createEntry(owner, { type: 'page', title: 'About', status: 'published' });
    const draft = await createEntry(owner, { type: 'page', title: 'Draft' });
    const main = menuDetailSchema.parse(
      (
        await admin.agent
          .post('/api/v1/menus')
          .set('X-CSRF-Token', admin.csrf)
          .send({ name: 'Main', location: 'primary' })
          .expect(201)
      ).body,
    );
    const save = (id: string, body: Record<string, unknown>) =>
      admin.agent.put(`/api/v1/menus/${id}`).set('X-CSRF-Token', admin.csrf).send(body);

    const saved = menuDetailSchema.parse(
      (
        await save(main.id, {
          name: 'Main navigation',
          location: 'primary',
          items: [
            { key: 'a', kind: 'entry', entryId: about.id },
            { key: 'a1', parentKey: 'a', kind: 'url', url: '/about#team', label: 'Team' },
            {
              key: 'a2',
              parentKey: 'a1',
              kind: 'url',
              url: 'mailto:hi@example.test',
              label: 'Mail',
            },
            { key: 'b', kind: 'entry', entryId: draft.id, label: 'Soon' },
            { key: 'h', kind: 'home', label: 'Start' },
          ],
        }).expect(200)
      ).body,
    );
    expect(
      saved.items.map((item) => [item.label, item.kind, item.target.url, item.target.state]),
    ).toEqual([
      ['', 'entry', '/about', 'available'],
      ['Team', 'url', '/about#team', 'available'],
      ['Mail', 'url', 'mailto:hi@example.test', 'available'],
      ['Soon', 'entry', '/draft', 'unpublished'],
      ['Start', 'home', '/', 'available'],
    ]);
    expect(saved.items[1]?.parentId).toBe(saved.items[0]?.id);
    expect(saved.items[2]?.parentId).toBe(saved.items[1]?.id);
    expect(saved.items[0]?.target.title).toBe('About');

    const invalid: [Record<string, unknown>[], string][] = [
      [[{ key: 'x', kind: 'url', url: 'javascript:alert(1)', label: 'X' }], 'items.0.url'],
      [[{ key: 'x', kind: 'url', url: '//evil.example', label: 'X' }], 'items.0.url'],
      [[{ key: 'x', kind: 'url', url: '/ok' }], 'items.0.label'],
      [[{ key: 'x', kind: 'entry' }], 'items.0.entryId'],
      [[{ key: 'x', kind: 'home', url: '/x' }], 'items.0.url'],
      [
        [
          { key: 'x', parentKey: 'later', kind: 'home' },
          { key: 'later', kind: 'home' },
        ],
        'items.0.parentKey',
      ],
      [
        [
          { key: '1', kind: 'home' },
          { key: '2', parentKey: '1', kind: 'home' },
          { key: '3', parentKey: '2', kind: 'home' },
          { key: '4', parentKey: '3', kind: 'home' },
        ],
        'items.3.parentKey',
      ],
      [
        [
          { key: 'd', kind: 'home' },
          { key: 'd', kind: 'home' },
        ],
        'items.1.key',
      ],
      [
        Array.from({ length: 201 }, (_, index) => ({ key: `k${String(index)}`, kind: 'home' })),
        'items',
      ],
    ];
    for (const [items, path] of invalid) {
      const response = await save(main.id, { name: 'Main', location: null, items }).expect(422);
      expect(response.body.error.issues[0].path, JSON.stringify(items).slice(0, 80)).toBe(path);
    }
    const unknownLocation = await save(main.id, {
      name: 'Main',
      location: 'sidebar',
      items: [],
    }).expect(422);
    expect(unknownLocation.body.error.issues[0].path).toBe('location');
    const missingEntry = await save(main.id, {
      name: 'Main',
      location: null,
      items: [{ key: 'x', kind: 'entry', entryId: '00000000-0000-4000-8000-000000000000' }],
    }).expect(422);
    expect(missingEntry.body.error.issues[0].path).toBe('items');

    // Assigning a location moves it from the menu that had it.
    const footer = menuDetailSchema.parse(
      (
        await admin.agent
          .post('/api/v1/menus')
          .set('X-CSRF-Token', admin.csrf)
          .send({ name: 'Footer', location: 'primary' })
          .expect(201)
      ).body,
    );
    let list = menusResponseSchema.parse((await admin.agent.get('/api/v1/menus').expect(200)).body);
    expect(list.locations).toEqual([
      { key: 'primary', label: 'Header navigation', menuId: footer.id },
      { key: 'footer', label: 'Footer links', menuId: null },
    ]);
    expect(list.menus.find((menu) => menu.id === main.id)).toMatchObject({
      location: null,
      itemCount: 5,
    });

    // Deleting a linked entry removes its menu item (and the item's children).
    await withDb((db) => db.query('DELETE FROM entries WHERE id = $1', [about.id]));
    const afterDelete = menuDetailSchema.parse(
      (await admin.agent.get(`/api/v1/menus/${main.id}`).expect(200)).body,
    );
    expect(afterDelete.items.map((item) => item.label)).toEqual(['Soon', 'Start']);

    await admin.agent
      .delete(`/api/v1/menus/${footer.id}`)
      .set('X-CSRF-Token', admin.csrf)
      .expect(204);
    list = menusResponseSchema.parse((await admin.agent.get('/api/v1/menus').expect(200)).body);
    expect(list.menus.map((menu) => menu.name)).toEqual(['Main navigation']);
    const actions = await withDb(async (db) =>
      (
        await db.query(
          `SELECT action FROM audit_events WHERE action LIKE 'menu.%' ORDER BY occurred_at, id`,
        )
      ).rows.map((row: { action: string }) => row.action),
    );
    expect(actions).toEqual(['menu.created', 'menu.updated', 'menu.created', 'menu.deleted']);
  });
});
