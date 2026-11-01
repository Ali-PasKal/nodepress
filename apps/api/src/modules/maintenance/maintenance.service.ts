import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { defineJob } from '../jobs/job-definition.js';
import { JobRegistry } from '../jobs/job-registry.service.js';

const DAY_MS = 86_400_000;
/** Ended sessions are kept this long for the "recent sessions" views, then deleted. */
export const SESSION_RETENTION_MS = 30 * DAY_MS;
export const RESET_TOKEN_RETENTION_MS = DAY_MS;
export const SUCCEEDED_JOB_RETENTION_MS = 7 * DAY_MS;
export const DEAD_JOB_RETENTION_MS = 30 * DAY_MS;
export const WORKER_RETENTION_MS = DAY_MS;

export const CleanupJob = defineJob('maintenance.cleanup', z.object({}));

export interface CleanupResult {
  readonly sessions: number;
  readonly passwordResetTokens: number;
  readonly rateLimitBuckets: number;
  readonly jobs: number;
  readonly workers: number;
}

/** Hourly purge of expired security records and finished jobs. */
@Injectable()
export class MaintenanceService implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.registry.register(CleanupJob, async () => {
      await this.cleanup();
    });
    this.registry.schedule('maintenance.cleanup', 3_600_000, CleanupJob, {});
  }

  async cleanup(now = new Date()): Promise<CleanupResult> {
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const [sessions, passwordResetTokens, rateLimitBuckets, jobs, workers] = await Promise.all([
      this.prisma.session.deleteMany({
        where: {
          OR: [
            { revokedAt: { lt: ago(SESSION_RETENTION_MS) } },
            { expiresAt: { lt: ago(SESSION_RETENTION_MS) } },
            { lastSeenAt: { lt: ago(this.config.session.idleTimeoutMs + SESSION_RETENTION_MS) } },
          ],
        },
      }),
      this.prisma.passwordResetToken.deleteMany({
        where: { expiresAt: { lt: ago(RESET_TOKEN_RETENTION_MS) } },
      }),
      this.prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.job.deleteMany({
        where: {
          OR: [
            { status: 'succeeded', finishedAt: { lt: ago(SUCCEEDED_JOB_RETENTION_MS) } },
            { status: 'dead', finishedAt: { lt: ago(DEAD_JOB_RETENTION_MS) } },
          ],
        },
      }),
      this.prisma.jobWorker.deleteMany({ where: { lastSeenAt: { lt: ago(WORKER_RETENTION_MS) } } }),
    ]);
    const result: CleanupResult = {
      sessions: sessions.count,
      passwordResetTokens: passwordResetTokens.count,
      rateLimitBuckets: rateLimitBuckets.count,
      jobs: jobs.count,
      workers: workers.count,
    };
    this.logger.log({ deleted: result }, 'Maintenance cleanup finished');
    return result;
  }
}
