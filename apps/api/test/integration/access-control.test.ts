import { ModulesContainer } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_POLICY } from '../../src/modules/security/decorators.js';
import {
  createIdentityApp,
  createUser,
  install,
  OWNER,
  resetIdentityData,
  roleIdByKey,
  signIn,
  type SignedIn,
} from '../helpers/identity.js';
import type { TestApp } from '../helpers/test-app.js';

describe('route access policies', () => {
  let testApp: TestApp;
  beforeAll(async () => {
    testApp = await createIdentityApp();
  });
  afterAll(() => testApp.close());

  it('every route declares @Public, @Authenticated or @RequireCapabilities', () => {
    const missing: string[] = [];
    let routes = 0;
    for (const module of testApp.app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype as (new (...args: never[]) => unknown) | null;
        if (!controller) continue;
        const prototype = controller.prototype as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(prototype)) {
          const handler = prototype[name];
          if (
            name === 'constructor' ||
            typeof handler !== 'function' ||
            Reflect.getMetadata('method', handler) === undefined
          ) {
            continue;
          }
          routes += 1;
          const policy =
            Reflect.getMetadata(ACCESS_POLICY, handler) ??
            Reflect.getMetadata(ACCESS_POLICY, controller);
          if (policy === undefined) missing.push(`${controller.name}.${name}`);
        }
      }
    }
    expect(routes).toBeGreaterThan(25);
    expect(missing).toEqual([]);
  });

  it.each([
    ['get', '/api/v1/users'],
    ['post', '/api/v1/users'],
    ['get', '/api/v1/roles'],
    ['get', '/api/v1/audit-events'],
    ['get', '/api/v1/settings/site'],
    ['get', '/api/v1/account/sessions'],
    ['post', '/api/v1/auth/logout'],
  ] as const)('%s %s requires a session (401)', async (method, path) => {
    const response = await request(testApp.server)[method](path).send({});
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('capabilities and privilege escalation', () => {
  let testApp: TestApp;
  let owner: SignedIn;
  let admin: SignedIn;
  let adminUser: { id: string; email: string; password: string };
  let viewer: SignedIn;

  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
    await install(testApp.server);
    owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    adminUser = await createUser(owner, 'administrator');
    admin = await signIn(testApp.server, adminUser.email, adminUser.password);
    const viewerUser = await createUser(owner, 'viewer');
    viewer = await signIn(testApp.server, viewerUser.email, viewerUser.password);
  });
  afterAll(() => testApp.close());

  it('a viewer can use their own account but no administration endpoints', async () => {
    await viewer.agent.get('/api/v1/account/profile').expect(200);
    for (const path of [
      '/api/v1/users',
      '/api/v1/roles',
      '/api/v1/audit-events',
      '/api/v1/settings/site',
    ]) {
      const response = await viewer.agent.get(path);
      expect(response.status, path).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
    expect(viewer.capabilities).toEqual(['dashboard.access']);
  });

  it('site settings are reserved for super administrators', async () => {
    await admin.agent.get('/api/v1/settings/site').expect(403);
    const updated = await owner.agent
      .patch('/api/v1/settings/site')
      .set('X-CSRF-Token', owner.csrf)
      .send({ name: 'Renamed Site', baseUrl: 'https://renamed.example.test/' })
      .expect(200);
    expect(updated.body).toEqual({ name: 'Renamed Site', baseUrl: 'https://renamed.example.test' });
  });

  it('an administrator cannot touch super administrators or grant super administrator', async () => {
    const ownerId = owner.userId;
    await admin.agent
      .patch(`/api/v1/users/${ownerId}`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ displayName: 'Pwned' })
      .expect(403);
    await admin.agent
      .post(`/api/v1/users/${ownerId}/password`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ password: 'attacker chosen passphrase' })
      .expect(403);
    await admin.agent
      .post(`/api/v1/users/${ownerId}/sessions/revoke-all`)
      .set('X-CSRF-Token', admin.csrf)
      .expect(403);
    const superAdminRole = await roleIdByKey(admin, 'super_admin');
    const target = await createUser(admin, 'viewer');
    const escalate = await admin.agent
      .patch(`/api/v1/users/${target.id}`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ roleId: superAdminRole })
      .expect(403);
    expect(escalate.body.error.message).toMatch(/capabilities you do not hold/);
    await admin.agent
      .post('/api/v1/users')
      .set('X-CSRF-Token', admin.csrf)
      .send({
        email: 'sneaky@example.test',
        displayName: 'Sneaky',
        password: 'a long enough password',
        roleId: superAdminRole,
      })
      .expect(403);
  });

  it('nobody can change their own role or status, or edit their own role', async () => {
    const viewerRole = await roleIdByKey(admin, 'viewer');
    await admin.agent
      .patch(`/api/v1/users/${adminUser.id}`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ roleId: viewerRole })
      .expect(403);
    await admin.agent
      .patch(`/api/v1/users/${adminUser.id}`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ status: 'suspended' })
      .expect(403);
    const adminRole = await roleIdByKey(admin, 'administrator');
    await admin.agent
      .patch(`/api/v1/roles/${adminRole}`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ capabilities: ['dashboard.access', 'system.manage'] })
      .expect(403);
    const superRole = await roleIdByKey(admin, 'super_admin');
    await owner.agent
      .patch(`/api/v1/roles/${superRole}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ description: 'x' })
      .expect(403);
  });

  it('roles cannot be created or edited to hold capabilities the actor lacks', async () => {
    const response = await admin.agent
      .post('/api/v1/roles')
      .set('X-CSRF-Token', admin.csrf)
      .send({ key: 'settings_manager', name: 'Settings manager', capabilities: ['system.manage'] })
      .expect(403);
    expect(response.body.error.message).toBe('You cannot grant capabilities you do not hold.');
  });

  it('changing a role or suspending a user revokes their sessions immediately', async () => {
    const target = await createUser(owner, 'editor');
    const session = await signIn(testApp.server, target.email, target.password);
    await session.agent.get('/api/v1/account/profile').expect(200);
    const authorRole = await roleIdByKey(admin, 'author');
    await admin.agent
      .patch(`/api/v1/users/${target.id}`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ roleId: authorRole })
      .expect(200);
    await session.agent.get('/api/v1/account/profile').expect(401);

    const again = await signIn(testApp.server, target.email, target.password);
    await admin.agent
      .patch(`/api/v1/users/${target.id}`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ status: 'suspended' })
      .expect(200);
    await again.agent.get('/api/v1/account/profile').expect(401);
  });

  it('a super administrator can demote another, but not themselves', async () => {
    const viewerRole = await roleIdByKey(owner, 'viewer');
    const second = await createUser(owner, 'super_admin');
    await owner.agent
      .patch(`/api/v1/users/${second.id}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ roleId: viewerRole })
      .expect(200);
    const self = await owner.agent
      .patch(`/api/v1/users/${owner.userId}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ roleId: viewerRole })
      .expect(403);
    expect(self.body.error.message).toBe('You cannot change your own role or status.');
  });
});
