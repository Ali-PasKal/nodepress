import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { livenessResponseSchema, readinessResponseSchema } from '@nexora/shared';
import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ShutdownState } from '../../src/common/lifecycle/shutdown-state.service.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';
import {
  TEST_DATABASE_URL,
  TEST_REDIS_URL,
  UNREACHABLE_DATABASE_URL,
  UNREACHABLE_REDIS_URL,
} from '../helpers/test-env.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../prisma/migrations', import.meta.url));

describe('GET /api/v1/health/live', () => {
  let testApp: TestApp;
  beforeAll(async () => {
    // Liveness must not depend on the database at all.
    testApp = await createTestApp({ DATABASE_URL: UNREACHABLE_DATABASE_URL });
  });
  afterAll(() => testApp.close());

  it('reports the process as alive even when the database is unreachable', async () => {
    const response = await request(testApp.server).get('/api/v1/health/live').expect(200);
    expect(livenessResponseSchema.parse(response.body)).toEqual({ status: 'ok' });
  });
});

describe('GET /api/v1/health/ready', () => {
  const apps: TestApp[] = [];
  const start = async (overrides: Record<string, string> = {}) => {
    const testApp = await createTestApp(overrides);
    apps.push(testApp);
    return testApp;
  };
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((testApp) => testApp.close()));
  });

  it('is ready when the database is reachable and fully migrated', async () => {
    const { server } = await start();
    const response = await request(server).get('/api/v1/health/ready').expect(200);
    const body = readinessResponseSchema.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.checks.database.status).toBe('up');
    expect(body.checks.migrations).toEqual({ status: 'up', pending: 0, failed: 0 });
    expect(body.checks.cache).toEqual({ status: 'disabled' });
    expect(body.checks.shutdown).toEqual({ status: 'up' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns 503 without leaking error details when the database is unreachable', async () => {
    const { server } = await start({ DATABASE_URL: UNREACHABLE_DATABASE_URL });
    const response = await request(server).get('/api/v1/health/ready').expect(503);
    const body = readinessResponseSchema.parse(response.body);
    expect(body.status).toBe('error');
    expect(body.checks.database).toEqual({ status: 'down' });
    expect(body.checks.migrations).toEqual({ status: 'down' });
    expect(JSON.stringify(response.body)).not.toMatch(
      /127\.0\.0\.1|ECONNREFUSED|unreachable|password/i,
    );
  });

  it('is degraded (but still ready) when the optional cache is unreachable', async () => {
    const { server } = await start({ REDIS_URL: UNREACHABLE_REDIS_URL });
    const response = await request(server).get('/api/v1/health/ready').expect(200);
    const body = readinessResponseSchema.parse(response.body);
    expect(body.status).toBe('degraded');
    expect(body.checks.cache).toEqual({ status: 'down' });
  });

  it.runIf(TEST_REDIS_URL !== undefined)(
    'reports the cache as up when Redis is reachable',
    async () => {
      const { server } = await start({ REDIS_URL: TEST_REDIS_URL ?? '' });
      const response = await request(server).get('/api/v1/health/ready').expect(200);
      expect(readinessResponseSchema.parse(response.body).checks.cache.status).toBe('up');
    },
  );

  describe('migration state', () => {
    let tempDir: string;
    beforeAll(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'nexora-migrations-'));
    });
    afterAll(() => rm(tempDir, { recursive: true, force: true }));

    it('returns 503 when the build ships a migration the database has not applied', async () => {
      const migrationsDir = join(tempDir, 'pending');
      await cp(MIGRATIONS_DIR, migrationsDir, { recursive: true });
      await mkdir(join(migrationsDir, '29991231000000_future_change'));
      await writeFile(
        join(migrationsDir, '29991231000000_future_change', 'migration.sql'),
        'SELECT 1;',
      );
      // Directories that are not migrations must be ignored.
      await mkdir(join(migrationsDir, 'notes'));

      const { server } = await start({ PRISMA_MIGRATIONS_DIR: migrationsDir });
      const response = await request(server).get('/api/v1/health/ready').expect(503);
      const body = readinessResponseSchema.parse(response.body);
      expect(body.checks.database.status).toBe('up');
      expect(body.checks.migrations).toEqual({ status: 'down', pending: 1, failed: 0 });
    });

    it('returns 503 when a migration is recorded as failed', async () => {
      const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await client.connect();
      try {
        await client.query(
          `INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count)
           VALUES ('test-failed-migration', 'x', '29991231000001_broken', now(), 0)`,
        );
        const { server } = await start();
        const response = await request(server).get('/api/v1/health/ready').expect(503);
        expect(readinessResponseSchema.parse(response.body).checks.migrations).toEqual({
          status: 'down',
          pending: 0,
          failed: 1,
        });
      } finally {
        await client.query(`DELETE FROM _prisma_migrations WHERE id = 'test-failed-migration'`);
        await client.end();
      }
    });

    it('returns 503 when the migrations directory is missing from the deployment', async () => {
      const { server } = await start({ PRISMA_MIGRATIONS_DIR: join(tempDir, 'does-not-exist') });
      const response = await request(server).get('/api/v1/health/ready').expect(503);
      expect(readinessResponseSchema.parse(response.body).checks.migrations).toEqual({
        status: 'down',
      });
    });
  });

  it('fails readiness as soon as graceful shutdown begins', async () => {
    const { app, server } = await start();
    await request(server).get('/api/v1/health/ready').expect(200);

    await app.get(ShutdownState).beforeApplicationShutdown('SIGTERM');

    const response = await request(server).get('/api/v1/health/ready').expect(503);
    const body = readinessResponseSchema.parse(response.body);
    expect(body.status).toBe('error');
    expect(body.checks.shutdown).toEqual({ status: 'down' });
    expect(body.checks.database.status).toBe('up');
  });
});
