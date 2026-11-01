import { Injectable } from '@nestjs/common';
import type { JobListResponse, JobOverview, JobStatus, JobSummary } from '@nexora/shared';
import { ApiException } from '../../common/errors/api-exception.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../security/auth-context.js';
import type { EnqueueOptions, JobType } from './job-definition.js';
import { JobRegistry } from './job-registry.service.js';

/** PostgreSQL channel used to wake workers when a job is committed. */
export const JOBS_CHANNEL = 'nexora_jobs';
const WORKER_ACTIVE_MS = 90_000;

type JobRow = Prisma.JobGetPayload<object>;

function toSummary(job: JobRow): JobSummary {
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAt: job.runAt.toISOString(),
    lastError: job.lastError,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Enqueues jobs and serves the operator views. `enqueue` takes the caller's transaction client: the job
 * row commits (and workers are notified) if and only if the surrounding change commits.
 */
@Injectable()
export class JobQueue {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobRegistry,
    private readonly audit: AuditService,
  ) {}

  /** Returns false when a job with the same dedupe key already exists. */
  async enqueue<Payload>(
    db: DbClient,
    type: JobType<Payload>,
    payload: Payload,
    options: EnqueueOptions = {},
  ): Promise<boolean> {
    const registered = this.registry.get(type.name);
    if (!registered) {
      throw new Error(`No handler is registered for job "${type.name}"`);
    }
    // Validate on the way in so a bad payload fails the caller, not a worker hours later.
    const data = {
      name: type.name,
      payload: type.schema.parse(payload) as Prisma.InputJsonValue,
      maxAttempts: options.maxAttempts ?? registered.maxAttempts,
      runAt: options.runAt ?? new Date(),
      dedupeKey: options.dedupeKey ?? null,
      releaseDedupeKey: !options.keepDedupeKey,
    };
    let created: boolean;
    if (data.dedupeKey === null) {
      await db.job.create({ data });
      created = true;
    } else {
      const result = await db.job.createMany({ data: [data], skipDuplicates: true });
      created = result.count === 1;
    }
    if (created) {
      // Delivered on commit; discarded if the transaction rolls back.
      await db.$executeRaw`SELECT pg_notify(${JOBS_CHANNEL}, ${type.name})`;
    }
    return created;
  }

  async list(query: {
    page: number;
    pageSize: number;
    status?: JobStatus | undefined;
  }): Promise<JobListResponse> {
    const where = query.status ? { status: query.status } : {};
    const [total, rows] = await Promise.all([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total };
  }

  async overview(): Promise<JobOverview> {
    const [grouped, oldestDue, workers] = await Promise.all([
      this.prisma.job.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.job.findFirst({
        where: { status: 'pending', runAt: { lte: new Date() } },
        orderBy: { runAt: 'asc' },
        select: { runAt: true },
      }),
      this.prisma.jobWorker.findMany({ orderBy: { lastSeenAt: 'desc' }, take: 20 }),
    ]);
    const counts = { pending: 0, running: 0, succeeded: 0, dead: 0 };
    for (const group of grouped) {
      counts[group.status] = group._count._all;
    }
    const now = Date.now();
    return {
      counts,
      oldestDueSeconds: oldestDue
        ? Math.max(0, Math.floor((now - oldestDue.runAt.getTime()) / 1000))
        : 0,
      workers: workers.map((worker) => ({
        id: worker.id,
        hostname: worker.hostname,
        pid: worker.pid,
        startedAt: worker.startedAt.toISOString(),
        lastSeenAt: worker.lastSeenAt.toISOString(),
        active: now - worker.lastSeenAt.getTime() < WORKER_ACTIVE_MS,
      })),
    };
  }

  /** Gives a dead job a fresh set of attempts. */
  async retry(actor: AuthContext, id: string, meta: RequestMeta): Promise<JobSummary> {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({ where: { id } });
      if (!job) {
        throw new ApiException(404, 'NOT_FOUND', 'Job not found.');
      }
      if (job.status !== 'dead') {
        throw new ApiException(409, 'CONFLICT', 'Only failed (dead) jobs can be retried.');
      }
      const updated = await tx.job.update({
        where: { id },
        data: {
          status: 'pending',
          attempts: 0,
          runAt: new Date(),
          finishedAt: null,
          lockedAt: null,
          lockedBy: null,
        },
      });
      await tx.$executeRaw`SELECT pg_notify(${JOBS_CHANNEL}, ${job.name})`;
      await this.audit.record(tx, {
        action: 'job.retried',
        actorUserId: actor.userId,
        targetType: 'job',
        targetId: id,
        request: meta,
        metadata: { name: job.name },
      });
      return toSummary(updated);
    });
  }

  async discard(actor: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({ where: { id }, select: { status: true, name: true } });
      if (!job) {
        throw new ApiException(404, 'NOT_FOUND', 'Job not found.');
      }
      if (job.status !== 'dead') {
        throw new ApiException(409, 'CONFLICT', 'Only failed (dead) jobs can be discarded.');
      }
      await tx.job.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'job.discarded',
        actorUserId: actor.userId,
        targetType: 'job',
        targetId: id,
        request: meta,
        metadata: { name: job.name },
      });
    });
  }
}
