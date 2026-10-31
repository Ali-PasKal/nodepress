import { auditListResponseSchema } from '@nexora/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createIdentityApp,
  createUser,
  install,
  nextIp,
  OWNER,
  resetIdentityData,
  signIn,
  withDb,
  type SignedIn,
} from '../helpers/identity.js';
import type { TestApp } from '../helpers/test-app.js';

describe('audit log', () => {
  let testApp: TestApp;
  let owner: SignedIn;
  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
    await install(testApp.server);
    await request(testApp.server)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ email: OWNER.email, password: 'wrong password here' })
      .expect(401);
    owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    await createUser(owner, 'editor', 'a secret passphrase 42');
  });
  afterAll(() => testApp.close());

  it('records security events with actor, target, address and request id', async () => {
    const response = await owner.agent
      .get('/api/v1/audit-events')
      .query({ pageSize: 50 })
      .expect(200);
    const { items } = auditListResponseSchema.parse(response.body);
    const actions = items.map((item) => item.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'setup.completed',
        'auth.login_failed',
        'auth.login_succeeded',
        'user.created',
      ]),
    );
    const created = items.find((item) => item.action === 'user.created');
    expect(created).toMatchObject({
      actor: { email: OWNER.email },
      targetType: 'user',
      metadata: { role: 'editor' },
    });
    expect(created?.ipAddress).toBeTruthy();
    const failed = items.find((item) => item.action === 'auth.login_failed');
    expect(failed).toMatchObject({ actor: null, metadata: { reason: 'invalid_password' } });
    // The client address is resolved through the trusted proxy (X-Forwarded-For), not the socket.
    expect(failed?.ipAddress).toMatch(/^10\./);
  });

  it('never stores passwords or tokens in audit metadata', async () => {
    const rows = await withDb(
      async (db) =>
        (await db.query('SELECT metadata::text AS m FROM audit_events')).rows as { m: string }[],
    );
    const all = rows.map((row) => row.m).join('\n');
    expect(all).not.toContain('a secret passphrase 42');
    expect(all).not.toContain(OWNER.password);
    expect(all).not.toMatch(/token/i);
  });

  it('filters by action prefix and requires audit.read', async () => {
    const response = await owner.agent
      .get('/api/v1/audit-events')
      .query({ action: 'auth.' })
      .expect(200);
    const { items } = auditListResponseSchema.parse(response.body);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.action.startsWith('auth.'))).toBe(true);

    const viewer = await createUser(owner, 'viewer');
    const viewerSession = await signIn(testApp.server, viewer.email, viewer.password);
    await viewerSession.agent.get('/api/v1/audit-events').expect(403);
  });

  it('is append-only at the database level', async () => {
    await withDb(async (db) => {
      await expect(db.query(`UPDATE audit_events SET action = 'tampered'`)).rejects.toThrow(
        /append-only/,
      );
      await expect(db.query(`DELETE FROM audit_events`)).rejects.toThrow(/append-only/);
    });
  });
});
