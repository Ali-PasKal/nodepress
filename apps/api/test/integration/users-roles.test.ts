import {
  CORE_CAPABILITIES,
  roleListResponseSchema,
  userListResponseSchema,
  userSummarySchema,
} from '@nexora/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createIdentityApp,
  createUser,
  install,
  OWNER,
  resetIdentityData,
  roleIdByKey,
  signIn,
  withDb,
  type SignedIn,
} from '../helpers/identity.js';
import type { TestApp } from '../helpers/test-app.js';

describe('user and role management', () => {
  let testApp: TestApp;
  let owner: SignedIn;
  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
    await install(testApp.server);
    owner = await signIn(testApp.server, OWNER.email, OWNER.password);
  });
  afterAll(() => testApp.close());

  it('seeds exactly the core capabilities and the six system roles', async () => {
    const response = await owner.agent.get('/api/v1/roles').expect(200);
    const { roles, capabilities } = roleListResponseSchema.parse(response.body);
    expect(capabilities.map((capability) => capability.key).sort()).toEqual(
      Object.keys(CORE_CAPABILITIES).sort(),
    );
    for (const capability of capabilities) {
      expect(capability).toMatchObject(
        CORE_CAPABILITIES[capability.key as keyof typeof CORE_CAPABILITIES],
      );
    }
    const byKey = Object.fromEntries(roles.map((role) => [role.key, role]));
    expect(Object.keys(byKey).sort()).toEqual([
      'administrator',
      'author',
      'contributor',
      'editor',
      'super_admin',
      'viewer',
    ]);
    expect(byKey.super_admin).toMatchObject({ grantsAll: true, isSystem: true, userCount: 1 });
    expect(byKey.super_admin!.capabilities).toHaveLength(Object.keys(CORE_CAPABILITIES).length);
    expect(byKey.administrator!.capabilities).toEqual(
      Object.keys(CORE_CAPABILITIES)
        .filter((key) => key !== 'system.manage')
        .sort(),
    );
    expect(byKey.viewer!.capabilities).toEqual(['dashboard.access']);
  });

  it('creates users, rejects duplicates and invalid input, and never returns password data', async () => {
    const created = await createUser(owner, 'editor');
    const fetched = await owner.agent.get(`/api/v1/users/${created.id}`).expect(200);
    expect(userSummarySchema.strict().parse(fetched.body)).toMatchObject({
      email: created.email,
      status: 'active',
      role: { key: 'editor' },
    });
    expect(JSON.stringify(fetched.body)).not.toMatch(/password|argon/i);

    const editorRole = await roleIdByKey(owner, 'editor');
    const duplicate = await owner.agent
      .post('/api/v1/users')
      .set('X-CSRF-Token', owner.csrf)
      .send({
        email: created.email.toUpperCase(),
        displayName: 'Dup',
        password: 'a long enough password',
        roleId: editorRole,
      })
      .expect(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');

    const invalid = await owner.agent
      .post('/api/v1/users')
      .set('X-CSRF-Token', owner.csrf)
      .send({ email: 'not-an-email', displayName: '', password: 'short', roleId: 'nope' })
      .expect(422);
    expect(
      (invalid.body.error.issues as { path: string }[]).map((issue) => issue.path).sort(),
    ).toEqual(['displayName', 'email', 'password', 'roleId']);
  });

  it('searches, filters and paginates users', async () => {
    for (let index = 0; index < 4; index += 1) {
      await createUser(owner, 'author');
    }
    const authorRole = await roleIdByKey(owner, 'author');
    const page = await owner.agent
      .get('/api/v1/users')
      .query({ roleId: authorRole, pageSize: 3, page: 1 })
      .expect(200);
    const parsed = userListResponseSchema.parse(page.body);
    expect(parsed.items).toHaveLength(3);
    expect(parsed.total).toBeGreaterThanOrEqual(4);
    expect(parsed.items.every((item) => item.role?.key === 'author')).toBe(true);
    const search = await owner.agent.get('/api/v1/users').query({ search: 'OWNER@' }).expect(200);
    expect(userListResponseSchema.parse(search.body).items.map((item) => item.email)).toEqual([
      OWNER.email,
    ]);
    await owner.agent.get('/api/v1/users').query({ pageSize: 1000 }).expect(422);
  });

  it('lets an administrator set passwords and revoke sessions of less privileged users', async () => {
    const target = await createUser(owner, 'contributor');
    const session = await signIn(testApp.server, target.email, target.password);
    const listed = await owner.agent.get(`/api/v1/users/${target.id}/sessions`).expect(200);
    expect(listed.body).toHaveLength(1);
    await owner.agent
      .post(`/api/v1/users/${target.id}/password`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ password: 'reset by an admin 123' })
      .expect(204);
    await session.agent.get('/api/v1/account/profile').expect(401);
    await signIn(testApp.server, target.email, 'reset by an admin 123');
    const revoked = await owner.agent
      .post(`/api/v1/users/${target.id}/sessions/revoke-all`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(200);
    expect(revoked.body).toEqual({ revoked: 1 });
  });

  it('manages custom roles and protects built-in ones', async () => {
    const created = await owner.agent
      .post('/api/v1/roles')
      .set('X-CSRF-Token', owner.csrf)
      .send({
        key: 'auditor',
        name: 'Auditor',
        description: 'Reads the audit log',
        capabilities: ['audit.read', 'dashboard.access', 'audit.read'],
      })
      .expect(201);
    expect(created.body).toMatchObject({
      key: 'auditor',
      isSystem: false,
      capabilities: ['audit.read', 'dashboard.access'],
      userCount: 0,
    });

    await owner.agent
      .post('/api/v1/roles')
      .set('X-CSRF-Token', owner.csrf)
      .send({ key: 'auditor', name: 'Again', capabilities: [] })
      .expect(409);
    const unknown = await owner.agent
      .post('/api/v1/roles')
      .set('X-CSRF-Token', owner.csrf)
      .send({ key: 'weird', name: 'Weird', capabilities: ['made.up'] })
      .expect(422);
    expect(unknown.body.error.issues[0].message).toContain('made.up');

    const updated = await owner.agent
      .patch(`/api/v1/roles/${String(created.body.id)}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ capabilities: ['dashboard.access', 'users.read'] })
      .expect(200);
    expect(updated.body.capabilities).toEqual(['dashboard.access', 'users.read']);

    const member = await createUser(owner, 'auditor');
    await owner.agent
      .delete(`/api/v1/roles/${String(created.body.id)}`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(409);
    const viewerRole = await roleIdByKey(owner, 'viewer');
    await owner.agent
      .patch(`/api/v1/users/${member.id}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ roleId: viewerRole })
      .expect(200);
    await owner.agent
      .delete(`/api/v1/roles/${String(created.body.id)}`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(204);

    const editorRole = await roleIdByKey(owner, 'editor');
    await owner.agent
      .patch(`/api/v1/roles/${editorRole}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ name: 'Chief Editor' })
      .expect(403);
    await owner.agent
      .delete(`/api/v1/roles/${editorRole}`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(403);
    // Built-in roles can have their capabilities and description edited.
    await owner.agent
      .patch(`/api/v1/roles/${editorRole}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ capabilities: ['dashboard.access', 'users.read'], description: 'Edits content' })
      .expect(200);
  });

  it('applies capability changes to existing sessions immediately', async () => {
    const target = await createUser(owner, 'viewer');
    const session = await signIn(testApp.server, target.email, target.password);
    await session.agent.get('/api/v1/users').expect(403);
    const viewerRole = await roleIdByKey(owner, 'viewer');
    await owner.agent
      .patch(`/api/v1/roles/${viewerRole}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ capabilities: ['dashboard.access', 'users.read'] })
      .expect(200);
    await session.agent.get('/api/v1/users').expect(200);
    await owner.agent
      .patch(`/api/v1/roles/${viewerRole}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ capabilities: ['dashboard.access'] })
      .expect(200);
    await session.agent.get('/api/v1/users').expect(403);
  });

  it('enforces database constraints on identity data', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `INSERT INTO users (id, email, display_name, updated_at) VALUES (gen_random_uuid(), 'Mixed@Case.test', 'X', now())`,
        ),
      ).rejects.toThrow(/users_email_normalised/);
      await expect(
        db.query(
          `INSERT INTO roles (id, key, name, updated_at) VALUES (gen_random_uuid(), 'Bad Key', 'X', now())`,
        ),
      ).rejects.toThrow(/roles_key_format/);
    });
  });
});
