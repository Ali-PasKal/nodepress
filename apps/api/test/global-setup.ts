import { execFileSync } from 'node:child_process';
import type { TestProject } from 'vitest/node';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PRISMA_CLI } from './helpers/prisma-cli.js';
import { assertDisposableTestDatabase, TEST_DATABASE_URL } from './helpers/test-env.js';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Recreates the test database schema from scratch and applies every migration with the real Prisma
 * CLI, so the suite always runs against exactly the schema produced by the committed migrations.
 */
export default async function setup(project: TestProject): Promise<void> {
  assertDisposableTestDatabase(TEST_DATABASE_URL);

  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      'Cannot connect to the test database. Start PostgreSQL (docker compose up -d postgres) or set TEST_DATABASE_URL.',
      { cause: error },
    );
  }
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }

  execFileSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      MIGRATION_DATABASE_URL: TEST_DATABASE_URL,
    },
    stdio: 'pipe',
  });

  // Snapshot what the migrations seeded, before any test changes it, so tests can compare it with the
  // shared defaults (test helpers restore those defaults between suites).
  const seedClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await seedClient.connect();
  try {
    const roles = await seedClient.query<{ key: string; grants_all: boolean; caps: string[] }>(
      `SELECT r.key, r.grants_all,
              coalesce(array_agg(rc.capability_key ORDER BY rc.capability_key)
                       FILTER (WHERE rc.capability_key IS NOT NULL), '{}') AS caps
         FROM roles r LEFT JOIN role_capabilities rc ON rc.role_id = r.id
        GROUP BY r.key, r.grants_all`,
    );
    project.provide(
      'migratedRoles',
      Object.fromEntries(roles.rows.map((row) => [row.key, row.grants_all ? 'all' : row.caps])),
    );
  } finally {
    await seedClient.end();
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** Role key → capability keys ('all' for grantsAll roles) exactly as seeded by the migrations. */
    migratedRoles: Record<string, 'all' | string[]>;
  }
}
