import { jobListResponseSchema, jobOverviewSchema } from '@nexora/shared';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PrismaService } from '../../src/infrastructure/database/prisma.service.js';
import {
  defineJob,
  PermanentJobError,
  type JobType,
} from '../../src/modules/jobs/job-definition.js';
import { JobQueue } from '../../src/modules/jobs/job-queue.service.js';
import { JobRegistry } from '../../src/modules/jobs/job-registry.service.js';
import { JobWorker, retryDelayMs } from '../../src/modules/jobs/job-worker.service.js';
import {
  createIdentityApp,
  createUser,
  install,
  OWNER,
  resetIdentityData,
  signIn,
  withDb,
} from '../helpers/identity.js';
import type { TestApp } from '../helpers/test-app.js';

const payloadSchema = z.object({ n: z.number().int() });
let typeCounter = 0;
function uniqueType(): JobType<{ n: number }> {
  typeCounter += 1;
  return defineJob(`test.job_${String(typeCounter)}`, payloadSchema);
}

function services(app: TestApp) {
  return {
    prisma: app.app.get(PrismaService),
    queue: app.app.get(JobQueue),
    registry: app.app.get(JobRegistry),
    worker: app.app.get(JobWorker),
  };
}

async function jobRows(name: string) {
  return withDb(
    async (db) =>
      (
        await db.query(
          `SELECT id, status, attempts, last_error, dedupe_key, run_at, locked_by
             FROM jobs WHERE name = $1 ORDER BY created_at`,
          [name],
        )
      ).rows as {
        id: string;
        status: string;
        attempts: number;
        last_error: string | null;
        dedupe_key: string | null;
        run_at: Date;
        locked_by: string | null;
      }[],
  );
}

describe('background job queue', () => {
  let first: TestApp;
  let second: TestApp;
  beforeAll(async () => {
    await resetIdentityData();
    first = await createIdentityApp({ JOBS_RETRY_BASE_MS: '10', JOBS_SHUTDOWN_GRACE_MS: '200' });
    second = await createIdentityApp({ JOBS_RETRY_BASE_MS: '10' });
  });
  afterAll(async () => {
    await first.close();
    await second.close();
  });

  it('never runs jobs enqueued in a rolled-back transaction, and runs committed ones once', async () => {
    const { prisma, queue, registry, worker } = services(first);
    const type = uniqueType();
    const seen: number[] = [];
    registry.register(type, (payload) => {
      seen.push(payload.n);
      return Promise.resolve();
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await queue.enqueue(tx, type, { n: 1 });
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    await prisma.$transaction(async (tx) => {
      await queue.enqueue(tx, type, { n: 2 });
    });

    expect(await worker.drain()).toBe(1);
    expect(await worker.drain()).toBe(0);
    expect(seen).toEqual([2]);
    const [row] = await jobRows(type.name);
    expect(row).toMatchObject({ status: 'succeeded', attempts: 1, last_error: null });
  });

  it('validates payloads and requires a registered handler when enqueueing', async () => {
    const { prisma, queue, registry } = services(first);
    const type = uniqueType();
    await expect(queue.enqueue(prisma, type, { n: 1 })).rejects.toThrow(/No handler/);
    registry.register(type, () => Promise.resolve());
    await expect(queue.enqueue(prisma, type, { n: 'x' } as never)).rejects.toThrow();
    expect(await jobRows(type.name)).toEqual([]);
  });

  it('deduplicates by key while a job exists, and releases the key when it finishes', async () => {
    const { prisma, queue, registry, worker } = services(first);
    const type = uniqueType();
    registry.register(type, () => Promise.resolve());
    expect(await queue.enqueue(prisma, type, { n: 1 }, { dedupeKey: 'dedupe-a' })).toBe(true);
    expect(await queue.enqueue(prisma, type, { n: 2 }, { dedupeKey: 'dedupe-a' })).toBe(false);
    await worker.drain();
    expect(await queue.enqueue(prisma, type, { n: 3 }, { dedupeKey: 'dedupe-a' })).toBe(true);
    expect((await jobRows(type.name)).map((row) => row.status)).toEqual(['succeeded', 'pending']);
    await worker.drain();
  });

  it('executes every job exactly once when two workers race', async () => {
    const a = services(first);
    const b = services(second);
    const type = uniqueType();
    const runs = new Map<number, number>();
    const handler = async (payload: { n: number }) => {
      runs.set(payload.n, (runs.get(payload.n) ?? 0) + 1);
      await sleep(5);
    };
    a.registry.register(type, handler);
    b.registry.register(type, handler);
    await a.prisma.$transaction(async (tx) => {
      for (let n = 0; n < 30; n += 1) {
        await a.queue.enqueue(tx, type, { n });
      }
    });
    expect(a.worker.id).not.toBe(b.worker.id);
    const [doneA, doneB] = await Promise.all([a.worker.drain(), b.worker.drain()]);
    expect(doneA + doneB).toBe(30);
    expect(doneA).toBeGreaterThan(0);
    expect(doneB).toBeGreaterThan(0);
    expect([...runs.values()].every((count) => count === 1)).toBe(true);
    expect(runs.size).toBe(30);
  });

  it('retries failures with backoff and declares the job dead after the last attempt', async () => {
    const { prisma, queue, registry, worker } = services(first);
    const type = uniqueType();
    let calls = 0;
    registry.register(
      type,
      () => {
        calls += 1;
        return Promise.reject(new Error(`boom ${String(calls)}`));
      },
      { maxAttempts: 3 },
    );
    await queue.enqueue(prisma, type, { n: 1 }, { dedupeKey: 'retry-key' });

    await worker.drain();
    let [row] = await jobRows(type.name);
    expect(row).toMatchObject({ status: 'pending', attempts: 1, last_error: 'Error: boom 1' });
    expect(row!.run_at.getTime()).toBeGreaterThan(Date.now() - 1_000);
    expect(row!.dedupe_key).toBe('retry-key');

    for (let attempt = 0; attempt < 10 && calls < 3; attempt += 1) {
      await sleep(60);
      await worker.drain();
    }
    [row] = await jobRows(type.name);
    expect(calls).toBe(3);
    expect(row).toMatchObject({
      status: 'dead',
      attempts: 3,
      last_error: 'Error: boom 3',
      dedupe_key: null,
    });
  });

  it('computes exponential backoff with bounded jitter', () => {
    for (const [attempt, base] of [
      [1, 1000],
      [3, 1000],
      [20, 1000],
    ] as const) {
      const expected = Math.min(3_600_000, base * 2 ** (attempt - 1));
      const delay = retryDelayMs(attempt, base);
      expect(delay).toBeGreaterThanOrEqual(Math.max(base, expected * 0.8));
      expect(delay).toBeLessThanOrEqual(expected * 1.2);
    }
  });

  it('stops immediately on permanent errors and on payloads that no longer validate', async () => {
    const { prisma, queue, registry, worker } = services(first);
    const permanent = uniqueType();
    registry.register(permanent, () => Promise.reject(new PermanentJobError('record is gone')));
    await queue.enqueue(prisma, permanent, { n: 1 });

    const strict = uniqueType();
    registry.register(strict, () => Promise.resolve());
    await withDb((db) =>
      db.query(`INSERT INTO jobs (id, name, payload) VALUES (gen_random_uuid(), $1, '{"n":"x"}')`, [
        strict.name,
      ]),
    );
    await worker.drain();
    expect(await jobRows(permanent.name)).toMatchObject([
      { status: 'dead', attempts: 1, last_error: 'PermanentJobError: record is gone' },
    ]);
    const [invalid] = await jobRows(strict.name);
    expect(invalid?.status).toBe('dead');
    expect(invalid?.last_error).toMatch(/^Invalid payload/);
  });

  it('times out hung handlers and retries them', async () => {
    const { prisma, queue, registry, worker } = services(first);
    const type = uniqueType();
    registry.register(type, () => new Promise<void>(() => undefined), { timeoutMs: 50 });
    await queue.enqueue(prisma, type, { n: 1 });
    await worker.drain();
    expect(await jobRows(type.name)).toMatchObject([
      { status: 'pending', attempts: 1, last_error: 'JobTimeoutError: Timed out after 50 ms' },
    ]);
  });

  it('reclaims jobs abandoned by a crashed worker, and gives up after the last attempt', async () => {
    const { registry, worker } = services(first);
    const type = uniqueType();
    const seen: number[] = [];
    registry.register(
      type,
      (payload) => {
        seen.push(payload.n);
        return Promise.resolve();
      },
      { maxAttempts: 2 },
    );
    await withDb(async (db) => {
      const insert = `INSERT INTO jobs (id, name, payload, status, attempts, max_attempts, locked_at, locked_by)
        VALUES (gen_random_uuid(), $1, $2, 'running', $3, 2, $4, 'crashed-worker')`;
      await db.query(insert, [type.name, '{"n":1}', 1, new Date(Date.now() - 3_600_000)]);
      await db.query(insert, [type.name, '{"n":2}', 2, new Date(Date.now() - 3_600_000)]);
      // A fresh claim by a live worker is not touched.
      await db.query(insert, [type.name, '{"n":3}', 1, new Date()]);
    });
    await worker.drain();
    expect(seen).toEqual([1]);
    const rows = await jobRows(type.name);
    expect(rows.map((row) => [row.status, row.attempts, row.locked_by])).toEqual([
      ['succeeded', 2, null],
      ['dead', 3, null],
      ['running', 1, 'crashed-worker'],
    ]);
    expect(rows[1]!.last_error).toBe('Abandoned by a worker during its last attempt');
  });

  it('only the worker holding the claim can record the outcome', async () => {
    const { prisma, queue, registry, worker } = services(first);
    const type = uniqueType();
    registry.register(type, async (_payload, context) => {
      // Simulate the claim being taken over (e.g. after a lock timeout) while this attempt still runs.
      await withDb((db) =>
        db.query(`UPDATE jobs SET locked_by = 'someone-else' WHERE id = $1`, [context.jobId]),
      );
    });
    await queue.enqueue(prisma, type, { n: 1 });
    await worker.drain();
    expect(await jobRows(type.name)).toMatchObject([
      { status: 'running', locked_by: 'someone-else' },
    ]);
  });

  it('runs a recurring task once per slot across workers, even after the job finished', async () => {
    const a = services(first);
    const b = services(second);
    const type = uniqueType();
    a.registry.register(type, () => Promise.resolve());
    b.registry.register(type, () => Promise.resolve());
    a.registry.schedule(type.name, 60_000, type, { n: 7 });
    b.registry.schedule(type.name, 60_000, type, { n: 7 });
    const now = Date.now();
    await Promise.all([a.worker.enqueueDueSchedules(now), b.worker.enqueueDueSchedules(now)]);
    expect(await jobRows(type.name)).toHaveLength(1);
    await a.worker.drain();
    // A worker that has not seen this slot yet (e.g. just restarted) must not run it again.
    const restarted = await createIdentityApp();
    try {
      const c = services(restarted);
      c.registry.register(type, () => Promise.resolve());
      c.registry.schedule(type.name, 60_000, type, { n: 7 });
      await c.worker.enqueueDueSchedules(now);
      expect(await jobRows(type.name)).toHaveLength(1);
      await c.worker.enqueueDueSchedules(now + 60_000);
      expect((await jobRows(type.name)).map((row) => row.status)).toEqual(['succeeded', 'pending']);
    } finally {
      await restarted.close();
    }
  });

  it('the background loop wakes up on NOTIFY and shuts down gracefully, releasing unfinished work', async () => {
    const app = await createIdentityApp({
      JOBS_POLL_INTERVAL_MS: '60000',
      JOBS_SHUTDOWN_GRACE_MS: '100',
    });
    const { prisma, queue, registry, worker } = services(app);
    try {
      const quick = uniqueType();
      const slow = uniqueType();
      const quickRuns: number[] = [];
      const slowState = { started: false };
      registry.register(quick, (payload) => {
        quickRuns.push(payload.n);
        return Promise.resolve();
      });
      registry.register(
        slow,
        (_payload, context) =>
          new Promise<void>((resolve) => {
            slowState.started = true;
            context.signal.addEventListener('abort', () => {
              resolve();
            });
          }),
      );
      worker.start();
      // Let the listener connect, then enqueue: with a 60 s poll interval only NOTIFY can start it quickly.
      await sleep(500);
      await queue.enqueue(prisma, quick, { n: 1 });
      for (let i = 0; i < 40 && quickRuns.length === 0; i += 1) await sleep(50);
      expect(quickRuns).toEqual([1]);
      const heartbeat = await prisma.jobWorker.findUnique({ where: { id: worker.id } });
      expect(heartbeat?.pid).toBe(process.pid);

      await queue.enqueue(prisma, slow, { n: 2 });
      for (let i = 0; i < 40 && !slowState.started; i += 1) await sleep(50);
      expect(slowState.started).toBe(true);
      await worker.stop();
      expect(await jobRows(slow.name)).toMatchObject([
        { status: 'pending', attempts: 0, locked_by: null },
      ]);
      expect(await prisma.jobWorker.findUnique({ where: { id: worker.id } })).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('exposes queue state to operators with jobs.manage, who can retry and discard dead jobs', async () => {
    await install(first.server);
    const owner = await signIn(first.server, OWNER.email, OWNER.password);
    const editor = await createUser(owner, 'editor');
    const editorSession = await signIn(first.server, editor.email, editor.password);
    await editorSession.agent.get('/api/v1/jobs').expect(403);
    await editorSession.agent.get('/api/v1/jobs/overview').expect(403);

    const { prisma, queue, registry } = services(first);
    const type = uniqueType();
    registry.register(type, () => Promise.reject(new PermanentJobError('nope')));
    await queue.enqueue(prisma, type, { n: 1 });
    await services(first).worker.drain();
    const deadRow = (await jobRows(type.name))[0]!;

    const list = jobListResponseSchema.parse(
      (await owner.agent.get('/api/v1/jobs?status=dead').expect(200)).body,
    );
    expect(list.items.find((job) => job.id === deadRow.id)).toMatchObject({
      name: type.name,
      status: 'dead',
      lastError: 'PermanentJobError: nope',
    });
    expect(Object.keys(list.items[0]!)).not.toContain('payload');
    const overview = jobOverviewSchema.parse(
      (await owner.agent.get('/api/v1/jobs/overview').expect(200)).body,
    );
    expect(overview.counts.dead).toBeGreaterThanOrEqual(1);

    await owner.agent
      .post(`/api/v1/jobs/${deadRow.id}/retry`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(200);
    expect(await jobRows(type.name)).toMatchObject([{ status: 'pending', attempts: 0 }]);
    await owner.agent
      .post(`/api/v1/jobs/${deadRow.id}/retry`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(409);
    await services(first).worker.drain();
    await owner.agent
      .delete(`/api/v1/jobs/${deadRow.id}`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(204);
    expect(await jobRows(type.name)).toEqual([]);
    const audit = await withDb(
      async (db) =>
        (
          await db.query(
            `SELECT action FROM audit_events WHERE target_id = $1 ORDER BY occurred_at`,
            [deadRow.id],
          )
        ).rows as { action: string }[],
    );
    expect(audit.map((row) => row.action)).toEqual(['job.retried', 'job.discarded']);
  });
});
