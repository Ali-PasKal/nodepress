import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ReadinessResponse, ReadinessStatus } from '@nexora/shared';
import { ShutdownState } from '../../common/lifecycle/shutdown-state.service.js';
import { withTimeout } from '../../common/utils/with-timeout.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { CacheClient } from '../../infrastructure/cache/cache-client.service.js';
import { MigrationStatusService } from '../../infrastructure/database/migration-status.service.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

type Checks = ReadinessResponse['checks'];

/**
 * Minimum interval between real dependency checks. Readiness is an unauthenticated endpoint, so
 * concurrent and rapid-fire probes share one result instead of each hitting the database.
 */
const RESULT_TTL_MS = 1_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private inFlight: Promise<ReadinessResponse> | null = null;
  private cached: { at: number; result: ReadinessResponse } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly migrations: MigrationStatusService,
    private readonly cache: CacheClient,
    private readonly shutdown: ShutdownState,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async readiness(): Promise<ReadinessResponse> {
    if (this.shutdown.isShuttingDown) {
      // Bypass the result cache so a drain is reported immediately, not up to RESULT_TTL_MS later.
      return this.buildResponse(await this.runChecks(), true);
    }
    const now = Date.now();
    if (this.cached && now - this.cached.at < RESULT_TTL_MS) {
      return this.cached.result;
    }
    this.inFlight ??= this.runChecks()
      .then((checks) => {
        const result = this.buildResponse(checks, this.shutdown.isShuttingDown);
        this.cached = { at: Date.now(), result };
        return result;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private buildResponse(
    checks: Omit<Checks, 'shutdown'>,
    shuttingDown: boolean,
  ): ReadinessResponse {
    const requiredUp =
      checks.database.status === 'up' && checks.migrations.status === 'up' && !shuttingDown;
    const status: ReadinessStatus = !requiredUp
      ? 'error'
      : checks.cache.status === 'down'
        ? 'degraded'
        : 'ok';
    return {
      status,
      checkedAt: new Date().toISOString(),
      checks: { ...checks, shutdown: { status: shuttingDown ? 'down' : 'up' } },
    };
  }

  private async runChecks(): Promise<Omit<Checks, 'shutdown'>> {
    const [database, migrations, cache] = await Promise.all([
      this.checkDatabase(),
      this.checkMigrations(),
      this.checkCache(),
    ]);
    return { database, migrations, cache };
  }

  private async checkDatabase(): Promise<Checks['database']> {
    const started = performance.now();
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, this.config.health.checkTimeoutMs);
      return { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (err) {
      // Details go to the log only; the public response never includes error messages or hostnames.
      this.logger.warn({ err }, 'Readiness: database check failed');
      return { status: 'down' };
    }
  }

  private async checkMigrations(): Promise<Checks['migrations']> {
    try {
      const status = await withTimeout(
        this.migrations.getStatus(),
        this.config.health.checkTimeoutMs,
      );
      const healthy = status.pending === 0 && status.failed === 0;
      if (!healthy) {
        this.logger.warn(status, 'Readiness: database schema is not up to date');
      }
      return { status: healthy ? 'up' : 'down', pending: status.pending, failed: status.failed };
    } catch (err) {
      this.logger.warn({ err }, 'Readiness: migration status check failed');
      return { status: 'down' };
    }
  }

  private async checkCache(): Promise<Checks['cache']> {
    if (!this.cache.enabled) {
      return { status: 'disabled' };
    }
    const started = performance.now();
    try {
      const timeoutMs = this.config.health.checkTimeoutMs;
      await withTimeout(this.cache.ping(timeoutMs), timeoutMs);
      return { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (err) {
      this.logger.warn({ err }, 'Readiness: cache check failed');
      return { status: 'down' };
    }
  }
}
