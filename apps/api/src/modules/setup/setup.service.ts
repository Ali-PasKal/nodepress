import { Inject, Injectable } from '@nestjs/common';
import type { SetupStatusResponse } from '@nexora/shared';
import type { setupInstallSchema } from '@nexora/shared';
import type { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception.js';
import { RateLimitedException } from '../../common/errors/rate-limited.exception.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { MigrationStatusService } from '../../infrastructure/database/migration-status.service.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { NEXORA_VERSION } from '../../version.js';
import { AuditService } from '../audit/audit.service.js';
import { safeEqual, sha256 } from '../security/crypto.js';
import { PasswordHasher } from '../security/password-hasher.service.js';
import { RATE_LIMITS, RateLimiter } from '../security/rate-limiter.service.js';
import { DEFAULT_SITE_KEY } from '../sites/site.service.js';

/** Arbitrary constant identifying the setup advisory lock. */
const SETUP_LOCK_KEY = 48_392_017n;

@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly migrations: MigrationStatusService,
    private readonly hasher: PasswordHasher,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async isInstalled(): Promise<boolean> {
    const state = await this.prisma.systemState.findUnique({
      where: { id: 1 },
      select: { installedAt: true },
    });
    return (state?.installedAt ?? null) !== null;
  }

  /** Environment checks for the wizard. Once installed, reveals nothing beyond that fact. */
  async status(httpsRequest: boolean): Promise<SetupStatusResponse> {
    if (await this.isInstalled()) {
      return { installed: true };
    }
    const migrations = await this.migrations.getStatus().catch(() => null);
    return {
      installed: false,
      checks: {
        database: 'up',
        migrations: migrations?.pending === 0 && migrations.failed === 0 ? 'up' : 'down',
      },
      security: {
        environment: this.config.env,
        secureCookies: this.config.session.cookieSecure,
        httpsRequest,
      },
    };
  }

  /**
   * One-time installation. Serialised with an advisory lock and re-checked inside the transaction, so
   * concurrent attempts cannot create two administrators; afterwards it always fails with 409.
   */
  async install(input: z.output<typeof setupInstallSchema>, meta: RequestMeta): Promise<void> {
    const limit = await this.limiter.hit(
      'setup-ip',
      meta.ipAddress ?? 'unknown',
      RATE_LIMITS.setupPerIp,
    );
    if (!limit.allowed) {
      throw new RateLimitedException(limit.retryAfterSeconds);
    }
    if (await this.isInstalled()) {
      throw new ApiException(409, 'CONFLICT', 'This instance is already installed.');
    }
    const passwordHash = await this.hasher.hash(input.admin.password);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`;
      const state = await tx.systemState.findUnique({ where: { id: 1 } });
      if (state?.installedAt) {
        throw new ApiException(409, 'CONFLICT', 'This instance is already installed.');
      }
      const expected = this.config.setup.token
        ? sha256(this.config.setup.token)
        : state?.setupTokenHash;
      if (!expected || !safeEqual(sha256(input.setupToken), expected)) {
        throw new ApiException(
          403,
          'FORBIDDEN',
          'The setup token is not valid. Copy it from the API server log.',
        );
      }

      const now = new Date();
      const site = await tx.site.upsert({
        where: { key: DEFAULT_SITE_KEY },
        create: { key: DEFAULT_SITE_KEY, name: input.site.name, baseUrl: input.site.baseUrl },
        update: { name: input.site.name, baseUrl: input.site.baseUrl },
      });
      const role = await tx.role.findUniqueOrThrow({ where: { key: 'super_admin' } });
      const user = await tx.user.create({
        data: {
          email: input.admin.email,
          displayName: input.admin.displayName,
          passwordChangedAt: now,
          credential: { create: { passwordHash } },
          roleAssignments: { create: { siteId: site.id, roleId: role.id } },
        },
      });
      await tx.systemState.upsert({
        where: { id: 1 },
        create: { id: 1, installedAt: now, installedVersion: NEXORA_VERSION },
        update: { installedAt: now, installedVersion: NEXORA_VERSION, setupTokenHash: null },
      });
      await this.audit.record(tx, {
        action: 'setup.completed',
        actorUserId: user.id,
        targetType: 'site',
        targetId: site.id,
        request: meta,
        metadata: { version: NEXORA_VERSION },
      });
    });
  }
}
