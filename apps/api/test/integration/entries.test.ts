import {
  entryBulkResponseSchema,
  entryDetailSchema,
  entryListResponseSchema,
  revisionDetailSchema,
  revisionSummarySchema,
} from '@nexora/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EntriesService } from '../../src/modules/content/entries.service.js';
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
import type { TestApp } from '../helpers/test-app.js';

async function auditActions(targetId: string): Promise<string[]> {
  return withDb(async (db) =>
    (
      await db.query(
        `SELECT action FROM audit_events WHERE target_id = $1 ORDER BY occurred_at, id`,
        [targetId],
      )
    ).rows.map((row: { action: string }) => row.action),
  );
}

describe('entries', () => {
  let testApp: TestApp;
  let owner: SignedIn;
  let editor: SignedIn;
  let author: SignedIn;
  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp({
      CONTENT_REVISIONS_LIMIT: '3',
      CONTENT_TRASH_RETENTION_DAYS: '30',
    });
    await install(testApp.server);
    owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    editor = await signInAs(testApp.server, owner, 'editor');
    author = await signInAs(testApp.server, owner, 'author');
  });
  afterAll(() => testApp.close());

  it('creates drafts with generated, unique, Unicode-aware slugs', async () => {
    const first = await createEntry(editor, {
      title: 'Hello World',
      body: paragraphDoc('First post'),
    });
    expect(first).toMatchObject({
      slug: 'hello-world',
      path: 'hello-world',
      status: 'draft',
      version: 1,
      publishedAt: null,
      author: { id: editor.userId },
      permissions: { edit: true, publish: true, trash: true, restore: false, delete: false },
    });
    expect(first.body).toEqual(paragraphDoc('First post'));
    expect((await createEntry(editor, { title: 'Hello, world!' })).slug).toBe('hello-world-2');
    expect((await createEntry(editor, { title: 'سلام دنیا' })).slug).toBe('سلام-دنیا');
    expect((await createEntry(editor, { title: '' })).slug).toBe('untitled');

    const clash = await createEntry(editor, { title: 'Other', slug: 'hello-world' }, 422);
    expect(clash).toMatchObject({
      error: {
        issues: [{ path: 'slug', message: 'Another entry uses this slug at the same level.' }],
      },
    });
    // The same slug is fine in another content type.
    expect((await createEntry(editor, { type: 'page', title: 'Hello World' })).path).toBe(
      'hello-world',
    );
  });

  it('rejects unsafe rich text and invalid references', async () => {
    const xss = await createEntry(
      editor,
      {
        title: 'XSS',
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'click',
                  marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
                },
              ],
            },
          ],
        },
      },
      422,
    );
    expect(JSON.stringify(xss)).toContain('Links must use http(s), mailto or tel.');
    await createEntry(
      editor,
      { title: 'Raw HTML', body: { type: 'doc', content: [{ type: 'html', html: '<script>' }] } },
      422,
    );
    await createEntry(
      editor,
      { title: 'Bad term', termIds: ['0193e0a4-6a5b-7c2d-8e9f-0a1b2c3d4e5f'] },
      422,
    );
    await createEntry(
      editor,
      { title: 'Bad media', featuredMediaId: '0193e0a4-6a5b-7c2d-8e9f-0a1b2c3d4e5f' },
      422,
    );
    await createEntry(
      editor,
      { title: 'No parent for posts', parentId: '0193e0a4-6a5b-7c2d-8e9f-0a1b2c3d4e5f' },
      422,
    );
    await createEntry(editor, { type: 'nonexistent', title: 'x' }, 404);
    // Pages have no taxonomies: a category is not allowed there.
    const { taxonomy } = await idsByKey(editor);
    const category = await editor.agent
      .post(`/api/v1/taxonomies/${taxonomy('category').id}/terms`)
      .set('X-CSRF-Token', editor.csrf)
      .send({ name: 'Only for posts' })
      .expect(201);
    await createEntry(
      editor,
      { type: 'page', title: 'Categorised page', termIds: [category.body.id] },
      422,
    );
  });

  it('validates custom field values against the content type', async () => {
    await owner.agent
      .post('/api/v1/content-types')
      .set('X-CSRF-Token', owner.csrf)
      .send({
        key: 'event',
        name: 'Event',
        pluralName: 'Events',
        hasBody: false,
        fields: [
          { key: 'starts_on', label: 'Starts on', type: 'date', required: true },
          { key: 'capacity', label: 'Capacity', type: 'number', integer: true, min: 1 },
        ],
      })
      .expect(201);
    const invalid = await createEntry(
      owner,
      { type: 'event', title: 'Launch', fields: { capacity: 0 } },
      422,
    );
    expect(invalid).toMatchObject({
      error: {
        issues: expect.arrayContaining([
          expect.objectContaining({ path: 'fields.starts_on' }),
          expect.objectContaining({ path: 'fields.capacity', message: 'Must be at least 1.' }),
        ]) as unknown,
      },
    });
    const event = await createEntry(owner, {
      type: 'event',
      title: 'Launch',
      body: paragraphDoc('ignored: events have no body'),
      fields: { starts_on: '2026-12-01', capacity: 50, obsolete: 'dropped' },
    });
    expect(event.fields).toEqual({ starts_on: '2026-12-01', capacity: 50 });
    expect(event.body).toEqual({ type: 'doc', content: [] });
  });

  it('maintains unique hierarchical paths and refuses cycles', async () => {
    const about = await createEntry(editor, { type: 'page', title: 'About' });
    const services = await createEntry(editor, { type: 'page', title: 'Services' });
    const team = await createEntry(editor, { type: 'page', title: 'Team', parentId: about.id });
    const people = await createEntry(editor, { type: 'page', title: 'People', parentId: team.id });
    expect([team.path, people.path]).toEqual(['about/team', 'about/team/people']);
    // Siblings under different parents may share a slug.
    const servicesTeam = await createEntry(editor, {
      type: 'page',
      title: 'Team',
      parentId: services.id,
    });
    expect(servicesTeam.path).toBe('services/team');

    // Renaming an ancestor's slug moves every descendant.
    const renamed = await patchEntry(editor, about, { slug: 'about-us' });
    expect(renamed.body.path).toBe('about-us');
    const movedPeople = entryDetailSchema.parse(
      (await editor.agent.get(`/api/v1/entries/${people.id}`).expect(200)).body,
    );
    expect(movedPeople.path).toBe('about-us/team/people');
    expect(movedPeople.version).toBe(people.version);

    const cycle = await patchEntry(
      editor,
      renamed.body as { id: string; version: number },
      { parentId: people.id },
      422,
    );
    expect(cycle.body.error.issues[0]).toEqual({
      path: 'parentId',
      message: 'An entry cannot be placed under itself or one of its descendants.',
    });
    // Moving "Team" under "Services" collides with the existing services/team.
    const clash = await patchEntry(editor, team, { parentId: services.id }, 422);
    expect(clash.body.error.issues[0].path).toBe('parentId');
    const post = await createEntry(editor, { title: 'A post' });
    await patchEntry(editor, team, { parentId: post.id }, 422);
  });

  it('detects concurrent edits and keeps a bounded revision history that can be restored', async () => {
    const created = await createEntry(author, { title: 'Draft one', body: paragraphDoc('v1') });
    const second = entryDetailSchema.parse(
      (await patchEntry(author, created, { title: 'Draft two', body: paragraphDoc('v2') })).body,
    );
    expect(second.version).toBe(2);
    // A stale version (someone else saved in between) is refused.
    const stale = await patchEntry(author, created, { title: 'Overwrite?' }, 409);
    expect(stale.body.error.code).toBe('CONFLICT');

    let latest = second;
    for (const n of [3, 4, 5]) {
      latest = entryDetailSchema.parse(
        (
          await patchEntry(author, latest, {
            title: `Draft ${String(n)}`,
            body: paragraphDoc(`v${String(n)}`),
          })
        ).body,
      );
    }
    const revisions = z
      .array(revisionSummarySchema)
      .parse((await author.agent.get(`/api/v1/entries/${created.id}/revisions`).expect(200)).body);
    expect(revisions.map((revision) => revision.entryVersion)).toEqual([5, 4, 3]);
    const third = revisionDetailSchema.parse(
      (
        await author.agent
          .get(`/api/v1/entries/${created.id}/revisions/${revisions[2]!.id}`)
          .expect(200)
      ).body,
    );
    expect(third.snapshot).toMatchObject({ title: 'Draft 3', body: paragraphDoc('v3') });

    const restored = entryDetailSchema.parse(
      (
        await author.agent
          .post(`/api/v1/entries/${created.id}/revisions/${third.id}/restore`)
          .set('X-CSRF-Token', author.csrf)
          .send({ version: latest.version })
          .expect(200)
      ).body,
    );
    expect(restored).toMatchObject({ title: 'Draft 3', version: 6, body: paragraphDoc('v3') });
    const after = z
      .array(revisionSummarySchema)
      .parse((await author.agent.get(`/api/v1/entries/${created.id}/revisions`).expect(200)).body);
    expect(after.map((revision) => revision.entryVersion)).toEqual([6, 5, 4]);

    // A save that changes nothing but the status (here: submit for review) adds no revision.
    const submitted = entryDetailSchema.parse(
      (
        await patchEntry(author, restored, {
          status: 'pending',
          title: restored.title,
          termIds: [],
        })
      ).body,
    );
    expect(submitted).toMatchObject({ status: 'pending', version: 7 });
    const unchanged = z
      .array(revisionSummarySchema)
      .parse((await author.agent.get(`/api/v1/entries/${created.id}/revisions`).expect(200)).body);
    expect(unchanged.map((revision) => revision.entryVersion)).toEqual([6, 5, 4]);
  });

  it('enforces publication rules and publishes scheduled entries when due', async () => {
    const draft = await createEntry(author, { title: '' });
    const untitled = await patchEntry(author, draft, { status: 'published' }, 422);
    expect(untitled.body.error.issues[0].path).toBe('title');
    const titled = entryDetailSchema.parse(
      (await patchEntry(author, draft, { title: 'Big news' })).body,
    );
    await patchEntry(author, titled, { status: 'scheduled' }, 422);
    await patchEntry(
      author,
      titled,
      { status: 'scheduled', publishedAt: new Date(Date.now() - 60_000).toISOString() },
      422,
    );
    await patchEntry(
      author,
      titled,
      { status: 'published', publishedAt: new Date(Date.now() + 3_600_000).toISOString() },
      422,
    );

    const soon = new Date(Date.now() + 2_000);
    const scheduled = entryDetailSchema.parse(
      (await patchEntry(author, titled, { status: 'scheduled', publishedAt: soon.toISOString() }))
        .body,
    );
    expect(scheduled).toMatchObject({ status: 'scheduled', publishedAt: soon.toISOString() });

    const service = testApp.app.get(EntriesService);
    expect(await service.publishDue(new Date(soon.getTime() - 1_000))).toBe(0);
    expect(await service.publishDue(new Date(soon.getTime() + 1_000))).toBe(1);
    const published = entryDetailSchema.parse(
      (await author.agent.get(`/api/v1/entries/${titled.id}`).expect(200)).body,
    );
    expect(published).toMatchObject({
      status: 'published',
      publishedAt: soon.toISOString(),
      version: scheduled.version + 1,
    });

    const unpublished = entryDetailSchema.parse(
      (await patchEntry(author, published, { status: 'draft' })).body,
    );
    expect(unpublished.publishedAt).toBe(soon.toISOString());
    expect(await auditActions(titled.id)).toEqual([
      'entry.scheduled',
      'entry.published',
      'entry.unpublished',
    ]);
  });

  it('moves entries through the trash, and purges it after the retention period', async () => {
    const parent = await createEntry(editor, {
      type: 'page',
      title: 'Parent page',
      status: 'published',
    });
    const child = await createEntry(editor, {
      type: 'page',
      title: 'Child page',
      parentId: parent.id,
    });

    await editor.agent
      .delete(`/api/v1/entries/${parent.id}`)
      .set('X-CSRF-Token', editor.csrf)
      .expect(409);
    const trashed = entryDetailSchema.parse(
      (
        await editor.agent
          .post(`/api/v1/entries/${parent.id}/trash`)
          .set('X-CSRF-Token', editor.csrf)
          .expect(200)
      ).body,
    );
    expect(trashed).toMatchObject({
      status: 'published',
      permissions: { edit: false, restore: true, delete: true },
    });
    expect(trashed.trashedAt).not.toBeNull();
    await patchEntry(editor, trashed, { title: 'Edit in trash' }, 409);
    await editor.agent
      .post(`/api/v1/entries/${parent.id}/trash`)
      .set('X-CSRF-Token', editor.csrf)
      .expect(409);
    // A trashed entry cannot become a parent.
    await createEntry(editor, { type: 'page', title: 'Orphan', parentId: parent.id }, 422);
    // Its children keep it, so it cannot be deleted permanently yet.
    await editor.agent
      .delete(`/api/v1/entries/${parent.id}`)
      .set('X-CSRF-Token', editor.csrf)
      .expect(409);

    const restored = entryDetailSchema.parse(
      (
        await editor.agent
          .post(`/api/v1/entries/${parent.id}/restore`)
          .set('X-CSRF-Token', editor.csrf)
          .expect(200)
      ).body,
    );
    expect(restored).toMatchObject({ status: 'published', trashedAt: null });

    await editor.agent
      .post(`/api/v1/entries/${child.id}/trash`)
      .set('X-CSRF-Token', editor.csrf)
      .expect(200);
    await editor.agent
      .post(`/api/v1/entries/${parent.id}/trash`)
      .set('X-CSRF-Token', editor.csrf)
      .expect(200);
    const service = testApp.app.get(EntriesService);
    expect(await service.purgeTrash(new Date(Date.now() + 29 * 86_400_000))).toBe(0);
    // Child first, then the parent once it has no children left.
    expect(await service.purgeTrash(new Date(Date.now() + 31 * 86_400_000))).toBe(2);
    await editor.agent.get(`/api/v1/entries/${parent.id}`).expect(404);
    expect(await auditActions(parent.id)).toEqual([
      'entry.published',
      'entry.trashed',
      'entry.restored',
      'entry.trashed',
      'entry.deleted',
    ]);
  });

  it('applies bulk actions entry by entry and reports partial failures', async () => {
    const mine = await createEntry(author, { title: 'Author bulk 1' });
    const mine2 = await createEntry(author, { title: 'Author bulk 2' });
    const theirs = await createEntry(editor, { title: 'Editor bulk' });
    const response = entryBulkResponseSchema.parse(
      (
        await author.agent
          .post('/api/v1/entries/bulk')
          .set('X-CSRF-Token', author.csrf)
          .send({ action: 'publish', ids: [mine.id, mine2.id, theirs.id] })
          .expect(200)
      ).body,
    );
    expect(response.succeeded.sort()).toEqual([mine.id, mine2.id].sort());
    expect(response.failed).toEqual([{ id: theirs.id, message: 'Entry not found.' }]);

    const trash = entryBulkResponseSchema.parse(
      (
        await author.agent
          .post('/api/v1/entries/bulk')
          .set('X-CSRF-Token', author.csrf)
          .send({ action: 'trash', ids: [mine.id, mine2.id] })
          .expect(200)
      ).body,
    );
    expect(trash.failed).toEqual([]);
    const remove = entryBulkResponseSchema.parse(
      (
        await author.agent
          .post('/api/v1/entries/bulk')
          .set('X-CSRF-Token', author.csrf)
          .send({ action: 'delete', ids: [mine.id] })
          .expect(200)
      ).body,
    );
    expect(remove.succeeded).toEqual([mine.id]);
  });

  it('lists with status tabs, search, term filters and own-only visibility', async () => {
    const { taxonomy } = await idsByKey(editor);
    const tag = await editor.agent
      .post(`/api/v1/taxonomies/${taxonomy('tag').id}/terms`)
      .set('X-CSRF-Token', editor.csrf)
      .send({ name: 'Findable' })
      .expect(201);
    const found = await createEntry(editor, {
      title: 'Quarterly report',
      body: paragraphDoc('Contains the word zebra'),
      termIds: [tag.body.id],
      status: 'published',
    });

    const byText = entryListResponseSchema.parse(
      (await editor.agent.get('/api/v1/entries?type=post&search=ZEBRA').expect(200)).body,
    );
    expect(byText.items.map((item) => item.id)).toEqual([found.id]);
    const byTerm = entryListResponseSchema.parse(
      (
        await editor.agent
          .get(`/api/v1/entries?type=post&termId=${String(tag.body.id)}`)
          .expect(200)
      ).body,
    );
    expect(byTerm.items.map((item) => item.id)).toEqual([found.id]);

    const all = entryListResponseSchema.parse(
      (await editor.agent.get('/api/v1/entries?type=post&pageSize=100').expect(200)).body,
    );
    expect(all.counts.all).toBe(
      all.counts.draft + all.counts.pending + all.counts.scheduled + all.counts.published,
    );
    expect(all.items.every((item) => item.trashedAt === null)).toBe(true);
    const trash = entryListResponseSchema.parse(
      (await editor.agent.get('/api/v1/entries?type=post&status=trash').expect(200)).body,
    );
    expect(trash.total).toBe(all.counts.trash);
    expect(trash.items.every((item) => item.trashedAt !== null)).toBe(true);

    // Authors only see their own entries, whatever filters they pass.
    const authorList = entryListResponseSchema.parse(
      (await author.agent.get('/api/v1/entries?type=post&pageSize=100').expect(200)).body,
    );
    expect(authorList.items.length).toBeGreaterThan(0);
    expect(authorList.items.every((item) => item.author.id === author.userId)).toBe(true);
    const sneaky = entryListResponseSchema.parse(
      (await author.agent.get(`/api/v1/entries?type=post&authorId=${editor.userId}`).expect(200))
        .body,
    );
    expect(sneaky.total).toBe(0);
  });
});
