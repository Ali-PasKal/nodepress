import { CORE_CAPABILITY_KEYS } from '@nexora/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createIdentityApp,
  createUser,
  install,
  OWNER,
  resetIdentityData,
  roleIdByKey,
  signIn,
} from '../helpers/identity.js';
import type { TestApp } from '../helpers/test-app.js';

/**
 * The realistic way to lose the last super administrator: a custom role holding every capability
 * (so the subset rule allows managing super admins) is used to suspend or demote the only one.
 */
describe('last active super administrator guard', () => {
  let testApp: TestApp;
  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
    await install(testApp.server);
  });
  afterAll(() => testApp.close());

  it('refuses to suspend or demote the only active super administrator (409)', async () => {
    const owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    await owner.agent
      .post('/api/v1/roles')
      .set('X-CSRF-Token', owner.csrf)
      .send({ key: 'full_access', name: 'Full access', capabilities: CORE_CAPABILITY_KEYS })
      .expect(201);
    const deputy = await createUser(owner, 'full_access');
    const deputySession = await signIn(testApp.server, deputy.email, deputy.password);
    const viewerRole = await roleIdByKey(owner, 'viewer');

    const suspend = await deputySession.agent
      .patch(`/api/v1/users/${owner.userId}`)
      .set('X-CSRF-Token', deputySession.csrf)
      .send({ status: 'suspended' })
      .expect(409);
    expect(suspend.body.error.message).toBe(
      'There must be at least one active Super Administrator.',
    );
    await deputySession.agent
      .patch(`/api/v1/users/${owner.userId}`)
      .set('X-CSRF-Token', deputySession.csrf)
      .send({ roleId: viewerRole })
      .expect(409);

    // With a second active super administrator, the same change is allowed.
    await createUser(owner, 'super_admin');
    await deputySession.agent
      .patch(`/api/v1/users/${owner.userId}`)
      .set('X-CSRF-Token', deputySession.csrf)
      .send({ status: 'suspended' })
      .expect(200);
  });
});
