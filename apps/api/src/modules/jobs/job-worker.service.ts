import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PermanentJobError, type JobContext } from './job-definition.js';
import { JOBS_CHANNEL, JobQueue } from './job-queue.service.js';
import { JobRegistry } from './job-registry.service.js';

const HEARTBEAT_MS = 30_000;
const MAX_ERROR_LENGTH = 2_000;
const MAX_BACKOFF_MS = 3_600_000;

interface ClaimedJob {
  readonly id: string;
  readonly name: string;
  readonly payload: Prisma.JsonValue;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly releaseDedupeKey: boolean;
}

interface RunningJob {
  readonly controller: AbortController;
  readonly done: Promise<void>;
}

class JobTimeoutError extends Error {
  override readonly name = 'JobTimeoutError';
}

/** Exponential backoff with ±20 % jitter: base, 2×base, 4×base… capped at one hour. */
export function retryDelayMs(attempt: number, baseMs: number): number {
  const exponential = Math.min(MAX_BACKOFF_MS, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = exponential * 0.2 * (Math.random() * 2 - 1);
  return Math.max(baseMs, Math.round(exponential + jitter));
}

function errorMessage(error: unknown): string {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : `Error: ${String(error)}`;
  return message.slice(0, MAX_ERROR_LENGTH);
}

/**
 * Claims and runs jobs. Guarantees: a job is claimed by one worker at a time (FOR UPDATE SKIP LOCKED);
 * completion is recorded only by the worker holding the claim; a claim older than the lock timeout is
 * treated as abandoned and reclaimed (counting as an attempt). Execution is therefore at-least-once and
 * handlers must be idempotent.
 */
@Injectable()
export class JobWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  readonly id = `${hostname()}:${String(process.pid)}:${randomBytes(3).toString('hex')}`.slice(
    0,
    120,
  );
  private readonly logger = new Logger(JobWorker.name);
  private readonly running = new Map<string, RunningJob>();
  /** Jobs interrupted by shutdown: `stop()` returns them to the queue, so the failure path must not. */
  private readonly releasing = new Set<string>();
  private readonly scheduledSlots = new Map<string, number>();
  private started = false;
  private stopping = false;
  private loopDone: Promise<void> | null = null;
  private wakeUp: (() => void) | null = null;
  private listener: pg.Client | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly startedAt = new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobRegistry,
    private readonly queue: JobQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.jobs.worker === 'embedded') {
      this.start();
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  /** Read through a method: `stopping` changes concurrently, across awaits. */
  private isStopping(): boolean {
    return this.stopping;
  }

  get isRunning(): boolean {
    return this.started && !this.stopping;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.stopping = false;
    this.logger.log(
      { workerId: this.id, concurrency: this.config.jobs.concurrency },
      'Background job worker started',
    );
    void this.heartbeat();
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
    this.heartbeatTimer.unref();
    void this.listen();
    this.loopDone = this.loop();
  }

  /** Stops claiming, waits up to JOBS_SHUTDOWN_GRACE_MS for running jobs, then releases the rest. */
  async stop(): Promise<void> {
    if (!this.started || this.stopping) {
      return;
    }
    this.stopping = true;
    this.wake();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    await this.loopDone;
    if (this.running.size > 0) {
      await Promise.race([
        Promise.allSettled([...this.running.values()].map((job) => job.done)),
        sleep(this.config.jobs.shutdownGraceMs),
      ]);
    }
    for (const [jobId, job] of this.running) {
      this.releasing.add(jobId);
      job.controller.abort(new Error('Worker is shutting down'));
      await this.release(jobId);
    }
    this.releasing.clear();
    const listener = this.listener;
    this.listener = null;
    await listener?.end().catch(() => undefined);
    await this.prisma.jobWorker.deleteMany({ where: { id: this.id } }).catch(() => undefined);
    this.started = false;
    this.logger.log({ workerId: this.id }, 'Background job worker stopped');
  }

  /**
   * Runs everything that is due right now and waits for it, repeating until nothing is left (bounded).
   * Used by tests and maintenance tooling; independent of the background loop.
   */
  async drain(maxRounds = 20): Promise<number> {
    let processed = 0;
    for (let round = 0; round < maxRounds; round += 1) {
      const claimed = await this.claim(this.config.jobs.concurrency);
      if (claimed.length === 0) {
        break;
      }
      await Promise.all(claimed.map((job) => this.execute(job)));
      processed += claimed.length;
    }
    return processed;
  }

  /** Enqueues the current slot of every recurring task (idempotent across workers). */
  async enqueueDueSchedules(now = Date.now()): Promise<void> {
    for (const task of this.registry.recurringTasks) {
      const slot = Math.floor(now / task.everyMs);
      if (this.scheduledSlots.get(task.key) === slot) {
        continue;
      }
      await this.queue.enqueue(this.prisma, task.type, task.payload, {
        dedupeKey: `schedule:${task.key}:${String(slot)}`,
        keepDedupeKey: true,
        runAt: new Date(slot * task.everyMs),
      });
      this.scheduledSlots.set(task.key, slot);
    }
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.enqueueDueSchedules();
        const free = this.config.jobs.concurrency - this.running.size;
        if (free > 0) {
          for (const job of await this.claim(free)) {
            this.track(job);
          }
        }
      } catch (err) {
        this.logger.warn({ err }, 'Job worker iteration failed; retrying');
      }
      await this.waitForWake(this.config.jobs.pollIntervalMs);
    }
  }

  private track(job: ClaimedJob): void {
    const controller = new AbortController();
    const done = this.execute(job, controller).finally(() => {
      this.running.delete(job.id);
      this.wake();
    });
    this.running.set(job.id, { controller, done });
  }

  private waitForWake(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, timeoutMs);
      function done(): void {
        clearTimeout(timer);
        resolve();
      }
      this.wakeUp = done;
    });
  }

  private wake(): void {
    const wakeUp = this.wakeUp;
    this.wakeUp = null;
    wakeUp?.();
  }

  private async claim(limit: number): Promise<ClaimedJob[]> {
    const lockTimeoutMs = this.config.jobs.lockTimeoutMs;
    return this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE jobs
         SET status = 'running', locked_at = now(), locked_by = ${this.id},
             attempts = attempts + 1, updated_at = now()
       WHERE id IN (
         SELECT id FROM jobs
          WHERE (status = 'pending' AND run_at <= now())
             OR (status = 'running' AND locked_at < now() - (${lockTimeoutMs}::integer * interval '1 millisecond'))
          ORDER BY run_at, id
          LIMIT ${limit}::integer
          FOR UPDATE SKIP LOCKED)
      RETURNING id, name, payload, attempts, max_attempts AS "maxAttempts",
                release_dedupe_key AS "releaseDedupeKey"`;
  }

  private async execute(job: ClaimedJob, controller = new AbortController()): Promise<void> {
    const registered = this.registry.get(job.name);
    if (!registered) {
      await this.markDead(job, `No handler is registered for job "${job.name}"`);
      return;
    }
    if (job.attempts > job.maxAttempts) {
      await this.markDead(job, 'Abandoned by a worker during its last attempt');
      return;
    }
    const payload = registered.type.schema.safeParse(job.payload);
    if (!payload.success) {
      await this.markDead(job, `Invalid payload: ${payload.error.message}`);
      return;
    }

    const timeout = setTimeout(() => {
      controller.abort(new JobTimeoutError(`Timed out after ${String(registered.timeoutMs)} ms`));
    }, registered.timeoutMs);
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          reject(
            controller.signal.reason instanceof Error
              ? controller.signal.reason
              : new Error('Aborted'),
          );
        },
        { once: true },
      );
    });
    const context: JobContext = {
      jobId: job.id,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      signal: controller.signal,
    };
    try {
      await Promise.race([registered.handle(payload.data, context), aborted]);
      await this.markSucceeded(job);
    } catch (error) {
      if (this.releasing.has(job.id)) {
        // Interrupted by shutdown: not a failed attempt. stop() releases it without counting the attempt
        // (marking it for retry here would race with that and add a backoff delay).
        return;
      }
      const message = errorMessage(error);
      if (error instanceof PermanentJobError || job.attempts >= job.maxAttempts) {
        this.logger.error(
          { jobId: job.id, job: job.name, attempt: job.attempts, error: message },
          'Background job failed permanently',
        );
        await this.markDead(job, message);
      } else {
        this.logger.warn(
          { jobId: job.id, job: job.name, attempt: job.attempts, error: message },
          'Background job failed; will retry',
        );
        await this.markRetry(job, message);
      }
    } finally {
      clearTimeout(timeout);
      aborted.catch(() => undefined);
    }
  }

  private ownClaim(jobId: string): Prisma.JobWhereInput {
    return { id: jobId, lockedBy: this.id, status: 'running' };
  }

  private async markSucceeded(job: ClaimedJob): Promise<void> {
    await this.prisma.job.updateMany({
      where: this.ownClaim(job.id),
      data: {
        status: 'succeeded',
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        ...(job.releaseDedupeKey ? { dedupeKey: null } : {}),
      },
    });
  }

  private async markRetry(job: ClaimedJob, message: string): Promise<void> {
    await this.prisma.job.updateMany({
      where: this.ownClaim(job.id),
      data: {
        status: 'pending',
        runAt: new Date(Date.now() + retryDelayMs(job.attempts, this.config.jobs.retryBaseMs)),
        lockedAt: null,
        lockedBy: null,
        lastError: message,
      },
    });
  }

  private async markDead(job: ClaimedJob, message: string): Promise<void> {
    await this.prisma.job.updateMany({
      where: this.ownClaim(job.id),
      data: {
        status: 'dead',
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: message.slice(0, MAX_ERROR_LENGTH),
        ...(job.releaseDedupeKey ? { dedupeKey: null } : {}),
      },
    });
  }

  /** Returns an interrupted job to the queue without counting the interrupted attempt. */
  private async release(jobId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE jobs SET status = 'pending', locked_at = NULL, locked_by = NULL, run_at = now(),
                      attempts = GREATEST(attempts - 1, 0), updated_at = now()
       WHERE id = ${jobId}::uuid AND locked_by = ${this.id} AND status = 'running'`;
  }

  private async heartbeat(): Promise<void> {
    try {
      const now = new Date();
      await this.prisma.jobWorker.upsert({
        where: { id: this.id },
        create: {
          id: this.id,
          hostname: hostname().slice(0, 255),
          pid: process.pid,
          startedAt: this.startedAt,
          lastSeenAt: now,
        },
        update: { lastSeenAt: now },
      });
    } catch (err) {
      this.logger.warn({ err }, 'Could not record worker heartbeat');
    }
  }

  /** LISTEN for enqueue notifications so new jobs start immediately; polling covers any gap. */
  private async listen(): Promise<void> {
    while (!this.stopping) {
      const client = new pg.Client({
        connectionString: this.config.database.url,
        connectionTimeoutMillis: this.config.database.connectTimeoutMs,
        application_name: 'nexora-worker-listen',
      });
      const closed = new Promise<void>((resolve) => {
        client.on('error', (err) => {
          this.logger.warn({ err }, 'Job notification listener error; reconnecting');
          resolve();
        });
        client.on('end', () => {
          resolve();
        });
      });
      client.on('notification', () => {
        this.wake();
      });
      try {
        await client.connect();
        await client.query(`LISTEN ${JOBS_CHANNEL}`);
        this.listener = client;
        if (this.isStopping()) {
          await client.end();
          return;
        }
        await closed;
      } catch (err) {
        this.logger.warn({ err }, 'Job notification listener could not connect; polling meanwhile');
        await client.end().catch(() => undefined);
      }
      this.listener = null;
      if (!this.isStopping()) {
        await sleep(Math.max(1_000, this.config.jobs.pollIntervalMs));
      }
    }
  }
}
