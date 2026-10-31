import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/test-env.js';

const run = promisify(execFile);
const apiRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Runs the same drift check CI uses: diff the migrated database against schema.prisma. */
async function driftExitCode(): Promise<number> {
  try {
    await run('pnpm', ['run', '--silent', 'db:check-drift'], {
      cwd: apiRoot,
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
        MIGRATION_DATABASE_URL: TEST_DATABASE_URL,
      },
    });
    return 0;
  } catch (error) {
    return (error as { code?: number }).code ?? -1;
  }
}

describe('migration integrity', () => {
  let db: pg.Client;
  beforeAll(async () => {
    db = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await db.connect();
  });
  afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS drift_probe');
    await db.end();
  });

  it('migrations applied to an empty database produce exactly schema.prisma', async () => {
    expect(await driftExitCode()).toBe(0);
  }, 60_000);

  it('the drift check detects a schema that diverges from the migrations', async () => {
    await db.query('CREATE TABLE drift_probe (id int PRIMARY KEY)');
    try {
      expect(await driftExitCode()).toBe(2);
    } finally {
      await db.query('DROP TABLE drift_probe');
    }
  }, 60_000);
});
