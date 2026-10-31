import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PRISMA_CLI } from './helpers/prisma-cli.js';
import { assertDisposableTestDatabase, TEST_DATABASE_URL } from './helpers/test-env.js';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Recreates the test database schema from scratch and applies every migration with the real Prisma
 * CLI, so the suite always runs against exactly the schema produced by the committed migrations.
 */
export default async function setup(): Promise<void> {
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
}
