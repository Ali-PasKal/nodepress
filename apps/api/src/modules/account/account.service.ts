import { Injectable } from '@nestjs/common';
import type { AuthUser, SessionResponse, SessionSummary } from '@nexora/shared';
import { ApiException } from '../../common/errors/api-exception.js';
import { RateLimitedException } from '../../common/errors/rate-limited.exception.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionResponseBuilder } from '../auth/session-response.service.js';
import type { AuthContext } from '../security/auth-context.js';
import { PasswordHasher } from '../security/password-hasher.service.js';
import { RATE_LIMITS, RateLimiter } from '../security/rate-limiter.service.js';
import { SessionService } from '../security/session.service.js';

/** Self-service operations on the signed-in user's own account. */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly sessionResponse: SessionResponseBuilder,
  ) {}

  async profile(auth: AuthContext): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { id: true, email: true, displayName: true },
    });
    return {
      ...user,
      role: auth.role ? { id: auth.role.id, key: auth.role.key, name: auth.role.name } : null,
    };
  }

  async updateProfile(
    auth: AuthContext,
    displayName: string,
    meta: RequestMeta,
  ): Promise<AuthUser> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: auth.userId }, data: { displayName } });
      await this.audit.record(tx, {
        action: 'account.profile_updated',
        actorUserId: auth.userId,
        targetType: 'user',
        targetId: auth.userId,
        request: meta,
      });
    });
    return this.profile(auth);
  }

  /**
   * Changes the password after re-verifying the current one, signs out every session (including this
   * one) and issues a fresh session for the caller.
   */
  async changePassword(
    auth: AuthContext,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<{ token: string; expiresAt: Date; response: SessionResponse }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { email: true, credential: { select: { passwordHash: true } } },
    });
    const limit = await this.limiter.peek(
      'login-account',
      user.email,
      RATE_LIMITS.loginFailuresPerAccount,
    );
    if (!limit.allowed) {
      throw new RateLimitedException(limit.retryAfterSeconds);
    }
    const valid = user.credential
      ? await this.hasher.verify(user.credential.passwordHash, currentPassword)
      : false;
    if (!valid) {
      await this.limiter.hit('login-account', user.email, RATE_LIMITS.loginFailuresPerAccount);
      throw new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
        { path: 'currentPassword', message: 'Current password is incorrect.' },
      ]);
    }
    if (currentPassword === newPassword) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
        { path: 'newPassword', message: 'Choose a password different from the current one.' },
      ]);
    }

    const passwordHash = await this.hasher.hash(newPassword);
    const { token, session } = await this.prisma.$transaction(async (tx) => {
      await tx.userCredential.update({ where: { userId: auth.userId }, data: { passwordHash } });
      await tx.user.update({ where: { id: auth.userId }, data: { passwordChangedAt: new Date() } });
      await this.sessions.revokeAllForUser(tx, auth.userId, 'password_changed');
      const created = await this.sessions.create(tx, auth.userId, meta);
      await this.audit.record(tx, {
        action: 'account.password_changed',
        actorUserId: auth.userId,
        targetType: 'user',
        targetId: auth.userId,
        request: meta,
      });
      return created;
    });
    return {
      token,
      expiresAt: session.expiresAt,
      response: await this.sessionResponse.build(
        auth.userId,
        auth.siteId,
        token,
        session.expiresAt,
      ),
    };
  }

  async listSessions(auth: AuthContext): Promise<SessionSummary[]> {
    const sessions = await this.sessions.listActive(auth.userId);
    return sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      current: session.id === auth.sessionId,
    }));
  }

  async revokeSession(auth: AuthContext, sessionId: string, meta: RequestMeta): Promise<void> {
    const owned = await this.prisma.session.findFirst({
      where: { id: sessionId, userId: auth.userId, revokedAt: null },
      select: { id: true },
    });
    if (!owned) {
      throw new ApiException(404, 'NOT_FOUND', 'Session not found.');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.sessions.revoke(tx, sessionId, 'revoked_by_user');
      await this.audit.record(tx, {
        action: 'session.revoked',
        actorUserId: auth.userId,
        targetType: 'session',
        targetId: sessionId,
        request: meta,
      });
    });
  }

  async revokeOtherSessions(auth: AuthContext, meta: RequestMeta): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const count = await this.sessions.revokeAllForUser(
        tx,
        auth.userId,
        'revoked_by_user',
        auth.sessionId,
      );
      await this.audit.record(tx, {
        action: 'session.revoked_others',
        actorUserId: auth.userId,
        targetType: 'user',
        targetId: auth.userId,
        request: meta,
        metadata: { count },
      });
      return count;
    });
  }
}
