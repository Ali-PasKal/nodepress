import { Injectable } from '@nestjs/common';
import type { LoginRequest, SessionResponse } from '@nexora/shared';
import { ApiException } from '../../common/errors/api-exception.js';
import { RateLimitedException } from '../../common/errors/rate-limited.exception.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../security/auth-context.js';
import { sha256 } from '../security/crypto.js';
import { PasswordHasher } from '../security/password-hasher.service.js';
import { RATE_LIMITS, RateLimiter } from '../security/rate-limiter.service.js';
import { SessionService } from '../security/session.service.js';
import { SiteService } from '../sites/site.service.js';
import { SessionResponseBuilder } from './session-response.service.js';

const INVALID_CREDENTIALS = 'Invalid email or password.';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly sites: SiteService,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly sessionResponse: SessionResponseBuilder,
  ) {}

  /**
   * Password login. Unknown accounts, wrong passwords and suspended accounts all produce the same
   * response and comparable timing. A new session is always created and any session presented with
   * the request is revoked (prevents session fixation).
   */
  async login(
    input: LoginRequest,
    meta: RequestMeta,
    presentedToken: string | null,
  ): Promise<{ token: string; expiresAt: Date; response: SessionResponse }> {
    const ipState = await this.limiter.hit(
      'login-ip',
      meta.ipAddress ?? 'unknown',
      RATE_LIMITS.loginPerIp,
    );
    if (!ipState.allowed) {
      throw new RateLimitedException(ipState.retryAfterSeconds);
    }
    const accountState = await this.limiter.peek(
      'login-account',
      input.email,
      RATE_LIMITS.loginFailuresPerAccount,
    );
    if (!accountState.allowed) {
      throw new RateLimitedException(accountState.retryAfterSeconds);
    }

    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, status: true, credential: { select: { passwordHash: true } } },
    });
    const passwordHash = user?.credential?.passwordHash ?? null;
    let passwordValid = false;
    if (passwordHash) {
      passwordValid = await this.hasher.verify(passwordHash, input.password);
    } else {
      await this.hasher.verifyAgainstDummy(input.password);
    }

    if (!user || !passwordHash || !passwordValid || user.status !== 'active') {
      await this.limiter.hit('login-account', input.email, RATE_LIMITS.loginFailuresPerAccount);
      const reason = !user
        ? 'unknown_account'
        : !passwordValid
          ? 'invalid_password'
          : 'account_suspended';
      await this.audit.record(this.prisma, {
        action: 'auth.login_failed',
        ...(user ? { targetType: 'user', targetId: user.id } : {}),
        request: meta,
        metadata: { reason },
      });
      throw new ApiException(401, 'UNAUTHENTICATED', INVALID_CREDENTIALS);
    }

    const site = await this.sites.requireDefault();
    if (this.hasher.needsRehash(passwordHash)) {
      const upgraded = await this.hasher.hash(input.password);
      await this.prisma.userCredential.update({
        where: { userId: user.id },
        data: { passwordHash: upgraded },
      });
    }

    const { token, session } = await this.prisma.$transaction(async (tx) => {
      if (presentedToken) {
        await tx.session.updateMany({
          where: { tokenHash: sha256(presentedToken), revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'login_rotation' },
        });
      }
      const created = await this.sessions.create(tx, user.id, meta);
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await this.audit.record(tx, {
        action: 'auth.login_succeeded',
        actorUserId: user.id,
        targetType: 'session',
        targetId: created.session.id,
        request: meta,
      });
      return created;
    });
    await this.limiter.reset('login-account', input.email, RATE_LIMITS.loginFailuresPerAccount);

    return {
      token,
      expiresAt: session.expiresAt,
      response: await this.sessionResponse.build(user.id, site.id, token, session.expiresAt),
    };
  }

  async logout(auth: AuthContext, meta: RequestMeta): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.sessions.revoke(tx, auth.sessionId, 'logout');
      await this.audit.record(tx, {
        action: 'auth.logout',
        actorUserId: auth.userId,
        targetType: 'session',
        targetId: auth.sessionId,
        request: meta,
      });
    });
  }

  currentSession(auth: AuthContext | undefined): Promise<SessionResponse> | SessionResponse {
    if (!auth) {
      return { authenticated: false };
    }
    return this.sessionResponse.build(
      auth.userId,
      auth.siteId,
      auth.sessionToken,
      auth.sessionExpiresAt,
    );
  }
}
