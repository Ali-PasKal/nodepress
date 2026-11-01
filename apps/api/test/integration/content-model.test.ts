import {
  contentTypeSchema,
  taxonomySchema,
  termListResponseSchema,
  termSchema,
} from '@nexora/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentModel, createEntry, idsByKey, signInAs } from '../helpers/content.js';
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

describe('content model: content types, taxonomies and terms', () => {
  let testApp: TestApp;
  let owner: SignedIn;
  let editor: SignedIn;
  let author: SignedIn;
  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
    await install(testApp.server);
    owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    editor = await signInAs(testApp.server, owner, 'editor');
    author = await signInAs(testApp.server, owner, 'author');
  });
  afterAll(() => testApp.close());

  it('ships Post and Page, Category and Tag, and shows the model to every content role', async () => {
    const model = await contentModel(author);
    expect(model.contentTypes.map((type) => [type.key, type.hierarchical, type.isSystem])).toEqual([
      ['post', false, true],
      ['page', true, true],
    ]);
    const { type, taxonomy } = await idsByKey(author);
    expect(type('post').taxonomyIds.sort()).toEqual(
      [taxonomy('category').id, taxonomy('tag').id].sort(),
    );
    expect(taxonomy('category').hierarchical).toBe(true);
    expect(taxonomy('tag').hierarchical).toBe(false);

    // A role without any content capability cannot read it.
    const roleResponse = await owner.agent
      .post('/api/v1/roles')
      .set('X-CSRF-Token', owner.csrf)
      .send({ key: 'dashboard_only', name: 'Dashboard only', capabilities: ['dashboard.access'] })
      .expect(201);
    expect(roleResponse.body.key).toBe('dashboard_only');
    const dashboardOnly = await signInAs(testApp.server, owner, 'dashboard_only');
    await dashboardOnly.agent.get('/api/v1/content-model').expect(403);
  });

  it('creates, updates and deletes custom content types with validated field definitions', async () => {
    const { taxonomy } = await idsByKey(owner);
    const body = {
      key: 'product',
      name: 'Product',
      pluralName: 'Products',
      hasExcerpt: false,
      fields: [
        { key: 'price', label: 'Price', type: 'number', required: true, min: 0 },
        {
          key: 'color',
          label: 'Colour',
          type: 'select',
          options: [{ value: 'red', label: 'Red' }],
        },
      ],
      taxonomyIds: [taxonomy('tag').id],
    };
    await editor.agent
      .post('/api/v1/content-types')
      .set('X-CSRF-Token', editor.csrf)
      .send(body)
      .expect(403);
    const created = contentTypeSchema.parse(
      (
        await owner.agent
          .post('/api/v1/content-types')
          .set('X-CSRF-Token', owner.csrf)
          .send(body)
          .expect(201)
      ).body,
    );
    expect(created).toMatchObject({
      key: 'product',
      isSystem: false,
      hasExcerpt: false,
      entryCount: 0,
    });
    expect(created.fields[0]).toMatchObject({
      key: 'price',
      required: true,
      min: 0,
      max: null,
      integer: false,
    });

    const duplicate = await owner.agent
      .post('/api/v1/content-types')
      .set('X-CSRF-Token', owner.csrf)
      .send(body)
      .expect(422);
    expect(duplicate.body.error.issues).toEqual([
      { path: 'key', message: 'A content type with this key already exists.' },
    ]);
    const badFields = await owner.agent
      .post('/api/v1/content-types')
      .set('X-CSRF-Token', owner.csrf)
      .send({ ...body, key: 'gadget', fields: [{ key: 'Bad Key', label: '', type: 'nope' }] })
      .expect(422);
    expect(badFields.body.error.code).toBe('VALIDATION_FAILED');

    const updated = contentTypeSchema.parse(
      (
        await owner.agent
          .patch(`/api/v1/content-types/${created.id}`)
          .set('X-CSRF-Token', owner.csrf)
          .send({
            name: 'Item',
            fields: [{ key: 'sku', label: 'SKU', type: 'text' }],
            taxonomyIds: [],
          })
          .expect(200)
      ).body,
    );
    expect(updated).toMatchObject({ name: 'Item', taxonomyIds: [] });
    expect(updated.fields.map((field) => field.key)).toEqual(['sku']);

    // Once entries exist the type cannot change its hierarchy or be deleted.
    const entry = await createEntry(owner, { type: 'product', title: 'Widget' });
    const hierarchical = await owner.agent
      .patch(`/api/v1/content-types/${created.id}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ hierarchical: true })
      .expect(422);
    expect(hierarchical.body.error.issues[0].path).toBe('hierarchical');
    await owner.agent
      .delete(`/api/v1/content-types/${created.id}`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(409);

    await owner.agent
      .post(`/api/v1/entries/${entry.id}/trash`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(200);
    await owner.agent
      .delete(`/api/v1/entries/${entry.id}`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(204);
    await owner.agent
      .delete(`/api/v1/content-types/${created.id}`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(204);

    const { type } = await idsByKey(owner);
    await owner.agent
      .delete(`/api/v1/content-types/${type('post').id}`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(409);
    const audit = await withDb(
      async (db) =>
        (
          await db.query(
            `SELECT action FROM audit_events WHERE target_id = $1 ORDER BY occurred_at`,
            [created.id],
          )
        ).rows as { action: string }[],
    );
    expect(audit.map((row) => row.action)).toEqual([
      'content_type.created',
      'content_type.updated',
      'content_type.deleted',
    ]);
  });

  it('manages custom taxonomies; built-in ones are protected', async () => {
    const { type, taxonomy } = await idsByKey(owner);
    const genre = taxonomySchema.parse(
      (
        await owner.agent
          .post('/api/v1/taxonomies')
          .set('X-CSRF-Token', owner.csrf)
          .send({
            key: 'genre',
            name: 'Genre',
            pluralName: 'Genres',
            hierarchical: true,
            contentTypeIds: [type('post').id],
          })
          .expect(201)
      ).body,
    );
    expect(genre.contentTypeIds).toEqual([type('post').id]);
    expect((await idsByKey(owner)).type('post').taxonomyIds).toContain(genre.id);

    await owner.agent
      .post(`/api/v1/taxonomies/${genre.id}/terms`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ name: 'Jazz' })
      .expect(201);
    await owner.agent
      .delete(`/api/v1/taxonomies/${taxonomy('category').id}`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(409);
    await owner.agent
      .delete(`/api/v1/taxonomies/${genre.id}`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(204);
    const remaining = await withDb(
      async (db) =>
        (await db.query(`SELECT count(*)::int AS n FROM terms WHERE taxonomy_id = $1`, [genre.id]))
          .rows[0] as { n: number },
    );
    expect(remaining.n).toBe(0);
  });

  it('manages terms with unique slugs and safe hierarchies', async () => {
    const { taxonomy } = await idsByKey(editor);
    const categories = taxonomy('category').id;
    const tags = taxonomy('tag').id;
    const create = (
      user: SignedIn,
      taxonomyId: string,
      body: Record<string, unknown>,
      expected = 201,
    ) =>
      user.agent
        .post(`/api/v1/taxonomies/${taxonomyId}/terms`)
        .set('X-CSRF-Token', user.csrf)
        .send(body)
        .expect(expected);

    await create(author, categories, { name: 'Nope' }, 403);
    const news = termSchema.parse(
      (await create(editor, categories, { name: 'News & Events' })).body,
    );
    expect(news.slug).toBe('news-events');
    const news2 = termSchema.parse(
      (await create(editor, categories, { name: 'News Events' })).body,
    );
    expect(news2.slug).toBe('news-events-2');
    const explicit = await create(editor, categories, { name: 'Again', slug: 'news-events' }, 422);
    expect(explicit.body.error.issues[0]).toEqual({
      path: 'slug',
      message: 'Another term already uses this slug.',
    });

    const local = termSchema.parse(
      (await create(editor, categories, { name: 'Local', parentId: news.id })).body,
    );
    const street = termSchema.parse(
      (await create(editor, categories, { name: 'Street', parentId: local.id })).body,
    );
    const cycle = await editor.agent
      .patch(`/api/v1/terms/${news.id}`)
      .set('X-CSRF-Token', editor.csrf)
      .send({ parentId: street.id })
      .expect(422);
    expect(cycle.body.error.issues[0].message).toBe('A term cannot be its own ancestor.');
    await create(editor, tags, { name: 'child tag', parentId: news.id }, 422);
    await create(
      editor,
      categories,
      { name: 'Wrong parent', parentId: '0193e0a4-6a5b-7c2d-8e9f-0a1b2c3d4e5f' },
      422,
    );

    const post = await createEntry(editor, { title: 'Tagged', termIds: [local.id] });
    expect(post.termIds).toEqual([local.id]);

    // Authors can read terms (to assign them) but not change them.
    const listed = termListResponseSchema.parse(
      (await author.agent.get(`/api/v1/taxonomies/${categories}/terms?search=loc`).expect(200))
        .body,
    );
    expect(listed.items).toMatchObject([{ id: local.id, parentId: news.id, entryCount: 1 }]);

    // Deleting a term moves its children up and removes it from entries.
    await editor.agent
      .delete(`/api/v1/terms/${local.id}`)
      .set('X-CSRF-Token', editor.csrf)
      .expect(204);
    const after = termListResponseSchema.parse(
      (await editor.agent.get(`/api/v1/taxonomies/${categories}/terms`).expect(200)).body,
    );
    expect(after.items.find((term) => term.id === street.id)?.parentId).toBe(news.id);
    const entry = await editor.agent.get(`/api/v1/entries/${post.id}`).expect(200);
    expect(entry.body.termIds).toEqual([]);
  });
});
