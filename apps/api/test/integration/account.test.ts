import { sessionResponseSchema, sessionSummarySchema } from '@nexora/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createIdentityApp,
  createUser,
  install,
  nextIp,
  OWNER,
  resetIdentityData,
  signIn,
  withDb,
} from '../helpers/identity.js';
import type { TestApp } from '../helpers/test-app.js';

const sessionList = z.array(sessionSummarySchema);

describe('own account', () => {
  let testApp: TestApp;
  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
    await install(testApp.server);
  });
  afterAll(() => testApp.close());

  it('changes the password only with the current one, rotating this session and revoking the rest', async () => {
    const owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    const user = await createUser(owner, 'editor');
    const here = await signIn(testApp.server, user.email, user.password);
    const elsewhere = await signIn(testApp.server, user.email, user.password);

    const noCsrf = await here.agent
      .post('/api/v1/account/password')
      .send({ currentPassword: user.password, newPassword: 'a brand new passphrase' })
      .expect(403);
    expect(noCsrf.body.error.code).toBe('CSRF_FAILED');

    const wrongCurrent = await here.agent
      .post('/api/v1/account/password')
      .set('X-CSRF-Token', here.csrf)
      .send({ currentPassword: 'not my password at all', newPassword: 'a brand new passphrase' })
      .expect(422);
    expect(wrongCurrent.body.error.issues).toEqual([
      { path: 'currentPassword', message: 'Current password is incorrect.' },
    ]);
    const unchanged = await here.agent
      .post('/api/v1/account/password')
      .set('X-CSRF-Token', here.csrf)
      .send({ currentPassword: user.password, newPassword: user.password })
      .expect(422);
    expect(unchanged.body.error.issues[0].path).toBe('newPassword');
    await here.agent
      .post('/api/v1/account/password')
      .set('X-CSRF-Token', here.csrf)
      .send({ currentPassword: user.password, newPassword: 'short' })
      .expect(422);

    const changed = await here.agent
      .post('/api/v1/account/password')
      .set('X-CSRF-Token', here.csrf)
      .send({ currentPassword: user.password, newPassword: 'a brand new passphrase' })
      .expect(200);
    const session = sessionResponseSchema.parse(changed.body);
    expect(session.authenticated).toBe(true);
    const newCsrf = session.authenticated ? session.csrfToken : '';
    expect(newCsrf).not.toBe(here.csrf);
    expect(changed.headers['set-cookie']?.[0]).toMatch(/^nexora_session=[A-Za-z0-9_-]{40,}; /);

    // The agent now carries the rotated cookie; the token bound to the old session is useless.
    await here.agent.get('/api/v1/account/profile').expect(200);
    await here.agent
      .patch('/api/v1/account/profile')
      .set('X-CSRF-Token', here.csrf)
      .send({ displayName: 'Stale token' })
      .expect(403);
    await elsewhere.agent.get('/api/v1/account/profile').expect(401);

    await request(testApp.server)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ email: user.email, password: user.password })
      .expect(401);
    await signIn(testApp.server, user.email, 'a brand new passphrase');

    const audit = await withDb(
      async (db) =>
        (
          await db.query(
            `SELECT count(*)::int AS n FROM audit_events WHERE action = 'account.password_changed' AND actor_user_id = $1`,
            [user.id],
          )
        ).rows[0] as { n: number },
    );
    expect(audit.n).toBe(1);
  });

  it('lists own sessions and revokes one, or all others, without touching other users', async () => {
    const owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    const user = await createUser(owner, 'viewer');
    const current = await signIn(testApp.server, user.email, user.password);
    const second = await signIn(testApp.server, user.email, user.password);
    const third = await signIn(testApp.server, user.email, user.password);

    const listed = sessionList.parse((await current.agent.get('/api/v1/account/sessions')).body);
    expect(listed).toHaveLength(3);
    expect(listed.filter((entry) => entry.current)).toHaveLength(1);
    expect(listed.every((entry) => entry.ipAddress !== null)).toBe(true);

    // Someone else's session id is indistinguishable from a missing one.
    const ownerSessions = sessionList.parse(
      (await owner.agent.get('/api/v1/account/sessions')).body,
    );
    const ownerSessionId = ownerSessions.find((entry) => entry.current)!.id;
    await current.agent
      .delete(`/api/v1/account/sessions/${ownerSessionId}`)
      .set('X-CSRF-Token', current.csrf)
      .expect(404);
    await owner.agent.get('/api/v1/account/profile').expect(200);
    await current.agent
      .delete('/api/v1/account/sessions/not-a-uuid')
      .set('X-CSRF-Token', current.csrf)
      .expect(422);

    const secondId = sessionList
      .parse((await second.agent.get('/api/v1/account/sessions')).body)
      .find((entry) => entry.current)!.id;
    await current.agent
      .delete(`/api/v1/account/sessions/${secondId}`)
      .set('X-CSRF-Token', current.csrf)
      .expect(204);
    await second.agent.get('/api/v1/account/profile').expect(401);
    await third.agent.get('/api/v1/account/profile').expect(200);

    const others = await current.agent
      .post('/api/v1/account/sessions/revoke-others')
      .set('X-CSRF-Token', current.csrf)
      .expect(200);
    expect(others.body).toEqual({ revoked: 1 });
    await third.agent.get('/api/v1/account/profile').expect(401);
    await current.agent.get('/api/v1/account/profile').expect(200);
    await owner.agent.get('/api/v1/account/profile').expect(200);

    // Revoking the current session signs this client out and clears its cookie.
    const currentId = sessionList
      .parse((await current.agent.get('/api/v1/account/sessions')).body)
      .find((entry) => entry.current)!.id;
    const self = await current.agent
      .delete(`/api/v1/account/sessions/${currentId}`)
      .set('X-CSRF-Token', current.csrf)
      .expect(204);
    expect(self.headers['set-cookie']?.[0]).toMatch(/^nexora_session=; .*Expires=Thu, 01 Jan 1970/);
    await current.agent.get('/api/v1/account/profile').expect(401);
  });
});
