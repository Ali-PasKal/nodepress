import {
  deliveryFeedSchema,
  deliveryPageSchema,
  deliverySiteSchema,
  deliverySitemapSchema,
  menuDetailSchema,
  previewLinkSchema,
  type DeliveryPage,
} from '@nexora/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEntry, idsByKey, paragraphDoc, patchEntry, signInAs } from '../helpers/content.js';
import {
  createIdentityApp,
  install,
  OWNER,
  resetIdentityData,
  signIn,
  withDb,
  type SignedIn,
} from '../helpers/identity.js';
import { pngImage, upload } from '../helpers/media.js';
import type { TestApp } from '../helpers/test-app.js';

describe('delivery API', () => {
  let testApp: TestApp;
  let owner: SignedIn;
  let author: SignedIn;

  async function page(path: string, pageNumber = 1): Promise<DeliveryPage> {
    const response = await request(testApp.server)
      .get('/api/v1/delivery/page')
      .query({ path, page: pageNumber })
      .expect(200);
    return deliveryPageSchema.parse(response.body);
  }

  async function kind(path: string): Promise<string> {
    return (await page(path)).route.kind;
  }

  async function putGeneral(body: Record<string, unknown>): Promise<void> {
    await owner.agent
      .put('/api/v1/settings/general')
      .set('X-CSRF-Token', owner.csrf)
      .send({
        name: 'Test Site',
        tagline: '',
        language: 'en',
        homepage: { mode: 'posts' },
        postsPerPage: 10,
        ...body,
      })
      .expect(200);
  }

  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
    await install(testApp.server);
    owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    author = await signInAs(testApp.server, owner, 'author');
  });
  afterAll(() => testApp.close());

  it('never returns content that is not publicly visible', async () => {
    const published = await createEntry(owner, { title: 'Visible post', status: 'published' });
    await createEntry(owner, { title: 'Draft post' });
    await createEntry(owner, { title: 'Pending post', status: 'pending' });
    await createEntry(owner, {
      title: 'Scheduled post',
      status: 'scheduled',
      publishedAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const trashed = await createEntry(owner, { title: 'Trashed post', status: 'published' });
    await owner.agent
      .post(`/api/v1/entries/${trashed.id}/trash`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(200);
    // Defence in depth: a "published" row whose publication time lies ahead is still hidden.
    const future = await createEntry(owner, { title: 'Future published', status: 'published' });
    await withDb((db) =>
      db.query(`UPDATE entries SET published_at = now() + interval '1 day' WHERE id = $1`, [
        future.id,
      ]),
    );
    const draftParent = await createEntry(owner, { type: 'page', title: 'Hidden parent' });
    const orphan = await createEntry(owner, {
      type: 'page',
      title: 'Published child',
      parentId: draftParent.id,
      status: 'published',
    });
    const internalType = await owner.agent
      .post('/api/v1/content-types')
      .set('X-CSRF-Token', owner.csrf)
      .send({ key: 'memo', name: 'Memo', pluralName: 'Memos', isPublic: false })
      .expect(201);
    expect(internalType.body.isPublic).toBe(false);
    const memo = await createEntry(owner, { type: 'memo', title: 'Internal', status: 'published' });
    expect(memo.url).toBeNull();

    expect(await kind('/blog/visible-post')).toBe('entry');
    for (const path of [
      '/blog/draft-post',
      '/blog/pending-post',
      '/blog/scheduled-post',
      '/blog/trashed-post',
      '/blog/future-published',
      '/hidden-parent',
      '/hidden-parent/published-child',
      '/memo',
      '/memo/internal',
    ]) {
      expect(await kind(path), path).toBe('not_found');
    }
    expect(orphan.url).toBe('/hidden-parent/published-child');

    const home = await page('/');
    expect(
      home.route.kind === 'home' && home.route.listing?.items.map((item) => item.title),
    ).toEqual(['Visible post']);
    const archive = await page('/blog');
    expect(
      archive.route.kind === 'archive' && archive.route.listing.items.map((item) => item.id),
    ).toEqual([published.id]);

    const sitemap = deliverySitemapSchema.parse(
      (await request(testApp.server).get('/api/v1/delivery/sitemap').expect(200)).body,
    );
    expect(sitemap.urls.map((url) => url.path).sort()).toEqual([
      '/',
      '/blog',
      '/blog/visible-post',
    ]);
    const feed = deliveryFeedSchema.parse(
      (await request(testApp.server).get('/api/v1/delivery/feed').expect(200)).body,
    );
    expect(feed.items.map((item) => item.title)).toEqual(['Visible post']);

    // Once the parent is published, the child appears.
    await patchEntry(owner, draftParent, { status: 'published' });
    expect(await kind('/hidden-parent/published-child')).toBe('entry');
  });

  it('delivers entries with public fields, media, terms and SEO, and nothing private', async () => {
    const { type, taxonomy } = await idsByKey(owner);
    const image = (await upload(owner, await pngImage(800, 600), 'photo.png').expect(201)).body as {
      id: string;
    };
    await owner.agent
      .patch(`/api/v1/content-types/${type('post').id}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({
        fields: [
          { key: 'subtitle', label: 'Subtitle', type: 'text', public: true },
          {
            key: 'mood',
            label: 'Mood',
            type: 'select',
            public: true,
            options: [{ value: 'happy', label: 'Happy' }],
          },
          { key: 'notes', label: 'Internal notes', type: 'textarea' },
        ],
      })
      .expect(200);
    const term = (
      await owner.agent
        .post(`/api/v1/taxonomies/${taxonomy('category').id}/terms`)
        .set('X-CSRF-Token', owner.csrf)
        .send({ name: 'News' })
        .expect(201)
    ).body as { id: string };
    const entry = await createEntry(owner, {
      title: '<script>alert(1)</script> Rich',
      slug: 'rich',
      status: 'published',
      excerpt: '',
      body: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Body text for the summary.' }] },
          { type: 'image', attrs: { src: '/uploads/x.png', alt: 'Alt', mediaId: image.id } },
        ],
      },
      fields: { subtitle: 'Sub', mood: 'happy', notes: 'secret note' },
      termIds: [term.id],
      featuredMediaId: image.id,
      seo: { title: 'SEO title', description: 'SEO description', noindex: false },
    });
    const result = await page('/blog/rich');
    if (result.route.kind !== 'entry') throw new Error('expected an entry');
    const delivered = result.route.entry;
    expect(delivered).toMatchObject({
      id: entry.id,
      title: '<script>alert(1)</script> Rich',
      url: '/blog/rich',
      canonicalUrl: 'https://site.example.test/blog/rich',
      // No excerpt: the start of the body text (including image descriptions).
      summary: 'Body text for the summary. Alt',
      author: { displayName: OWNER.displayName },
      seo: { title: 'SEO title', description: 'SEO description', noindex: false },
      contentType: { key: 'post', name: 'Post' },
    });
    expect(delivered.fields).toEqual([
      { key: 'subtitle', label: 'Subtitle', type: 'text', value: 'Sub', display: 'Sub' },
      { key: 'mood', label: 'Mood', type: 'select', value: 'happy', display: 'Happy' },
    ]);
    expect(delivered.terms).toEqual([
      {
        taxonomy: 'category',
        taxonomyName: 'Category',
        name: 'News',
        slug: 'news',
        url: '/category/news',
      },
    ]);
    expect(delivered.featuredMedia).toMatchObject({ id: image.id, width: 800, height: 600 });
    expect(Object.keys(delivered.media)).toEqual([image.id]);
    const raw = JSON.stringify(result);
    expect(raw).not.toContain('secret note');
    expect(raw).not.toContain(OWNER.email);
    expect(raw).not.toContain('passwordHash');

    const archive = await page('/category/news');
    expect(archive.route.kind === 'archive' && archive.route.archive).toMatchObject({
      type: 'term',
      term: { name: 'News', slug: 'news' },
    });
    expect(await kind('/category/missing')).toBe('not_found');
    expect(await kind('/category')).toBe('not_found');

    // A non-public taxonomy has no archives and its terms are not delivered.
    await owner.agent
      .patch(`/api/v1/taxonomies/${taxonomy('category').id}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ isPublic: false })
      .expect(200);
    expect(await kind('/category/news')).toBe('not_found');
    const again = await page('/blog/rich');
    expect(again.route.kind === 'entry' && again.route.entry.terms).toEqual([]);
    await owner.agent
      .patch(`/api/v1/taxonomies/${taxonomy('category').id}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ isPublic: true })
      .expect(200);
  });

  it('paginates listings and supports a static home page', async () => {
    await withDb((db) => db.query('DELETE FROM entries'));
    for (const title of ['One', 'Two', 'Three']) {
      await createEntry(owner, { title, status: 'published' });
    }
    await putGeneral({ postsPerPage: 2 });
    const first = await page('/');
    expect(first.route.kind === 'home' && first.route.listing).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 3,
      totalPages: 2,
    });
    const second = await page('/', 2);
    expect(
      second.route.kind === 'home' && second.route.listing?.items.map((item) => item.title),
    ).toEqual(['One']);
    expect(second.route.kind === 'home' && second.route.canonicalUrl).toBe(
      'https://site.example.test/?page=2',
    );
    expect((await page('/', 3)).route.kind).toBe('not_found');
    expect((await page('/blog', 2)).route.kind).toBe('archive');
    expect((await page('/blog', 9)).route.kind).toBe('not_found');

    const welcome = await createEntry(owner, {
      type: 'page',
      title: 'Welcome',
      status: 'published',
      body: paragraphDoc('Hello visitors'),
    });
    const post = await createEntry(owner, { title: 'Not a page' });
    const wrong = await owner.agent
      .put('/api/v1/settings/general')
      .set('X-CSRF-Token', owner.csrf)
      .send({
        name: 'Test Site',
        tagline: '',
        language: 'en',
        homepage: { mode: 'page', pageId: post.id },
        postsPerPage: 2,
      })
      .expect(422);
    expect(wrong.body.error.issues[0].path).toBe('homepage.pageId');
    await putGeneral({ homepage: { mode: 'page', pageId: welcome.id }, postsPerPage: 2 });
    const home = await page('/');
    expect(home.route.kind === 'home' && home.route.entry?.title).toBe('Welcome');
    expect(home.route.kind === 'home' && home.route.entry?.url).toBe('/');
    expect((await page('/', 2)).route.kind).toBe('not_found');
    // The page's own address shows it with the home page as canonical URL.
    const own = await page('/welcome');
    expect(own.route.kind === 'entry' && own.route.entry.canonicalUrl).toBe(
      'https://site.example.test/',
    );
    // An unpublished home page falls back to the latest posts.
    await patchEntry(owner, welcome, { status: 'draft' });
    const fallback = await page('/');
    expect(fallback.route.kind === 'home' && fallback.route.listing?.total).toBe(3);
    await putGeneral({});
  });

  it('normalises paths, resolves non-Latin slugs and reports site settings', async () => {
    expect((await page('/blog/one/')).route).toEqual({
      kind: 'redirect',
      location: '/blog/one',
      statusCode: 301,
    });
    expect(await kind('/blog//one')).toBe('not_found');
    const persian = await createEntry(owner, {
      type: 'page',
      title: 'درباره ما',
      status: 'published',
    });
    expect(persian.url).toBe('/درباره-ما');
    expect(await kind('/درباره-ما')).toBe('entry');
    await request(testApp.server)
      .get('/api/v1/delivery/page')
      .query({ path: 'no-leading-slash' })
      .expect(422);

    await putGeneral({ language: 'fa', tagline: 'یک سایت' });
    const site = deliverySiteSchema.parse(
      (await request(testApp.server).get('/api/v1/delivery/site').expect(200)).body,
    );
    expect(site).toMatchObject({
      name: 'Test Site',
      tagline: 'یک سایت',
      language: 'fa',
      direction: 'rtl',
      baseUrl: 'https://site.example.test',
      seo: { titleTemplate: '%title% – %site%', indexing: true, defaultImage: null },
      theme: {
        key: 'starter',
        settings: { accentColor: '#1d4ed8', colorScheme: 'auto', showTagline: true, logo: null },
      },
      menus: {},
    });
    await putGeneral({});
  });

  it('delivers menus for the theme locations without unpublished targets', async () => {
    const visible = await createEntry(owner, {
      type: 'page',
      title: 'Contact',
      status: 'published',
    });
    const hidden = await createEntry(owner, { type: 'page', title: 'Draft page' });
    const menu = menuDetailSchema.parse(
      (
        await owner.agent
          .post('/api/v1/menus')
          .set('X-CSRF-Token', owner.csrf)
          .send({ name: 'Main', location: 'primary' })
          .expect(201)
      ).body,
    );
    await owner.agent
      .put(`/api/v1/menus/${menu.id}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({
        name: 'Main',
        location: 'primary',
        items: [
          { key: 'h', kind: 'home' },
          { key: 'c', kind: 'entry', entryId: visible.id, label: '' },
          { key: 'd', kind: 'entry', entryId: hidden.id },
          { key: 'd1', parentKey: 'd', kind: 'url', url: '/under-hidden', label: 'Under hidden' },
          {
            key: 'e',
            kind: 'url',
            url: 'https://example.org',
            label: 'External',
            openInNewTab: true,
          },
          { key: 'e1', parentKey: 'e', kind: 'entry', entryId: visible.id, label: 'Nested' },
        ],
      })
      .expect(200);
    const site = deliverySiteSchema.parse(
      (await request(testApp.server).get('/api/v1/delivery/site').expect(200)).body,
    );
    expect(site.menus).toEqual({
      primary: [
        { label: 'Home', url: '/', openInNewTab: false, children: [] },
        { label: 'Contact', url: '/contact', openInNewTab: false, children: [] },
        {
          label: 'External',
          url: 'https://example.org',
          openInNewTab: true,
          children: [{ label: 'Nested', url: '/contact', openInNewTab: false, children: [] }],
        },
      ],
    });
  });

  it('shows the latest draft through a preview link only while the link is valid', async () => {
    const draft = await createEntry(author, {
      title: 'Work in progress',
      body: paragraphDoc('First version'),
    });
    const ownerDraft = await createEntry(owner, { title: 'Owner draft' });
    // Authors may preview their own entries but not others' drafts.
    await author.agent
      .post(`/api/v1/entries/${ownerDraft.id}/preview`)
      .set('X-CSRF-Token', author.csrf)
      .expect(404);
    const link = previewLinkSchema.parse(
      (
        await author.agent
          .post(`/api/v1/entries/${draft.id}/preview`)
          .set('X-CSRF-Token', author.csrf)
          .expect(200)
      ).body,
    );
    expect(link.url).toMatch(/^https:\/\/site\.example\.test\/_preview\/[A-Za-z0-9_-]{43}$/);
    const expiresIn = new Date(link.expiresAt).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(59 * 60_000);
    expect(expiresIn).toBeLessThanOrEqual(60 * 60_000);
    const token = link.url.split('/').at(-1)!;

    await patchEntry(author, draft, { body: paragraphDoc('Second version') });
    const response = await request(testApp.server)
      .get(`/api/v1/delivery/preview/${token}`)
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    const preview = deliveryPageSchema.parse(response.body);
    expect(preview.preview).toBe(true);
    if (preview.route.kind !== 'entry') throw new Error('expected an entry');
    expect(preview.route.entry.seo.noindex).toBe(true);
    expect(JSON.stringify(preview.route.entry.body)).toContain('Second version');
    // The draft itself is still not public.
    expect(await kind('/blog/work-in-progress')).toBe('not_found');

    // Only the hash is stored.
    const stored = await withDb(
      async (db) =>
        (await db.query('SELECT token_hash FROM preview_tokens WHERE entry_id = $1', [draft.id]))
          .rows as { token_hash: Buffer }[],
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.token_hash.toString('base64url')).not.toBe(token);

    await request(testApp.server).get('/api/v1/delivery/preview/not-a-token').expect(404);
    await request(testApp.server)
      .get(`/api/v1/delivery/preview/${'A'.repeat(43)}`)
      .expect(404);
    await withDb((db) =>
      db.query(
        `UPDATE preview_tokens SET expires_at = now() - interval '1 second', created_at = now() - interval '1 hour'`,
      ),
    );
    await request(testApp.server).get(`/api/v1/delivery/preview/${token}`).expect(404);

    // Links die with a trashed entry or a suspended creator.
    const second = previewLinkSchema.parse(
      (
        await author.agent
          .post(`/api/v1/entries/${draft.id}/preview`)
          .set('X-CSRF-Token', author.csrf)
          .expect(200)
      ).body,
    );
    const secondToken = second.url.split('/').at(-1)!;
    await request(testApp.server).get(`/api/v1/delivery/preview/${secondToken}`).expect(200);
    await withDb((db) =>
      db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [author.userId]),
    );
    await request(testApp.server).get(`/api/v1/delivery/preview/${secondToken}`).expect(404);
    await withDb((db) =>
      db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [author.userId]),
    );
    await owner.agent
      .post(`/api/v1/entries/${draft.id}/trash`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(200);
    await request(testApp.server).get(`/api/v1/delivery/preview/${secondToken}`).expect(404);
    await owner.agent
      .post(`/api/v1/entries/${draft.id}/preview`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(409);
  });

  it('is public and read-only', async () => {
    await request(testApp.server).get('/api/v1/delivery/site').expect(200);
    await request(testApp.server).post('/api/v1/delivery/page').send({}).expect(404);
  });
});
