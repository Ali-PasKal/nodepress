import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobWorker } from '../../src/modules/jobs/job-worker.service.js';
import { MaintenanceService } from '../../src/modules/maintenance/maintenance.service.js';
import {
  createIdentityApp,
  install,
  OWNER,
  resetIdentityData,
  signIn,
  withDb,
} from '../helpers/identity.js';
import { createEntry } from '../helpers/content.js';
import type { TestApp } from '../helpers/test-app.js';

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms);

describe('maintenance cleanup', () => {
  let testApp: TestApp;
  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
    await install(testApp.server);
  });
  afterAll(() => testApp.close());

  it('purges expired security records and finished jobs, keeping everything recent', async () => {
    const owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    const RANDOM_HASH = `decode(md5(random()::text) || md5(random()::text), 'hex')`;
    const entry = await createEntry(owner, { title: 'Draft with preview links' });
    await withDb(async (db) => {
      const insertSession = `INSERT INTO sessions
          (id, user_id, token_hash, created_at, last_seen_at, expires_at, revoked_at)
        VALUES (gen_random_uuid(), $1, ${RANDOM_HASH}, $2::timestamptz - interval '1 day', $2, $3, $4)`;
      // old revoked, old expired, long idle, and a recently revoked one that must stay
      await db.query(insertSession, [owner.userId, ago(40 * DAY), ago(39 * DAY), ago(40 * DAY)]);
      await db.query(insertSession, [owner.userId, ago(40 * DAY), ago(31 * DAY), null]);
      await db.query(insertSession, [
        owner.userId,
        ago(62 * DAY),
        new Date(Date.now() + DAY),
        null,
      ]);
      await db.query(insertSession, [owner.userId, ago(2 * DAY), ago(DAY), ago(DAY)]);

      const token = `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
        VALUES (gen_random_uuid(), $1, ${RANDOM_HASH}, $2)`;
      await db.query(token, [owner.userId, ago(2 * DAY)]);
      await db.query(token, [owner.userId, ago(60_000)]);

      await db.query(
        `INSERT INTO rate_limit_buckets (key, count, expires_at) VALUES
        ('test:old:1', 1, $1), ('test:live:1', 1, $2)`,
        [ago(1000), new Date(Date.now() + 60_000)],
      );

      const job = `INSERT INTO jobs (id, name, status, finished_at) VALUES (gen_random_uuid(), 'test.cleanup', $1, $2)`;
      await db.query(job, ['succeeded', ago(8 * DAY)]);
      await db.query(job, ['succeeded', ago(DAY)]);
      await db.query(job, ['dead', ago(31 * DAY)]);
      await db.query(job, ['dead', ago(8 * DAY)]);

      await db.query(
        `INSERT INTO job_workers (id, hostname, pid, started_at, last_seen_at) VALUES
        ('stale-worker', 'h', 1, $1, $1), ('live-worker', 'h', 2, $2, $2)`,
        [ago(2 * DAY), new Date()],
      );

      const preview = `INSERT INTO preview_tokens (id, entry_id, created_by_id, token_hash, created_at, expires_at)
        VALUES (gen_random_uuid(), $1, $2, ${RANDOM_HASH}, $3::timestamptz - interval '1 hour', $3)`;
      await db.query(preview, [entry.id, owner.userId, ago(60_000)]);
      await db.query(preview, [entry.id, owner.userId, new Date(Date.now() + 30 * 60_000)]);
    });

    const result = await testApp.app.get(MaintenanceService).cleanup();
    expect(result).toEqual({
      sessions: 3,
      passwordResetTokens: 1,
      rateLimitBuckets: 1,
      jobs: 2,
      workers: 1,
      previewTokens: 1,
    });
    // The signed-in owner's live session survives.
    await owner.agent.get('/api/v1/account/profile').expect(200);
    const remaining = await withDb(
      async (db) =>
        (
          await db.query(`SELECT
            (SELECT count(*)::int FROM password_reset_tokens) AS tokens,
            (SELECT count(*)::int FROM jobs WHERE name = 'test.cleanup') AS jobs,
            (SELECT array_agg(id) FROM job_workers) AS workers,
            (SELECT count(*)::int FROM preview_tokens) AS previews`)
        ).rows[0] as { tokens: number; jobs: number; workers: string[]; previews: number },
    );
    expect(remaining).toEqual({ tokens: 1, jobs: 2, workers: ['live-worker'], previews: 1 });
  });

  it('is scheduled hourly as a recurring job', async () => {
    const worker = testApp.app.get(JobWorker);
    await worker.enqueueDueSchedules();
    const [job] = await withDb(
      async (db) =>
        (
          await db.query(
            `SELECT dedupe_key, release_dedupe_key FROM jobs WHERE name = 'maintenance.cleanup'`,
          )
        ).rows as { dedupe_key: string; release_dedupe_key: boolean }[],
    );
    expect(job?.dedupe_key).toMatch(/^schedule:maintenance\.cleanup:\d+$/);
    expect(job?.release_dedupe_key).toBe(false);
    await worker.drain();
  });
});
