import { apiErrorResponseSchema, systemStatusResponseSchema } from '@nexora/shared';
import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resetIdentityData } from '../helpers/identity.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';
import { TEST_DATABASE_URL, UNREACHABLE_DATABASE_URL } from '../helpers/test-env.js';

describe('GET /api/v1/system/status', () => {
  let testApp: TestApp;
  let db: pg.Client;

  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createTestApp();
    db = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await db.connect();
  });
  afterEach(async () => {
    await db.query('DELETE FROM system_state');
  });
  afterAll(async () => {
    await db.end();
    await testApp.close();
  });

  it('reports a fresh database as not installed', async () => {
    const response = await request(testApp.server).get('/api/v1/system/status').expect(200);
    expect(systemStatusResponseSchema.parse(response.body)).toEqual({ installed: false });
  });

  it('reports not installed while setup has started but not completed', async () => {
    await db.query('INSERT INTO system_state (id, updated_at) VALUES (1, now())');
    const response = await request(testApp.server).get('/api/v1/system/status').expect(200);
    expect(response.body).toEqual({ installed: false });
  });

  it('reports installed once installed_at is recorded, without exposing the version', async () => {
    await db.query(
      `INSERT INTO system_state (id, installed_at, installed_version, updated_at) VALUES (1, now(), '0.1.0', now())`,
    );
    const response = await request(testApp.server).get('/api/v1/system/status').expect(200);
    expect(response.body).toEqual({ installed: true });
  });

  it('returns 503 SERVICE_UNAVAILABLE when the database is unreachable', async () => {
    const offline = await createTestApp({ DATABASE_URL: UNREACHABLE_DATABASE_URL });
    try {
      const response = await request(offline.server).get('/api/v1/system/status').expect(503);
      const body = apiErrorResponseSchema.parse(response.body);
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.error.requestId).toBe(response.headers['x-request-id']);
    } finally {
      await offline.close();
    }
  });
});

describe('system_state table constraints (migration integrity)', () => {
  let db: pg.Client;
  beforeAll(async () => {
    db = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await db.connect();
  });
  afterAll(async () => {
    await db.query('DELETE FROM system_state');
    await db.end();
  });

  it('allows at most one row (CHECK id = 1)', async () => {
    await expect(
      db.query('INSERT INTO system_state (id, updated_at) VALUES (2, now())'),
    ).rejects.toThrow(/system_state_singleton/);
  });
});
