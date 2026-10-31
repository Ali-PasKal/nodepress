import { Inject, Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { generateToken, sha256 } from './crypto.js';

/** last_seen_at is refreshed at most this often, so authenticated reads do not all become writes. */
const TOUCH_INTERVAL_MS = 60_000;

export interface ValidSession {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
}

export interface SessionListItem {
  readonly id: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export type RevocationReason =
  | 'logout'
  | 'login_rotation'
  | 'password_changed'
  | 'password_reset'
  | 'revoked_by_user'
  | 'revoked_by_admin'
  | 'user_suspended'
  | 'role_changed';

/**
 * Server-side sessions. The cookie holds a 256-bit random token; the database holds only its SHA-256,
 * so a database leak does not yield usable sessions. Sessions end at the idle timeout (since last use)
 * or the absolute timeout (since creation), whichever comes first, or when revoked.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(
    db: DbClient,
    userId: string,
    meta: RequestMeta,
  ): Promise<{ token: string; session: ValidSession }> {
    const token = generateToken(32);
    const now = new Date();
    const session = await db.session.create({
      data: {
        userId,
        tokenHash: sha256(token),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + this.config.session.absoluteTimeoutMs),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      select: { id: true, userId: true, expiresAt: true },
    });
    return { token, session };
  }

  /** Returns the session for a cookie token if it is live and belongs to an active user. */
  async authenticate(token: string): Promise<ValidSession | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        lastSeenAt: true,
        revokedAt: true,
        user: { select: { status: true } },
      },
    });
    const now = Date.now();
    if (
      session?.revokedAt !== null ||
      session.expiresAt.getTime() <= now ||
      session.lastSeenAt.getTime() + this.config.session.idleTimeoutMs <= now ||
      session.user.status !== 'active'
    ) {
      return null;
    }
    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now) },
      });
    }
    return { id: session.id, userId: session.userId, expiresAt: session.expiresAt };
  }

  async revoke(db: DbClient, sessionId: string, reason: RevocationReason): Promise<void> {
    await db.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Revokes every live session of a user, optionally keeping one (the caller's current session). */
  async revokeAllForUser(
    db: DbClient,
    userId: string,
    reason: RevocationReason,
    exceptSessionId?: string,
  ): Promise<number> {
    const result = await db.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  async listActive(userId: string): Promise<SessionListItem[]> {
    const now = new Date();
    const sessions = await this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
        lastSeenAt: { gt: new Date(now.getTime() - this.config.session.idleTimeoutMs) },
      },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        ipAddress: true,
        userAgent: true,
      },
    });
    return sessions;
  }
}
