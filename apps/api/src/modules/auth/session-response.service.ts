import { Injectable } from '@nestjs/common';
import type { SessionResponse } from '@nexora/shared';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuthorizationService } from '../security/authorization.service.js';
import { deriveCsrfToken } from '../security/crypto.js';

/** Builds the `GET /auth/session` payload: who is signed in, what they may do, and their CSRF token. */
@Injectable()
export class SessionResponseBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async build(
    userId: string,
    siteId: string,
    sessionToken: string,
    expiresAt: Date,
  ): Promise<SessionResponse> {
    const [user, access] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, email: true, displayName: true },
      }),
      this.authorization.effectiveAccess(userId, siteId),
    ]);
    return {
      authenticated: true,
      user: {
        ...user,
        role: access.role
          ? { id: access.role.id, key: access.role.key, name: access.role.name }
          : null,
      },
      capabilities: [...access.capabilities].sort(),
      csrfToken: deriveCsrfToken(sessionToken),
      expiresAt: expiresAt.toISOString(),
    };
  }
}
