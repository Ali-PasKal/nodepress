import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEntry, signInAs } from '../helpers/content.js';
import {
  createIdentityApp,
  install,
  OWNER,
  resetIdentityData,
  signIn,
  type SignedIn,
} from '../helpers/identity.js';
import type { TestApp } from '../helpers/test-app.js';

type Role = 'editor' | 'author' | 'contributor' | 'viewer';
type Fixture = 'ownDraft' | 'ownPublished' | 'othersDraft' | 'othersPublished';
type Action = 'view' | 'edit' | 'publish' | 'unpublish' | 'trash';

/**
 * Expected outcome per role, action and entry. "Own" entries were written by the acting user (viewers
 * cannot write, so their "own" fixtures are written by someone else and behave like others' entries).
 */
const MATRIX: Record<Role, Record<Action, Fixture[]>> = {
  editor: {
    view: ['ownDraft', 'ownPublished', 'othersDraft', 'othersPublished'],
    edit: ['ownDraft', 'ownPublished', 'othersDraft', 'othersPublished'],
    publish: ['ownDraft', 'othersDraft'],
    unpublish: ['ownPublished', 'othersPublished'],
    trash: ['ownDraft', 'ownPublished', 'othersDraft', 'othersPublished'],
  },
  author: {
    view: ['ownDraft', 'ownPublished'],
    edit: ['ownDraft', 'ownPublished'],
    publish: ['ownDraft'],
    unpublish: ['ownPublished'],
    trash: ['ownDraft', 'ownPublished'],
  },
  contributor: {
    view: ['ownDraft', 'ownPublished'],
    edit: ['ownDraft'],
    publish: [],
    unpublish: [],
    trash: ['ownDraft'],
  },
  viewer: {
    view: ['ownDraft', 'ownPublished', 'othersDraft', 'othersPublished'],
    edit: [],
    publish: [],
    unpublish: [],
    trash: [],
  },
};

const FIXTURES: Fixture[] = ['ownDraft', 'ownPublished', 'othersDraft', 'othersPublished'];

describe('content permission matrix (every built-in role)', () => {
  let testApp: TestApp;
  let owner: SignedIn;
  let other: SignedIn;
  const users = {} as Record<Role, SignedIn>;

  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
    await install(testApp.server);
    owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    other = await signInAs(testApp.server, owner, 'editor');
    for (const role of ['editor', 'author', 'contributor', 'viewer'] as const) {
      users[role] = await signInAs(testApp.server, owner, role);
    }
  });
  afterAll(() => testApp.close());

  /** Fresh fixtures per check, so actions cannot influence each other. */
  async function fixture(role: Role, kind: Fixture) {
    const own = kind.startsWith('own') && role !== 'viewer';
    const published = kind.endsWith('Published');
    // Contributors cannot publish: their "published" entry is published by an editor afterwards.
    const writer = own ? users[role] : other;
    const entry = await createEntry(writer, { title: `${role} ${kind}` });
    if (!published) return entry;
    const response = await owner.agent
      .patch(`/api/v1/entries/${entry.id}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ version: entry.version, status: 'published' })
      .expect(200);
    return response.body as typeof entry;
  }

  async function attempt(role: Role, action: Action, kind: Fixture): Promise<number> {
    const user = users[role];
    const entry = await fixture(role, kind);
    switch (action) {
      case 'view':
        return (await user.agent.get(`/api/v1/entries/${entry.id}`)).status;
      case 'edit':
        return (
          await user.agent
            .patch(`/api/v1/entries/${entry.id}`)
            .set('X-CSRF-Token', user.csrf)
            .send({ version: entry.version, title: 'Changed' })
        ).status;
      case 'publish':
      case 'unpublish':
        return (
          await user.agent
            .patch(`/api/v1/entries/${entry.id}`)
            .set('X-CSRF-Token', user.csrf)
            .send({ version: entry.version, status: action === 'publish' ? 'published' : 'draft' })
        ).status;
      case 'trash':
        return (
          await user.agent.post(`/api/v1/entries/${entry.id}/trash`).set('X-CSRF-Token', user.csrf)
        ).status;
    }
  }

  for (const role of ['editor', 'author', 'contributor', 'viewer'] as const) {
    for (const action of ['view', 'edit', 'publish', 'unpublish', 'trash'] as const) {
      const applicable = FIXTURES.filter((kind) =>
        action === 'publish'
          ? kind.endsWith('Draft')
          : action === 'unpublish'
            ? kind.endsWith('Published')
            : true,
      );
      it(`${role} → ${action}`, async () => {
        const outcomes: Record<string, boolean> = {};
        for (const kind of applicable) {
          const status = await attempt(role, action, kind);
          expect([200, 403, 404], `${role} ${action} ${kind}: ${String(status)}`).toContain(status);
          outcomes[kind] = status === 200;
        }
        const expected = Object.fromEntries(
          applicable.map((kind) => [kind, MATRIX[role][action].includes(kind)]),
        );
        expect(outcomes).toEqual(expected);
      });
    }
  }

  it('creation follows the capabilities: contributors write drafts and submit them; viewers cannot write', async () => {
    await createEntry(users.contributor, { title: 'Contributor draft' });
    await createEntry(
      users.contributor,
      { title: 'Contributor publish', status: 'published' },
      403,
    );
    const pending = await createEntry(users.contributor, {
      title: 'For review',
      status: 'pending',
    });
    expect(pending.status).toBe('pending');
    await createEntry(users.viewer, { title: 'Viewer draft' }, 403);
    await createEntry(users.author, { title: 'Author publish', status: 'published' });
  });

  it('others’ entries are reported as missing, not forbidden, to users who cannot see them', async () => {
    const hidden = await createEntry(other, { title: 'Hidden from authors' });
    const response = await users.author.agent.get(`/api/v1/entries/${hidden.id}`).expect(404);
    expect(response.body.error.message).toBe('Entry not found.');
  });

  it('the server reports per-entry permissions consistent with the policy', async () => {
    const ownPublished = await fixture('contributor', 'ownPublished');
    const response = await users.contributor.agent
      .get(`/api/v1/entries/${ownPublished.id}`)
      .expect(200);
    expect(response.body.permissions).toEqual({
      edit: false,
      publish: false,
      trash: false,
      restore: false,
      delete: false,
    });
  });
});
