import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { SYSTEM_ROLE_DEFAULTS, sessionResponseSchema } from '@nexora/shared';
import pg from 'pg';
import request from 'supertest';
import { expect } from 'vitest';
import { createTestApp, type TestApp } from './test-app.js';
import { TEST_DATABASE_URL } from './test-env.js';

export const TEST_SETUP_TOKEN = 'test-setup-token-0123456789abcdef';
export const OWNER = {
  email: 'owner@example.test',
  password: 'correct horse battery staple',
  displayName: 'Site Owner',
};
export const MAIL_DIR = mkdtempSync(join(tmpdir(), 'nexora-test-mail-'));

export type Agent = ReturnType<typeof request.agent>;

/** App configured for identity tests: known setup token, file mail transport, one trusted proxy hop. */
export function createIdentityApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  return createTestApp({
    SETUP_TOKEN: TEST_SETUP_TOKEN,
    MAIL_TRANSPORT: 'file',
    MAIL_FILE_DIR: MAIL_DIR,
    TRUST_PROXY: '1',
    ...overrides,
  });
}

export async function withDb<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/**
 * Returns the database to "freshly migrated, not installed": no users, sites, sessions, audit events
 * or custom roles, and system roles restored to their seeded capabilities. TRUNCATE is used because the
 * audit table rejects row-level DELETE by design.
 */
export async function resetIdentityData(): Promise<void> {
  await withDb(async (db) => {
    await db.query(
      'TRUNCATE users, sites, rate_limit_buckets, audit_events, jobs, job_workers CASCADE',
    );
    await db.query('DELETE FROM roles WHERE NOT is_system');
    await db.query(
      `DELETE FROM role_capabilities rc USING roles r WHERE rc.role_id = r.id AND r.is_system`,
    );
    for (const [roleKey, capabilities] of Object.entries(SYSTEM_ROLE_DEFAULTS)) {
      if (capabilities === 'all') continue;
      await db.query(
        `INSERT INTO role_capabilities (role_id, capability_key)
           SELECT r.id, unnest($2::text[]) FROM roles r WHERE r.key = $1`,
        [roleKey, capabilities],
      );
    }
    // Content model: drop custom types and taxonomies, restore the built-in ones.
    await db.query('DELETE FROM content_types WHERE NOT is_system');
    await db.query('DELETE FROM taxonomies WHERE NOT is_system');
    await db.query(`UPDATE content_types SET fields = '[]', has_body = true, has_excerpt = true,
      has_featured_image = true, hierarchical = (key = 'page')`);
    await db.query(`UPDATE taxonomies SET hierarchical = (key = 'category')`);
    await db.query('DELETE FROM content_type_taxonomies');
    await db.query(`INSERT INTO content_type_taxonomies (content_type_id, taxonomy_id)
      SELECT ct.id, t.id FROM content_types ct CROSS JOIN taxonomies t
       WHERE ct.key = 'post' AND t.key IN ('category', 'tag')`);
    await db.query(
      'UPDATE system_state SET installed_at = NULL, installed_version = NULL, setup_token_hash = NULL',
    );
  });
}

let ipCounter = 0;
/** A distinct client address per call (the test app trusts one proxy hop), keeping IP rate limits apart. */
export function nextIp(): string {
  ipCounter += 1;
  return `10.${String(Math.floor(ipCounter / 65_536) % 256)}.${String(Math.floor(ipCounter / 256) % 256)}.${String(ipCounter % 256)}`;
}

export async function install(
  server: Server,
  overrides: Partial<typeof OWNER> = {},
): Promise<void> {
  const admin = { ...OWNER, ...overrides };
  await request(server)
    .post('/api/v1/setup/install')
    .set('X-Forwarded-For', nextIp())
    .send({
      setupToken: TEST_SETUP_TOKEN,
      site: { name: 'Test Site', baseUrl: 'https://site.example.test' },
      admin,
    })
    .expect(201);
}

export interface SignedIn {
  readonly agent: Agent;
  readonly csrf: string;
  readonly userId: string;
  readonly capabilities: readonly string[];
}

export async function signIn(server: Server, email: string, password: string): Promise<SignedIn> {
  const agent = request.agent(server);
  const response = await agent
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', nextIp())
    .send({ email, password })
    .expect(200);
  const session = sessionResponseSchema.parse(response.body);
  if (!session.authenticated) {
    throw new Error('expected an authenticated session');
  }
  return {
    agent,
    csrf: session.csrfToken,
    userId: session.user.id,
    capabilities: session.capabilities,
  };
}

export async function roleIdByKey(admin: SignedIn, key: string): Promise<string> {
  const response = await admin.agent.get('/api/v1/roles').expect(200);
  const role = (response.body as { roles: { id: string; key: string }[] }).roles.find(
    (candidate) => candidate.key === key,
  );
  expect(role, `role ${key}`).toBeDefined();
  return role!.id;
}

let userCounter = 0;
export async function createUser(
  admin: SignedIn,
  roleKey: string,
  password = 'a long enough password 123',
): Promise<{ id: string; email: string; password: string }> {
  userCounter += 1;
  const email = `user${String(userCounter)}-${roleKey}@example.test`;
  // Resolve the role first: supertest starts the (non-listening) server per request, so requests on the
  // same server must not be nested.
  const roleId = await roleIdByKey(admin, roleKey);
  const response = await admin.agent
    .post('/api/v1/users')
    .set('X-CSRF-Token', admin.csrf)
    .send({ email, displayName: `User ${String(userCounter)}`, password, roleId })
    .expect(201);
  return { id: (response.body as { id: string }).id, email, password };
}
