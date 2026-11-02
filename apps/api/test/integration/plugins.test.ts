import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePluginPackage } from '@nexora/plugin-runtime';
import {
  deliveryPageSchema,
  pluginDetailSchema,
  pluginLogsResponseSchema,
  pluginShortcodesResponseSchema,
  pluginsResponseSchema,
  type DeliveryEntry,
  type PluginDetail,
} from '@nexora/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PluginRuntimeService } from '../../src/modules/extensions/plugin-runtime.service.js';
import { JobWorker } from '../../src/modules/jobs/job-worker.service.js';
import { createEntry, paragraphDoc, patchEntry, signInAs } from '../helpers/content.js';
import {
  createIdentityApp,
  install,
  OWNER,
  resetIdentityData,
  signIn,
  withDb,
  type SignedIn,
} from '../helpers/identity.js';
import type { TestApp } from '../helpers/test-app.js';

const CODE = `
export default {
  shortcodes: {
    async hello(attrs, ctx) {
      const count = ((await ctx.storage.get('count')) ?? 0) + 1;
      await ctx.storage.set('count', count);
      console.log('hello called', count);
      return { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: ctx.settings.greeting + ', ' + attrs.name + '! (' + ctx.entry.title + ')', marks: [{ type: 'bold' }] },
      ] }] };
    },
    evil() {
      return { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
      ] }] };
    },
    async peek(attrs, ctx) {
      try { return (await ctx.content.list({ type: 'post' })).map((item) => item.title).join(' | '); }
      catch (error) { return 'denied: ' + error.message; }
    },
    async fetchit(attrs, ctx) {
      try { await ctx.http.fetch(attrs.url); return 'fetched'; }
      catch (error) { return 'refused: ' + error.message; }
    },
    async big(attrs, ctx) {
      try { await ctx.storage.set('big', 'x'.repeat(20000)); return 'stored'; }
      catch (error) { return 'refused: ' + error.message; }
    },
  },
  hooks: {
    async 'entry.published'(event, ctx) { await ctx.storage.set('last', event.event + ':' + event.entry.title + ':' + event.entry.url); },
    async 'entry.unpublished'(event, ctx) { await ctx.storage.set('last', event.event + ':' + event.entry.title); },
  },
};`;

const MANIFEST = {
  id: 'acme.demo',
  name: 'Demo',
  version: '1.0.0',
  apiVersion: 1,
  main: 'plugin.js',
  description: 'A plugin for tests.',
  settings: [
    { key: 'greeting', label: 'Greeting', type: 'text', default: 'Hello' },
    { key: 'token', label: 'Token', type: 'secret', maxLength: 100 },
  ],
  shortcodes: [
    { name: 'hello', label: 'Hello', attributes: { name: { type: 'string', required: true } } },
    { name: 'evil', label: 'Evil' },
    { name: 'peek', label: 'Peek' },
    { name: 'fetchit', label: 'Fetch', attributes: { url: { type: 'string', maxLength: 500 } } },
    { name: 'big', label: 'Big' },
  ],
  hooks: ['entry.published', 'entry.unpublished'],
};

function packageOf(manifest: object, code = CODE): Buffer {
  return writePluginPackage([
    { name: 'nexora-plugin.json', data: Buffer.from(JSON.stringify(manifest)) },
    { name: 'plugin.js', data: Buffer.from(code) },
    { name: 'README.md', data: Buffer.from('# Demo\n') },
  ]);
}

describe('plugins', () => {
  let testApp: TestApp;
  let owner: SignedIn;
  let admin: SignedIn;
  let editor: SignedIn;
  let bundledDir: string;

  const upload = (user: SignedIn, buffer: Buffer, expected = 201) =>
    user.agent
      .post('/api/v1/plugins')
      .set('X-CSRF-Token', user.csrf)
      .attach('file', buffer, 'plugin.zip')
      .expect(expected);
  const post = (user: SignedIn, path: string, body: object = {}, expected = 201) =>
    user.agent.post(path).set('X-CSRF-Token', user.csrf).send(body).expect(expected);
  const activate = (user: SignedIn, key: string, body: object, expected = 201) =>
    post(user, `/api/v1/plugins/${key}/activate`, body, expected);
  const storage = (key: string) =>
    withDb(async (db) => {
      const rows = await db.query(
        `SELECT s.value FROM plugin_storage s JOIN plugins p ON p.id = s.plugin_id
          WHERE p.key = 'acme.demo' AND s.key = $1`,
        [key],
      );
      return (rows.rows[0] as { value: unknown } | undefined)?.value ?? null;
    });
  async function delivered(path: string): Promise<DeliveryEntry> {
    const response = await request(testApp.server)
      .get('/api/v1/delivery/page')
      .query({ path })
      .expect(200);
    const page = deliveryPageSchema.parse(response.body);
    if (page.route.kind !== 'entry') throw new Error(`no entry at ${path}`);
    return page.route.entry;
  }
  const plainText = (entry: DeliveryEntry, key: string) => {
    const resolved = entry.shortcodes[key];
    if (resolved?.name !== 'plugin') return null;
    return JSON.stringify(resolved.content);
  };

  beforeAll(async () => {
    bundledDir = mkdtempSync(join(tmpdir(), 'nexora-bundled-'));
    const folder = join(bundledDir, 'greeter');
    mkdirSync(folder);
    writeFileSync(
      join(folder, 'nexora-plugin.json'),
      JSON.stringify({
        id: 'nexora.greeter',
        name: 'Greeter',
        version: '1.0.0',
        apiVersion: 1,
        main: 'plugin.js',
        shortcodes: [{ name: 'greet', label: 'Greet' }],
      }),
    );
    writeFileSync(
      join(folder, 'plugin.js'),
      'export default { shortcodes: { greet() { return "Hi from bundled"; } } };',
    );
    await resetIdentityData();
    testApp = await createIdentityApp({ PLUGINS_BUNDLED_DIR: bundledDir });
    await install(testApp.server);
    owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    admin = await signInAs(testApp.server, owner, 'administrator');
    editor = await signInAs(testApp.server, owner, 'editor');
  });
  afterAll(() => testApp.close());

  it('lets only plugins.manage holders manage plugins, and validates packages', async () => {
    await editor.agent.get('/api/v1/plugins').expect(403);
    await upload(editor, packageOf(MANIFEST), 403);
    const empty = pluginsResponseSchema.parse(
      (await admin.agent.get('/api/v1/plugins').expect(200)).body,
    );
    expect(empty.plugins).toEqual([]);
    expect(empty.bundled).toMatchObject([{ id: 'nexora.greeter', installedVersion: null }]);

    const notZip = await upload(admin, Buffer.from('definitely not a zip'), 422);
    expect(notZip.body.error.message).toMatch(/not a ZIP/);
    const invalid = await upload(
      admin,
      packageOf({ ...MANIFEST, id: 'Bad', permissions: ['http:fetch'] }),
      422,
    );
    const issues = (invalid.body as { error: { issues: { path: string }[] } }).error.issues;
    expect(issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['id', 'hosts']));
  });

  it('installs, activates with the exact permissions, and audits the lifecycle', async () => {
    const installed = pluginDetailSchema.parse((await upload(admin, packageOf(MANIFEST))).body);
    expect(installed).toMatchObject({
      id: 'acme.demo',
      status: 'inactive',
      source: 'upload',
      needsApproval: false,
      readme: '# Demo\n',
      settings: { greeting: 'Hello', token: false },
    });
    // Code that does not export a declared handler is refused at activation.
    const broken = {
      ...MANIFEST,
      id: 'acme.broken',
      shortcodes: [{ name: 'missing_one', label: 'M' }],
      hooks: [],
    };
    await upload(admin, packageOf(broken));
    const refused = await activate(admin, 'acme.broken', { permissions: [], hosts: [] }, 422);
    expect(refused.body.error.message).toMatch(/does not export: shortcode "missing_one"/);

    await activate(admin, 'acme.demo', { permissions: ['content:read'], hosts: [] }, 409);
    const active = pluginDetailSchema.parse(
      (await activate(admin, 'acme.demo', { permissions: [], hosts: [] })).body,
    );
    expect(active.status).toBe('active');
    const shortcodes = pluginShortcodesResponseSchema.parse(
      (await editor.agent.get('/api/v1/plugin-shortcodes').expect(200)).body,
    );
    expect(shortcodes.items.map((item) => item.name)).toEqual([
      'hello',
      'evil',
      'peek',
      'fetchit',
      'big',
    ]);

    const actions = await withDb(async (db) =>
      (
        await db.query(
          `SELECT action FROM audit_events WHERE target_type = 'plugin' ORDER BY occurred_at, id`,
        )
      ).rows.map((row: { action: string }) => row.action),
    );
    expect(actions).toEqual(['plugin.installed', 'plugin.installed', 'plugin.activated']);
  });

  it('renders plugin shortcodes on the public site from validated rich text, with storage and settings', async () => {
    await admin.agent
      .put('/api/v1/plugins/acme.demo/settings')
      .set('X-CSRF-Token', admin.csrf)
      .send({ greeting: 'Welcome', token: 's3cret' })
      .expect(200);
    const detail = pluginDetailSchema.parse(
      (await admin.agent.get('/api/v1/plugins/acme.demo').expect(200)).body,
    );
    expect(detail.settings).toEqual({ greeting: 'Welcome', token: true });
    expect(JSON.stringify(detail)).not.toContain('s3cret');
    await admin.agent
      .put('/api/v1/plugins/acme.demo/settings')
      .set('X-CSRF-Token', admin.csrf)
      .send({ greeting: 5 })
      .expect(422);

    const post = await createEntry(owner, {
      title: 'Plugin post',
      status: 'published',
      body: paragraphDoc(
        'A [hello name="Ada"] B [hello] C [evil] D [unknown_plugin_code] E [peek] F [big] G [fetchit url="https://evil.example/"]',
      ),
    });
    const entry = await delivered(post.url ?? '');
    expect(plainText(entry, 'hello?name=Ada')).toContain('Welcome, Ada! (Plugin post)');
    expect(plainText(entry, 'hello?name=Ada')).toContain('"bold"');
    // Missing required attribute: left literal (not resolved). Unknown shortcode: not resolved either.
    expect(entry.shortcodes['hello?']).toBeUndefined();
    expect(entry.shortcodes['unknown_plugin_code?']).toBeUndefined();
    // Output with an unsafe link fails the allowlist: resolved to nothing.
    expect(entry.shortcodes['evil?']).toEqual({
      name: 'plugin',
      plugin: 'acme.demo',
      content: { type: 'doc', content: [] },
    });
    // Capabilities: no content:read, storage quota, http:fetch not granted.
    expect(plainText(entry, 'peek?')).toContain(
      'denied: Permission denied: content:read was not granted.',
    );
    expect(plainText(entry, 'big?')).toContain('refused: Values are limited to 16 KB.');
    expect(plainText(entry, 'fetchit?url=https%3A%2F%2Fevil.example%2F')).toContain(
      'refused: Permission denied: http:fetch was not granted.',
    );
    expect(await storage('count')).toBe(1);
    const logs = pluginLogsResponseSchema.parse(
      (await admin.agent.get('/api/v1/plugins/acme.demo/logs').expect(200)).body,
    );
    expect(logs.items.map((line) => line.message)).toEqual(
      expect.arrayContaining(['hello called 1', expect.stringContaining('evil') as unknown]),
    );
  });

  it('delivers publish events through the job queue with public data only', async () => {
    const worker = testApp.app.get(JobWorker);
    await worker.drain();
    await withDb((db) => db.query(`DELETE FROM plugin_storage WHERE key = 'last'`));
    const draft = await createEntry(owner, { title: 'Quiet draft' });
    await worker.drain();
    expect(await storage('last')).toBeNull();
    const published = await patchEntry(owner, draft, { status: 'published' });
    await worker.drain();
    expect(await storage('last')).toBe('entry.published:Quiet draft:/blog/quiet-draft');
    await post(owner, `/api/v1/entries/${draft.id}/trash`, {}, 200);
    await worker.drain();
    expect(await storage('last')).toBe('entry.unpublished:Quiet draft');
    expect(published.body).toBeDefined();
  });

  it('keeps an update active only when it asks for nothing new, and refuses downgrades', async () => {
    const updated = { ...MANIFEST, version: '1.1.0' };
    const sameGrants = pluginDetailSchema.parse((await upload(admin, packageOf(updated))).body);
    expect(sameGrants).toMatchObject({ version: '1.1.0', status: 'active' });
    const more = { ...MANIFEST, version: '1.2.0', permissions: ['content:read'] };
    const needsReview = pluginDetailSchema.parse((await upload(admin, packageOf(more))).body);
    expect(needsReview).toMatchObject({ status: 'inactive', needsApproval: true });
    const downgrade = await upload(admin, packageOf({ ...MANIFEST, version: '1.0.0' }), 409);
    expect(downgrade.body.error.message).toMatch(/older/);
    // Shortcodes of an inactive plugin stay literal on the site.
    const post = await createEntry(owner, {
      title: 'Inactive plugin',
      status: 'published',
      body: paragraphDoc('Here: [hello name="Bob"]'),
    });
    expect((await delivered(post.url ?? '')).shortcodes).toEqual({});
    // Granting content:read lets the plugin read published content only.
    await activate(admin, 'acme.demo', { permissions: ['content:read'], hosts: [] });
    await createEntry(owner, { title: 'Secret draft' });
    const reader = await createEntry(owner, {
      title: 'Reader',
      status: 'published',
      body: paragraphDoc('[peek]'),
    });
    const peek = plainText(await delivered(reader.url ?? ''), 'peek?') ?? '';
    expect(peek).toContain('Reader');
    expect(peek).not.toContain('Secret draft');
  });

  it('refuses requests to unapproved hosts even with http:fetch', async () => {
    const fetching = {
      ...MANIFEST,
      version: '2.0.0',
      permissions: ['content:read', 'http:fetch'],
      hosts: ['hooks.example.com'],
    };
    await upload(admin, packageOf(fetching));
    await activate(admin, 'acme.demo', {
      permissions: ['content:read', 'http:fetch'],
      hosts: ['hooks.example.com'],
    });
    const post = await createEntry(owner, {
      title: 'Fetcher',
      status: 'published',
      body: paragraphDoc(
        '[fetchit url="https://other.example.com/"] [fetchit url="http://hooks.example.com/"] [fetchit url="https://hooks.example.com:8443/"] [fetchit url="https://127.0.0.1/"]',
      ),
    });
    const entry = await delivered(post.url ?? '');
    const text = (url: string) => plainText(entry, `fetchit?url=${encodeURIComponent(url)}`) ?? '';
    expect(text('https://other.example.com/')).toContain('not approved for this plugin');
    expect(text('http://hooks.example.com/')).toContain('Only https://');
    expect(text('https://hooks.example.com:8443/')).toContain('default HTTPS port');
    expect(text('https://127.0.0.1/')).toContain('IP addresses are not allowed');
  });

  it('marks a plugin as failed after repeated sandbox crashes', async () => {
    const runtime = testApp.app.get(PluginRuntimeService);
    const sandboxes = Reflect.get(runtime, 'sandboxes') as Map<
      string,
      { process: { pid?: number } }
    >;
    const post = await createEntry(owner, {
      title: 'Crash test',
      status: 'published',
      body: paragraphDoc('[hello name="Crash"]'),
    });
    for (let round = 0; round < 3; round += 1) {
      // Bypass the shortcode cache by changing the attribute.
      await patchEntry(owner, await refreshed(post.id), {
        body: paragraphDoc(`[hello name="Crash${String(round)}"]`),
      });
      await delivered(post.url ?? '');
      const sandbox = [...sandboxes.values()][0];
      process.kill(sandbox?.process.pid ?? 0, 'SIGKILL');
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const detail = pluginDetailSchema.parse(
      (await admin.agent.get('/api/v1/plugins/acme.demo').expect(200)).body,
    );
    expect(detail.status).toBe('failed');
    expect(detail.error).toMatch(/Stopped after 3 crashes/);
  });

  it('uninstalls only inactive plugins, removing storage and logs', async () => {
    await admin.agent
      .delete('/api/v1/plugins/acme.broken')
      .set('X-CSRF-Token', admin.csrf)
      .expect(204);
    await activate(admin, 'acme.demo', {
      permissions: ['content:read', 'http:fetch'],
      hosts: ['hooks.example.com'],
    });
    await admin.agent
      .delete('/api/v1/plugins/acme.demo')
      .set('X-CSRF-Token', admin.csrf)
      .expect(409);
    await post(admin, '/api/v1/plugins/acme.demo/deactivate');
    await admin.agent
      .delete('/api/v1/plugins/acme.demo')
      .set('X-CSRF-Token', admin.csrf)
      .expect(204);
    const left = await withDb(async (db) => ({
      storage: (await db.query('SELECT count(*)::int AS n FROM plugin_storage')).rows[0] as {
        n: number;
      },
      logs: (await db.query('SELECT count(*)::int AS n FROM plugin_logs')).rows[0] as { n: number },
    }));
    expect(left).toEqual({ storage: { n: 0 }, logs: { n: 0 } });
  });

  it('installs first-party plugins from the bundled folder; they run sandboxed like any other', async () => {
    const installed: PluginDetail = pluginDetailSchema.parse(
      (await post(admin, '/api/v1/plugins/bundled/nexora.greeter')).body,
    );
    expect(installed).toMatchObject({ source: 'bundled', status: 'inactive' });
    await activate(admin, 'nexora.greeter', { permissions: [], hosts: [] });
    const post2 = await createEntry(owner, {
      title: 'Bundled',
      status: 'published',
      body: paragraphDoc('[greet]'),
    });
    expect(plainText(await delivered(post2.url ?? ''), 'greet?')).toContain('Hi from bundled');
    await post(admin, '/api/v1/plugins/bundled/nexora.missing', {}, 404);
  });

  async function refreshed(id: string) {
    const response = await owner.agent.get(`/api/v1/entries/${id}`).expect(200);
    return response.body as { id: string; version: number };
  }
});

describe('plugins switched off', () => {
  let testApp: TestApp;
  let owner: SignedIn;

  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp({ PLUGINS_ENABLED: 'false' });
    await install(testApp.server);
    owner = await signIn(testApp.server, OWNER.email, OWNER.password);
  });
  afterAll(() => testApp.close());

  it('refuses activation and runs no plugin code', async () => {
    await owner.agent
      .post('/api/v1/plugins')
      .set('X-CSRF-Token', owner.csrf)
      .attach('file', packageOf(MANIFEST), 'plugin.zip')
      .expect(201);
    const refused = await owner.agent
      .post('/api/v1/plugins/acme.demo/activate')
      .set('X-CSRF-Token', owner.csrf)
      .send({ permissions: [], hosts: [] })
      .expect(409);
    expect(refused.body.error.message).toMatch(/PLUGINS_ENABLED=false/);
  });
});
