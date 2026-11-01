import {
  contentTypeSchema,
  deliveryPageSchema,
  redirectListResponseSchema,
  redirectSchema,
  taxonomySchema,
  termSchema,
  type DeliveryRoute,
} from '@nexora/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEntry, idsByKey, patchEntry, signInAs } from '../helpers/content.js';
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

describe('public routes and redirects', () => {
  let testApp: TestApp;
  let owner: SignedIn;
  let editor: SignedIn;
  let author: SignedIn;

  async function resolve(path: string): Promise<DeliveryRoute> {
    const response = await request(testApp.server)
      .get('/api/v1/delivery/page')
      .query({ path })
      .expect(200);
    return deliveryPageSchema.parse(response.body).route;
  }

  async function redirects(): Promise<[string, string, string][]> {
    const response = await owner.agent
      .get('/api/v1/redirects')
      .query({ pageSize: 100 })
      .expect(200);
    return redirectListResponseSchema
      .parse(response.body)
      .items.map((item): [string, string, string] => [item.fromPath, item.toPath, item.source])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  async function clearRedirects(): Promise<void> {
    await withDb((db) => db.query('DELETE FROM redirects'));
  }

  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
    await install(testApp.server);
    owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    editor = await signInAs(testApp.server, owner, 'editor');
    author = await signInAs(testApp.server, owner, 'author');
  });
  afterAll(() => testApp.close());

  it('gives posts, pages and taxonomies their default addresses and reports entry URLs', async () => {
    const { type, taxonomy } = await idsByKey(owner);
    expect([type('post').routePrefix, type('page').routePrefix]).toEqual(['blog', '']);
    expect([taxonomy('category').routePrefix, taxonomy('tag').routePrefix]).toEqual([
      'category',
      'tag',
    ]);
    expect(type('post').isPublic && type('page').isPublic).toBe(true);
    const post = await createEntry(owner, { title: 'Hello world' });
    expect(post.url).toBe('/blog/hello-world');
    const page = await createEntry(owner, { type: 'page', title: 'Über uns' });
    expect(page.url).toBe('/über-uns');
  });

  it('keeps omitted fields on partial content type updates', async () => {
    const created = contentTypeSchema.parse(
      (
        await owner.agent
          .post('/api/v1/content-types')
          .set('X-CSRF-Token', owner.csrf)
          .send({
            key: 'case_study',
            name: 'Case study',
            pluralName: 'Case studies',
            description: 'Customer stories',
            hasExcerpt: false,
            fields: [{ key: 'client', label: 'Client', type: 'text' }],
          })
          .expect(201)
      ).body,
    );
    expect(created).toMatchObject({ routePrefix: 'case-study', isPublic: true });
    const updated = contentTypeSchema.parse(
      (
        await owner.agent
          .patch(`/api/v1/content-types/${created.id}`)
          .set('X-CSRF-Token', owner.csrf)
          .send({ name: 'Story' })
          .expect(200)
      ).body,
    );
    expect(updated).toMatchObject({
      name: 'Story',
      description: 'Customer stories',
      hasExcerpt: false,
      routePrefix: 'case-study',
      isPublic: true,
    });
    expect(updated.fields.map((field) => field.key)).toEqual(['client']);
  });

  it('rejects reserved and colliding route prefixes', async () => {
    const { type, taxonomy } = await idsByKey(owner);
    const patchType = (id: string, body: object) =>
      owner.agent.patch(`/api/v1/content-types/${id}`).set('X-CSRF-Token', owner.csrf).send(body);
    const caseStudy = type('case_study');

    for (const prefix of ['admin', 'api', 'uploads', 'Bad Prefix', 'a--b']) {
      const response = await patchType(caseStudy.id, { routePrefix: prefix }).expect(422);
      expect(response.body.error.issues[0].path).toBe('routePrefix');
    }
    const clash = await patchType(caseStudy.id, { routePrefix: 'tag' }).expect(422);
    expect(clash.body.error.issues[0].message).toContain('Tag');
    const clashType = await patchType(caseStudy.id, { routePrefix: 'blog' }).expect(422);
    expect(clashType.body.error.issues[0].message).toContain('Post');
    const pagePrefix = await patchType(type('page').id, { routePrefix: 'pages' }).expect(422);
    expect(pagePrefix.body.error.issues[0].message).toBe('Pages always live at the site root.');

    // A root page owns its first path segment: no section may take it.
    await createEntry(owner, { type: 'page', title: 'Pricing' });
    const pageClash = await patchType(caseStudy.id, { routePrefix: 'pricing' }).expect(422);
    expect(pageClash.body.error.issues[0].message).toContain('A page already uses this address');
    const taxonomyClash = await owner.agent
      .patch(`/api/v1/taxonomies/${taxonomy('tag').id}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ routePrefix: 'case-study' })
      .expect(422);
    expect(taxonomyClash.body.error.issues[0].message).toContain('Story');
    const newType = await owner.agent
      .post('/api/v1/content-types')
      .set('X-CSRF-Token', owner.csrf)
      .send({ key: 'category', name: 'Cat', pluralName: 'Cats' })
      .expect(422);
    expect(newType.body.error.issues[0].path).toBe('routePrefix');
  });

  it('keeps root pages off application paths and section prefixes', async () => {
    for (const slug of ['admin', 'api', 'uploads', 'blog', 'category', 'case-study']) {
      const response = await createEntry(owner, { type: 'page', title: 'X', slug }, 422);
      expect(
        (response as unknown as { error: { issues: { path: string }[] } }).error.issues[0]?.path,
      ).toBe('slug');
    }
    // Generated slugs step around them; nested pages may use the words freely.
    const blogPage = await createEntry(owner, { type: 'page', title: 'Blog' });
    expect(blogPage.url).toBe('/blog-2');
    const nested = await createEntry(owner, {
      type: 'page',
      title: 'Admin',
      parentId: blogPage.id,
    });
    expect(nested.url).toBe('/blog-2/admin');
    // Moving it to the root is refused.
    await patchEntry(owner, nested, { parentId: null }, 422);
  });

  it('redirects the old addresses of a moved published page and its published children', async () => {
    await clearRedirects();
    const company = await createEntry(owner, {
      type: 'page',
      title: 'Company',
      status: 'published',
    });
    const team = await createEntry(owner, {
      type: 'page',
      title: 'Team',
      parentId: company.id,
      status: 'published',
    });
    const draftChild = await createEntry(owner, {
      type: 'page',
      title: 'Jobs',
      parentId: company.id,
    });
    expect(team.url).toBe('/company/team');

    const renamed = (await patchEntry(owner, company, { slug: 'about-us' })).body as {
      version: number;
    };
    expect(await redirects()).toEqual([
      ['/company', '/about-us', 'auto'],
      ['/company/team', '/about-us/team', 'auto'],
    ]);
    expect(await resolve('/company/team')).toEqual({
      kind: 'redirect',
      location: '/about-us/team',
      statusCode: 301,
    });
    expect((await resolve('/about-us/team')).kind).toBe('entry');
    expect(draftChild.id).toBeDefined();

    // A second move flattens the chain; moving back removes the redirect away from the live page.
    const again = (
      await patchEntry(owner, { id: company.id, version: renamed.version }, { slug: 'who-we-are' })
    ).body as { version: number };
    expect(await redirects()).toEqual([
      ['/about-us', '/who-we-are', 'auto'],
      ['/about-us/team', '/who-we-are/team', 'auto'],
      ['/company', '/who-we-are', 'auto'],
      ['/company/team', '/who-we-are/team', 'auto'],
    ]);
    await patchEntry(owner, { id: company.id, version: again.version }, { slug: 'company' });
    expect(await redirects()).toEqual([
      ['/about-us', '/company', 'auto'],
      ['/about-us/team', '/company/team', 'auto'],
      ['/who-we-are', '/company', 'auto'],
      ['/who-we-are/team', '/company/team', 'auto'],
    ]);
    expect((await resolve('/company')).kind).toBe('entry');
  });

  it('does not redirect drafts, and redirects posts within their prefix', async () => {
    await clearRedirects();
    const draft = await createEntry(owner, { title: 'Unfinished' });
    await patchEntry(owner, draft, { slug: 'still-unfinished' });
    expect(await redirects()).toEqual([]);

    const post = await createEntry(owner, { title: 'Launch', status: 'published' });
    await patchEntry(owner, post, { slug: 'launch-day' });
    expect(await redirects()).toEqual([['/blog/launch', '/blog/launch-day', 'auto']]);
  });

  it('redirects term archives when a slug or a taxonomy prefix changes', async () => {
    await clearRedirects();
    const { taxonomy } = await idsByKey(owner);
    const term = termSchema.parse(
      (
        await owner.agent
          .post(`/api/v1/taxonomies/${taxonomy('tag').id}/terms`)
          .set('X-CSRF-Token', owner.csrf)
          .send({ name: 'Releases' })
          .expect(201)
      ).body,
    );
    await owner.agent
      .patch(`/api/v1/terms/${term.id}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ slug: 'release-notes' })
      .expect(200);
    expect(await redirects()).toEqual([['/tag/releases', '/tag/release-notes', 'auto']]);

    const updated = taxonomySchema.parse(
      (
        await owner.agent
          .patch(`/api/v1/taxonomies/${taxonomy('tag').id}`)
          .set('X-CSRF-Token', owner.csrf)
          .send({ routePrefix: 'topic' })
          .expect(200)
      ).body,
    );
    expect(updated.routePrefix).toBe('topic');
    expect(await redirects()).toEqual([
      ['/tag/release-notes', '/topic/release-notes', 'auto'],
      ['/tag/releases', '/topic/release-notes', 'auto'],
    ]);
  });

  it('redirects published entries and the archive when a content type prefix changes', async () => {
    await clearRedirects();
    const { type } = await idsByKey(owner);
    const story = await createEntry(owner, {
      type: 'case_study',
      title: 'Acme',
      status: 'published',
    });
    await createEntry(owner, { type: 'case_study', title: 'Secret draft' });
    expect(story.url).toBe('/case-study/acme');
    await owner.agent
      .patch(`/api/v1/content-types/${type('case_study').id}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ routePrefix: 'customers' })
      .expect(200);
    expect(await redirects()).toEqual([
      ['/case-study', '/customers', 'auto'],
      ['/case-study/acme', '/customers/acme', 'auto'],
    ]);
    expect((await resolve('/customers/acme')).kind).toBe('entry');
    expect((await resolve('/case-study/acme')).kind).toBe('redirect');
  });

  it('manages manual redirects with validation, loop detection and permissions', async () => {
    await clearRedirects();
    const create = (user: SignedIn, body: object) =>
      user.agent.post('/api/v1/redirects').set('X-CSRF-Token', user.csrf).send(body);

    await create(author, { fromPath: '/old', toPath: '/new' }).expect(403);
    const created = redirectSchema.parse(
      (await create(editor, { fromPath: '/old-page/', toPath: '/new-page?ref=1#top' }).expect(201))
        .body,
    );
    expect(created).toMatchObject({
      fromPath: '/old-page',
      toPath: '/new-page?ref=1#top',
      statusCode: 301,
      source: 'manual',
    });
    // Percent-encoded sources are stored decoded, like the paths the site runtime looks up.
    const encoded = redirectSchema.parse(
      (
        await create(editor, {
          fromPath: '/%D8%AA%D9%85%D8%A7%D8%B3',
          toPath: 'https://example.org/x',
          statusCode: 302,
        }).expect(201)
      ).body,
    );
    expect(encoded.fromPath).toBe('/تماس');
    expect(await resolve('/تماس')).toEqual({
      kind: 'redirect',
      location: 'https://example.org/x',
      statusCode: 302,
    });
    expect(await resolve('/old-page')).toEqual({
      kind: 'redirect',
      location: '/new-page?ref=1#top',
      statusCode: 301,
    });

    const bad: [object, string][] = [
      [{ fromPath: '/x', toPath: 'javascript:alert(1)' }, 'toPath'],
      [{ fromPath: '/x', toPath: '//evil.example' }, 'toPath'],
      [{ fromPath: '/x', toPath: 'https://user:pw@evil.example' }, 'toPath'],
      [{ fromPath: '/x', toPath: '/x' }, 'toPath'],
      [{ fromPath: '/admin/login', toPath: '/x' }, 'fromPath'],
      [{ fromPath: '/_preview/abc', toPath: '/x' }, 'fromPath'],
      [{ fromPath: '/sitemap.xml', toPath: '/x' }, 'fromPath'],
      [{ fromPath: '/', toPath: '/x' }, 'fromPath'],
      [{ fromPath: 'relative', toPath: '/x' }, 'fromPath'],
      [{ fromPath: '/a b', toPath: '/x' }, 'fromPath'],
      [{ fromPath: '/x', toPath: '/y', statusCode: 404 }, 'statusCode'],
    ];
    for (const [body, path] of bad) {
      const response = await create(editor, body).expect(422);
      expect(response.body.error.issues[0].path, JSON.stringify(body)).toBe(path);
    }
    const duplicate = await create(editor, { fromPath: '/old-page', toPath: '/other' }).expect(422);
    expect(duplicate.body.error.issues[0].message).toBe(
      'A redirect from this path already exists.',
    );

    await create(editor, { fromPath: '/a', toPath: '/b' }).expect(201);
    await create(editor, { fromPath: '/b', toPath: '/c' }).expect(201);
    const loop = await create(editor, { fromPath: '/c', toPath: '/a' }).expect(422);
    expect(loop.body.error.issues[0].message).toBe('This redirect would create a loop.');

    const updated = redirectSchema.parse(
      (
        await editor.agent
          .patch(`/api/v1/redirects/${created.id}`)
          .set('X-CSRF-Token', editor.csrf)
          .send({ statusCode: 308 })
          .expect(200)
      ).body,
    );
    expect(updated.statusCode).toBe(308);
    await editor.agent
      .delete(`/api/v1/redirects/${created.id}`)
      .set('X-CSRF-Token', editor.csrf)
      .expect(204);
    expect((await resolve('/old-page')).kind).toBe('not_found');

    const search = redirectListResponseSchema.parse(
      (
        await editor.agent
          .get('/api/v1/redirects')
          .query({ search: '/b', source: 'manual' })
          .expect(200)
      ).body,
    );
    expect(search.items.map((item) => item.fromPath).sort()).toEqual(['/a', '/b']);

    const actions = await withDb(async (db) =>
      (
        await db.query(
          `SELECT action FROM audit_events WHERE action LIKE 'redirect.%' ORDER BY occurred_at, id`,
        )
      ).rows.map((row: { action: string }) => row.action),
    );
    expect(actions).toEqual([
      'redirect.created',
      'redirect.created',
      'redirect.created',
      'redirect.created',
      'redirect.updated',
      'redirect.deleted',
    ]);
  });
});
