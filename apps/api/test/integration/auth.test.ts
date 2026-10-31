import { sessionResponseSchema } from '@nexora/shared';
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
} from '../helpers/identity.js';
import type { TestApp } from '../helpers/test-app.js';
import { TEST_REDIS_URL } from '../helpers/test-env.js';

function cookieHeader(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.[0] ?? '';
}

describe('authentication and sessions', () => {
  let testApp: TestApp;
  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
    await install(testApp.server);
  });
  afterAll(() => testApp.close());

  it('signs in and sets a hardened session cookie', async () => {
    const response = await request(testApp.server)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ email: '  OWNER@Example.test ', password: OWNER.password })
      .expect(200);
    const cookie = cookieHeader(response);
    expect(cookie).toMatch(/^nexora_session=[A-Za-z0-9_-]{40,}; /);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Secure'); // plain-HTTP test environment
    const session = sessionResponseSchema.parse(response.body);
    expect(session.authenticated && session.user.email).toBe(OWNER.email);
    expect(session.authenticated && session.capabilities).toContain('system.manage');
  });

  it('uses a Secure __Host- cookie when SESSION_COOKIE_SECURE is enabled', async () => {
    const secureApp = await createIdentityApp({ SESSION_COOKIE_SECURE: 'true' });
    try {
      const response = await request(secureApp.server)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', nextIp())
        .send({ email: OWNER.email, password: OWNER.password })
        .expect(200);
      expect(cookieHeader(response)).toMatch(/^__Host-nexora_session=.*; Secure/);
    } finally {
      await secureApp.close();
    }
  });

  it('gives identical answers for unknown accounts and wrong passwords', async () => {
    const unknown = await request(testApp.server)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ email: 'nobody@example.test', password: 'whatever it is' });
    const wrong = await request(testApp.server)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ email: OWNER.email, password: 'not the password' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    const strip = (body: { error: Record<string, unknown> }) => ({
      ...body.error,
      requestId: undefined,
    });
    expect(strip(unknown.body as { error: Record<string, unknown> })).toEqual(
      strip(wrong.body as { error: Record<string, unknown> }),
    );
    expect(unknown.body.error.message).toBe('Invalid email or password.');
    expect(unknown.headers['set-cookie']).toBeUndefined();
  });

  it('reports the session state and requires sign-in for protected routes', async () => {
    const anonymous = await request(testApp.server).get('/api/v1/auth/session').expect(200);
    expect(anonymous.body).toEqual({ authenticated: false });
    const denied = await request(testApp.server).get('/api/v1/account/profile').expect(401);
    expect(denied.body.error.code).toBe('UNAUTHENTICATED');

    const owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    const session = await owner.agent.get('/api/v1/auth/session').expect(200);
    expect(session.body.authenticated).toBe(true);
    expect(session.body.csrfToken).toBe(owner.csrf);
  });

  it('logs out only with a CSRF token, and the old cookie stops working', async () => {
    const owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    const forged = await owner.agent.post('/api/v1/auth/logout').expect(403);
    expect(forged.body.error.code).toBe('CSRF_FAILED');
    const wrongToken = await owner.agent
      .post('/api/v1/auth/logout')
      .set('X-CSRF-Token', 'x'.repeat(43))
      .expect(403);
    expect(wrongToken.body.error.code).toBe('CSRF_FAILED');

    await owner.agent.get('/api/v1/account/profile').expect(200);
    const response = await owner.agent
      .post('/api/v1/auth/logout')
      .set('X-CSRF-Token', owner.csrf)
      .expect(204);
    expect(cookieHeader(response)).toMatch(/^nexora_session=; .*Expires=Thu, 01 Jan 1970/);
    await owner.agent.get('/api/v1/account/profile').expect(401);
  });

  it('rejects state-changing requests from other origins even with a valid token', async () => {
    const owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    const crossOrigin = await owner.agent
      .patch('/api/v1/account/profile')
      .set('X-CSRF-Token', owner.csrf)
      .set('Origin', 'https://evil.example')
      .send({ displayName: 'Hacked' })
      .expect(403);
    expect(crossOrigin.body.error.code).toBe('CSRF_FAILED');
    await owner.agent
      .patch('/api/v1/account/profile')
      .set('X-CSRF-Token', owner.csrf)
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ displayName: 'Hacked' })
      .expect(403);
    // Same origin is fine.
    await owner.agent
      .patch('/api/v1/account/profile')
      .set('X-CSRF-Token', owner.csrf)
      .set('Host', 'cms.example.test')
      .set('Origin', 'http://cms.example.test')
      .send({ displayName: 'Site Owner' })
      .expect(200);
  });

  it('rotates sessions on login (session fixation defence)', async () => {
    const first = await signIn(testApp.server, OWNER.email, OWNER.password);
    // Signing in again on the same client replaces the session it presented.
    const relogin = await first.agent
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ email: OWNER.email, password: OWNER.password })
      .expect(200);
    const revoked = await withDb(
      async (db) =>
        (
          await db.query(
            `SELECT count(*)::int AS n FROM sessions WHERE revoked_reason = 'login_rotation'`,
          )
        ).rows[0] as { n: number },
    );
    expect(revoked.n).toBeGreaterThanOrEqual(1);
    expect(relogin.body.csrfToken).not.toBe(first.csrf);
  });

  it('expires sessions after the idle timeout and the absolute lifetime', async () => {
    const idle = await signIn(testApp.server, OWNER.email, OWNER.password);
    const absolute = await signIn(testApp.server, OWNER.email, OWNER.password);
    await withDb(async (db) => {
      const sessions = await db.query(
        `SELECT id FROM sessions WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 2`,
      );
      const [newest, older] = sessions.rows as { id: string }[];
      await db.query(
        `UPDATE sessions SET last_seen_at = now() - interval '25 hours' WHERE id = $1`,
        [older!.id],
      );
      await db.query(
        `UPDATE sessions SET created_at = now() - interval '9 days', expires_at = now() - interval '1 second' WHERE id = $1`,
        [newest!.id],
      );
    });
    await idle.agent.get('/api/v1/account/profile').expect(401);
    await absolute.agent.get('/api/v1/account/profile').expect(401);
  });

  it('blocks suspended accounts with the same generic error', async () => {
    const owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    const user = await createUser(owner, 'viewer');
    await owner.agent
      .patch(`/api/v1/users/${user.id}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ status: 'suspended' })
      .expect(200);
    const response = await request(testApp.server)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ email: user.email, password: user.password })
      .expect(401);
    expect(response.body.error.message).toBe('Invalid email or password.');
  });

  describe('rate limiting', () => {
    it('locks an account after repeated failures, even for the right password, with Retry-After', async () => {
      const owner = await signIn(testApp.server, OWNER.email, OWNER.password);
      const victim = await createUser(owner, 'viewer');
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(testApp.server)
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', nextIp())
          .send({ email: victim.email, password: 'wrong password!' })
          .expect(401);
      }
      const locked = await request(testApp.server)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', nextIp())
        .send({ email: victim.email, password: victim.password })
        .expect(429);
      expect(locked.body.error.code).toBe('RATE_LIMITED');
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('limits login attempts per client address', async () => {
      const ip = nextIp();
      let status = 0;
      for (let attempt = 0; attempt < 21; attempt += 1) {
        const response = await request(testApp.server)
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ email: `probe${String(attempt)}@example.test`, password: 'x' });
        status = response.status;
      }
      expect(status).toBe(429);
    });

    it.runIf(TEST_REDIS_URL !== undefined)(
      'uses the Redis-compatible cache when configured',
      async () => {
        const cached = await createIdentityApp({ REDIS_URL: TEST_REDIS_URL ?? '' });
        try {
          await request(cached.server).get('/api/v1/health/ready').expect(200); // waits for the connection
          const email = `redis-${String(Date.now())}@example.test`;
          for (let attempt = 0; attempt < 5; attempt += 1) {
            await request(cached.server)
              .post('/api/v1/auth/login')
              .set('X-Forwarded-For', nextIp())
              .send({ email, password: 'nope' })
              .expect(401);
          }
          await request(cached.server)
            .post('/api/v1/auth/login')
            .set('X-Forwarded-For', nextIp())
            .send({ email, password: 'nope' })
            .expect(429);
          const pgRows = await withDb(
            async (db) =>
              (
                await db.query(
                  `SELECT count(*)::int AS n FROM rate_limit_buckets WHERE key LIKE 'rl:login-account:%' AND count >= 5`,
                )
              ).rows[0] as { n: number },
          );
          // The lockout above was counted in Redis, not PostgreSQL (earlier PG-backed lockouts may exist).
          expect(pgRows.n).toBeLessThanOrEqual(1);
        } finally {
          await cached.close();
        }
      },
    );
  });
});
