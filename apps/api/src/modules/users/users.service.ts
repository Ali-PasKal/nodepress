import { Injectable } from '@nestjs/common';
import type {
  CreateUserRequest,
  SessionSummary,
  UserListResponse,
  UserSummary,
} from '@nexora/shared';
import type { userListQuerySchema, updateUserSchema } from '@nexora/shared';
import type { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../security/auth-context.js';
import { AuthorizationService } from '../security/authorization.service.js';
import { PasswordHasher } from '../security/password-hasher.service.js';
import { SessionService } from '../security/session.service.js';

const MORE_PRIVILEGED = 'You cannot manage a user who has capabilities you do not hold.';
const CANNOT_GRANT = 'You cannot assign a role with capabilities you do not hold.';

function userSelect(siteId: string) {
  return {
    id: true,
    email: true,
    displayName: true,
    status: true,
    lastLoginAt: true,
    createdAt: true,
    roleAssignments: {
      where: { siteId },
      select: { role: { select: { id: true, key: true, name: true } } },
    },
  } satisfies Prisma.UserSelect;
}

type UserRow = Prisma.UserGetPayload<{ select: ReturnType<typeof userSelect> }>;

function toSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    role: row.roleAssignments[0]?.role ?? null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * User administration. Escalation rules (enforced here, for every path):
 * - an actor can only manage users whose capabilities are a subset of the actor's own;
 * - roles can only be assigned if their capabilities are a subset of the actor's own;
 * - nobody changes their own role or status through this API;
 * - the last active super administrator cannot be demoted or suspended.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async list(
    siteId: string,
    query: z.output<typeof userListQuerySchema>,
  ): Promise<UserListResponse> {
    const where: Prisma.UserWhereInput = {
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { displayName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.roleId ? { roleAssignments: { some: { siteId, roleId: query.roleId } } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: userSelect(siteId),
      }),
    ]);
    return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total };
  }

  async get(siteId: string, userId: string): Promise<UserSummary> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userSelect(siteId),
    });
    if (!row) {
      throw new ApiException(404, 'NOT_FOUND', 'User not found.');
    }
    return toSummary(row);
  }

  async create(
    actor: AuthContext,
    input: CreateUserRequest,
    meta: RequestMeta,
  ): Promise<UserSummary> {
    const role = await this.loadRole(input.roleId);
    this.authorization.assertSubset(
      await this.authorization.roleCapabilities(role),
      actor.capabilities,
      CANNOT_GRANT,
    );
    if (
      await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })
    ) {
      throw new ApiException(409, 'CONFLICT', 'A user with this email address already exists.');
    }
    const passwordHash = await this.hasher.hash(input.password);
    const id = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          displayName: input.displayName,
          passwordChangedAt: new Date(),
          credential: { create: { passwordHash } },
          roleAssignments: { create: { siteId: actor.siteId, roleId: role.id } },
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        action: 'user.created',
        actorUserId: actor.userId,
        targetType: 'user',
        targetId: user.id,
        request: meta,
        metadata: { role: role.key },
      });
      return user.id;
    });
    return this.get(actor.siteId, id);
  }

  async update(
    actor: AuthContext,
    userId: string,
    input: z.output<typeof updateUserSchema>,
    meta: RequestMeta,
  ): Promise<UserSummary> {
    const target = await this.loadTarget(actor, userId);
    const isSelf = userId === actor.userId;
    const changesAccess = input.status !== undefined || input.roleId !== undefined;
    if (isSelf && changesAccess) {
      throw new ApiException(403, 'FORBIDDEN', 'You cannot change your own role or status.');
    }

    let newRole: Awaited<ReturnType<UsersService['loadRole']>> | null = null;
    if (input.roleId !== undefined && input.roleId !== target.role?.id) {
      if (!actor.capabilities.has('users.assign_roles')) {
        throw new ApiException(403, 'FORBIDDEN', 'You do not have permission to change roles.');
      }
      newRole = await this.loadRole(input.roleId);
      this.authorization.assertSubset(
        await this.authorization.roleCapabilities(newRole),
        actor.capabilities,
        CANNOT_GRANT,
      );
    }

    const suspending = input.status === 'suspended' && target.status === 'active';
    const demoting = newRole !== null && !newRole.grantsAll;
    if (target.role?.grantsAll && target.status === 'active' && (suspending || demoting)) {
      await this.assertAnotherActiveSuperAdmin(actor.siteId, userId);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      if (newRole) {
        await tx.roleAssignment.upsert({
          where: { userId_siteId: { userId, siteId: actor.siteId } },
          create: { userId, siteId: actor.siteId, roleId: newRole.id },
          update: { roleId: newRole.id },
        });
        // Privilege change: force re-authentication everywhere.
        await this.sessions.revokeAllForUser(tx, userId, 'role_changed');
      }
      if (suspending) {
        await this.sessions.revokeAllForUser(tx, userId, 'user_suspended');
      }
      await this.audit.record(tx, {
        action: 'user.updated',
        actorUserId: actor.userId,
        targetType: 'user',
        targetId: userId,
        request: meta,
        metadata: {
          fields: Object.keys(input).filter(
            (key) => input[key as keyof typeof input] !== undefined,
          ),
          ...(newRole ? { roleFrom: target.role?.key ?? null, roleTo: newRole.key } : {}),
          ...(input.status !== undefined && input.status !== target.status
            ? { statusFrom: target.status, statusTo: input.status }
            : {}),
        },
      });
    });
    return this.get(actor.siteId, userId);
  }

  async setPassword(
    actor: AuthContext,
    userId: string,
    password: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (userId === actor.userId) {
      throw new ApiException(403, 'FORBIDDEN', 'Change your own password from your profile.');
    }
    await this.loadTarget(actor, userId);
    const passwordHash = await this.hasher.hash(password);
    await this.prisma.$transaction(async (tx) => {
      await tx.userCredential.upsert({
        where: { userId },
        create: { userId, passwordHash },
        update: { passwordHash },
      });
      await tx.user.update({ where: { id: userId }, data: { passwordChangedAt: new Date() } });
      await this.sessions.revokeAllForUser(tx, userId, 'password_changed');
      await this.audit.record(tx, {
        action: 'user.password_set',
        actorUserId: actor.userId,
        targetType: 'user',
        targetId: userId,
        request: meta,
      });
    });
  }

  async listSessions(actor: AuthContext, userId: string): Promise<SessionSummary[]> {
    if (userId !== actor.userId) {
      await this.loadTarget(actor, userId);
    }
    const sessions = await this.sessions.listActive(userId);
    return sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      current: session.id === actor.sessionId,
    }));
  }

  async revokeSessions(actor: AuthContext, userId: string, meta: RequestMeta): Promise<number> {
    if (userId === actor.userId) {
      throw new ApiException(403, 'FORBIDDEN', 'Manage your own sessions from your profile.');
    }
    await this.loadTarget(actor, userId);
    return this.prisma.$transaction(async (tx) => {
      const count = await this.sessions.revokeAllForUser(tx, userId, 'revoked_by_admin');
      await this.audit.record(tx, {
        action: 'user.sessions_revoked',
        actorUserId: actor.userId,
        targetType: 'user',
        targetId: userId,
        request: meta,
        metadata: { count },
      });
      return count;
    });
  }

  /** Loads a target user and enforces the "no managing more privileged users" rule. */
  private async loadTarget(actor: AuthContext, userId: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });
    if (!target) {
      throw new ApiException(404, 'NOT_FOUND', 'User not found.');
    }
    const access = await this.authorization.effectiveAccess(userId, actor.siteId);
    if (userId !== actor.userId) {
      this.authorization.assertSubset(access.capabilities, actor.capabilities, MORE_PRIVILEGED);
    }
    return { ...target, role: access.role };
  }

  private async loadRole(roleId: string, db: DbClient = this.prisma) {
    const role = await db.role.findUnique({
      where: { id: roleId },
      include: { capabilities: { select: { capabilityKey: true } } },
    });
    if (!role) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
        { path: 'roleId', message: 'Role not found.' },
      ]);
    }
    return role;
  }

  private async assertAnotherActiveSuperAdmin(siteId: string, exceptUserId: string): Promise<void> {
    const others = await this.prisma.user.count({
      where: {
        id: { not: exceptUserId },
        status: 'active',
        roleAssignments: { some: { siteId, role: { grantsAll: true } } },
      },
    });
    if (others === 0) {
      throw new ApiException(
        409,
        'CONFLICT',
        'There must be at least one active Super Administrator.',
      );
    }
  }
}
