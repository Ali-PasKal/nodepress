import { apiErrorResponseSchema, setupStatusResponseSchema } from '@nexora/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createIdentityApp,
  nextIp,
  OWNER,
  resetIdentityData,
  TEST_SETUP_TOKEN,
  withDb,
} from '../helpers/identity.js';
import type { TestApp } from '../helpers/test-app.js';

const body = (overrides: Record<string, unknown> = {}) => ({
  setupToken: TEST_SETUP_TOKEN,
  site: { name: 'Acme', baseUrl: 'https://acme.example/' },
  admin: OWNER,
  ...overrides,
});

describe('setup wizard API', () => {
  let testApp: TestApp;
  beforeEach(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('reports environment checks before installation', async () => {
    const response = await request(testApp.server).get('/api/v1/setup/status').expect(200);
    expect(setupStatusResponseSchema.parse(response.body)).toEqual({
      installed: false,
      checks: { database: 'up', migrations: 'up' },
      security: { environment: 'test', secureCookies: false, httpsRequest: false },
    });
  });

  it('installs once with a valid token, creating the site and a super administrator', async () => {
    await request(testApp.server)
      .post('/api/v1/setup/install')
      .set('X-Forwarded-For', nextIp())
      .send(body())
      .expect(201);

    const status = await request(testApp.server).get('/api/v1/setup/status').expect(200);
    expect(status.body).toEqual({ installed: true });
    const system = await request(testApp.server).get('/api/v1/system/status').expect(200);
    expect(system.body).toEqual({ installed: true });

    const rows = await withDb(async (db) => {
      const site = await db.query(`SELECT key, name, base_url FROM sites`);
      const user = await db.query(
        `SELECT u.email, r.key AS role FROM users u JOIN role_assignments ra ON ra.user_id = u.id JOIN roles r ON r.id = ra.role_id`,
      );
      const state = await db.query(
        `SELECT installed_at IS NOT NULL AS installed, setup_token_hash FROM system_state`,
      );
      const audit = await db.query(`SELECT action FROM audit_events`);
      return { site: site.rows, user: user.rows, state: state.rows[0], audit: audit.rows };
    });
    // Trailing slash normalised; email stored lower-case.
    expect(rows.site).toEqual([{ key: 'default', name: 'Acme', base_url: 'https://acme.example' }]);
    expect(rows.user).toEqual([{ email: OWNER.email, role: 'super_admin' }]);
    expect(rows.state).toEqual({ installed: true, setup_token_hash: null });
    expect(rows.audit).toEqual([{ action: 'setup.completed' }]);
  });

  it('cannot be rerun after installation', async () => {
    await request(testApp.server)
      .post('/api/v1/setup/install')
      .set('X-Forwarded-For', nextIp())
      .send(body())
      .expect(201);
    const again = await request(testApp.server)
      .post('/api/v1/setup/install')
      .set('X-Forwarded-For', nextIp())
      .send(body({ admin: { ...OWNER, email: 'attacker@example.test' } }))
      .expect(409);
    expect(apiErrorResponseSchema.parse(again.body).error.code).toBe('CONFLICT');
    const users = await withDb(
      async (db) =>
        (await db.query('SELECT count(*)::int AS n FROM users')).rows[0] as { n: number },
    );
    expect(users.n).toBe(1);
  });

  it('rejects a wrong setup token without creating anything', async () => {
    const response = await request(testApp.server)
      .post('/api/v1/setup/install')
      .set('X-Forwarded-For', nextIp())
      .send(body({ setupToken: 'definitely-not-the-right-token' }))
      .expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    const counts = await withDb(
      async (db) =>
        (
          await db.query(
            'SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM sites)::int AS sites',
          )
        ).rows[0] as unknown,
    );
    expect(counts).toEqual({ users: 0, sites: 0 });
  });

  it('validates input with per-field issues', async () => {
    const response = await request(testApp.server)
      .post('/api/v1/setup/install')
      .set('X-Forwarded-For', nextIp())
      .send(
        body({
          site: { name: '', baseUrl: 'ftp://x' },
          admin: { ...OWNER, email: 'nope', password: 'short' },
        }),
      )
      .expect(422);
    const paths = (response.body.error.issues as { path: string }[])
      .map((issue) => issue.path)
      .sort();
    expect(paths).toEqual(['admin.email', 'admin.password', 'site.baseUrl', 'site.name']);
  });

  it('serialises concurrent installation attempts: exactly one succeeds', async () => {
    const attempts = await Promise.all(
      [0, 1, 2].map((index) =>
        request(testApp.server)
          .post('/api/v1/setup/install')
          .set('X-Forwarded-For', nextIp())
          .send(body({ admin: { ...OWNER, email: `racer${String(index)}@example.test` } })),
      ),
    );
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([201, 409, 409]);
  });

  it('rejects cross-origin installation attempts before doing anything', async () => {
    const response = await request(testApp.server)
      .post('/api/v1/setup/install')
      .set('Origin', 'https://evil.example')
      .send(body())
      .expect(403);
    expect(response.body.error.code).toBe('CSRF_FAILED');
  });

  it('generates and stores a random setup token when SETUP_TOKEN is not configured', async () => {
    await testApp.close();
    await withDb((db) => db.query('UPDATE system_state SET setup_token_hash = NULL'));
    testApp = await createIdentityApp({ SETUP_TOKEN: '' });
    const hash = await withDb(
      async (db) =>
        (await db.query('SELECT octet_length(setup_token_hash) AS len FROM system_state'))
          .rows[0] as { len: number | null },
    );
    expect(hash.len).toBe(32);
    // The well-known test token is not accepted when the instance generated its own.
    await request(testApp.server)
      .post('/api/v1/setup/install')
      .set('X-Forwarded-For', nextIp())
      .send(body())
      .expect(403);
  });
});
