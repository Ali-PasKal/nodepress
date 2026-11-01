import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception.js';
import { RateLimitedException } from '../../common/errors/rate-limited.exception.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { defineJob, PermanentJobError } from '../jobs/job-definition.js';
import { JobQueue } from '../jobs/job-queue.service.js';
import { JobRegistry } from '../jobs/job-registry.service.js';
import { Mailer } from '../mail/mailer.service.js';
import { generateToken, sha256 } from '../security/crypto.js';
import { PasswordHasher } from '../security/password-hasher.service.js';
import { RATE_LIMITS, RateLimiter } from '../security/rate-limiter.service.js';
import { SessionService } from '../security/session.service.js';
import { SiteService } from '../sites/site.service.js';

export const PASSWORD_RESET_TTL_MS = 30 * 60_000;
const INVALID_LINK = 'This password reset link is invalid or has expired. Request a new one.';

/**
 * Issues the reset token and sends the email. The token is created by the job, not the request, so it
 * exists in plain text only in memory and in the email: job payloads (stored in the database) never hold it.
 */
export const PasswordResetEmailJob = defineJob(
  'auth.password_reset_email',
  z.object({ userId: z.uuid() }),
);

/**
 * Self-service password reset with single-use, hashed, short-lived tokens. The request endpoint
 * responds identically whether or not the account exists; the email is produced by a background job so
 * response timing does not reveal it either, and a crash cannot lose it.
 */
@Injectable()
export class PasswordResetService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly sites: SiteService,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    private readonly registry: JobRegistry,
    private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.registry.register(PasswordResetEmailJob, ({ userId }) => this.sendResetEmail(userId), {
      maxAttempts: 6,
    });
  }

  async request(email: string, meta: RequestMeta): Promise<void> {
    const ipState = await this.limiter.hit(
      'reset-ip',
      meta.ipAddress ?? 'unknown',
      RATE_LIMITS.passwordResetPerIp,
    );
    if (!ipState.allowed) {
      throw new RateLimitedException(ipState.retryAfterSeconds);
    }
    // Per-account limiting is silent: telling the caller would reveal that the account exists.
    const accountState = await this.limiter.hit(
      'reset-account',
      email,
      RATE_LIMITS.passwordResetPerAccount,
    );
    if (!accountState.allowed) {
      return;
    }

    const [user, site] = await Promise.all([
      this.prisma.user.findUnique({ where: { email }, select: { id: true, status: true } }),
      this.sites.findDefault(),
    ]);
    if (user?.status !== 'active' || !site) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await this.audit.record(tx, {
        action: 'auth.password_reset_requested',
        targetType: 'user',
        targetId: user.id,
        request: meta,
      });
      await this.queue.enqueue(tx, PasswordResetEmailJob, { userId: user.id });
    });
  }

  /** Job handler. Each attempt issues a fresh token (older links stop working). */
  private async sendResetEmail(userId: string): Promise<void> {
    const [user, site] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, status: true } }),
      this.sites.findDefault(),
    ]);
    if (!site) {
      throw new PermanentJobError('The site is not installed');
    }
    if (user?.status !== 'active') {
      // Suspended or removed since the request: nothing to send.
      return;
    }
    const token = generateToken(32);
    await this.prisma.$transaction(async (tx) => {
      // Only the newest link works.
      await tx.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: {
          userId,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      });
    });
    const link = `${site.baseUrl}/admin/reset-password?token=${encodeURIComponent(token)}`;
    await this.mailer.send({
      to: user.email,
      subject: `Reset your ${site.name} password`,
      text: [
        `Someone (hopefully you) asked to reset the password for ${user.email} on ${site.name}.`,
        '',
        `Choose a new password: ${link}`,
        '',
        'This link expires in 30 minutes and can be used once. If you did not ask for it, ignore this email;',
        'your password will not change.',
      ].join('\n'),
    });
  }

  async confirm(token: string, password: string, meta: RequestMeta): Promise<void> {
    const ipState = await this.limiter.hit(
      'reset-confirm-ip',
      meta.ipAddress ?? 'unknown',
      RATE_LIMITS.passwordResetConfirmPerIp,
    );
    if (!ipState.allowed) {
      throw new RateLimitedException(ipState.retryAfterSeconds);
    }
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
      select: {
        id: true,
        userId: true,
        usedAt: true,
        expiresAt: true,
        user: { select: { status: true } },
      },
    });
    if (
      record?.usedAt !== null ||
      record.expiresAt.getTime() <= Date.now() ||
      record.user.status !== 'active'
    ) {
      throw new ApiException(400, 'BAD_REQUEST', INVALID_LINK);
    }

    const passwordHash = await this.hasher.hash(password);
    await this.prisma.$transaction(async (tx) => {
      // Claim the token atomically so two concurrent requests cannot both use it.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new ApiException(400, 'BAD_REQUEST', INVALID_LINK);
      }
      await tx.userCredential.upsert({
        where: { userId: record.userId },
        create: { userId: record.userId, passwordHash },
        update: { passwordHash },
      });
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordChangedAt: new Date() },
      });
      await this.sessions.revokeAllForUser(tx, record.userId, 'password_reset');
      await this.audit.record(tx, {
        action: 'auth.password_reset_completed',
        actorUserId: record.userId,
        targetType: 'user',
        targetId: record.userId,
        request: meta,
      });
    });
  }
}
