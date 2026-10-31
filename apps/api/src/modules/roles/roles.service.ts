import { Injectable } from '@nestjs/common';
import type { RoleInfo, RoleListResponse } from '@nexora/shared';
import type { createRoleSchema, updateRoleSchema } from '@nexora/shared';
import type { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../security/auth-context.js';
import { AuthorizationService } from '../security/authorization.service.js';

const CANNOT_GRANT = 'You cannot grant capabilities you do not hold.';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<RoleListResponse> {
    const [roles, capabilities, allKeys] = await Promise.all([
      this.prisma.role.findMany({
        orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
        include: {
          capabilities: { select: { capabilityKey: true } },
          _count: { select: { assignments: true } },
        },
      }),
      this.prisma.capability.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] }),
      this.authorization.allCapabilityKeys(),
    ]);
    return {
      roles: roles.map((role): RoleInfo => ({
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        grantsAll: role.grantsAll,
        capabilities: role.grantsAll
          ? [...allKeys]
          : role.capabilities.map((grant) => grant.capabilityKey).sort(),
        userCount: role._count.assignments,
      })),
      capabilities,
    };
  }

  async create(
    actor: AuthContext,
    input: z.output<typeof createRoleSchema>,
    meta: RequestMeta,
  ): Promise<RoleInfo> {
    await this.assertKnownCapabilities(input.capabilities);
    this.authorization.assertSubset(input.capabilities, actor.capabilities, CANNOT_GRANT);
    if (await this.prisma.role.findUnique({ where: { key: input.key }, select: { id: true } })) {
      throw new ApiException(409, 'CONFLICT', 'A role with this key already exists.');
    }
    const id = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          key: input.key,
          name: input.name,
          description: input.description,
          capabilities: { create: input.capabilities.map((capabilityKey) => ({ capabilityKey })) },
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        action: 'role.created',
        actorUserId: actor.userId,
        targetType: 'role',
        targetId: role.id,
        request: meta,
        metadata: { key: input.key, capabilities: input.capabilities },
      });
      return role.id;
    });
    return this.get(id);
  }

  async update(
    actor: AuthContext,
    roleId: string,
    input: z.output<typeof updateRoleSchema>,
    meta: RequestMeta,
  ): Promise<RoleInfo> {
    const role = await this.loadEditable(actor, roleId);
    if (role.isSystem && input.name !== undefined && input.name !== role.name) {
      throw new ApiException(403, 'FORBIDDEN', 'Built-in roles cannot be renamed.');
    }
    const current = role.capabilities.map((grant) => grant.capabilityKey);
    let added: string[] = [];
    let removed: string[] = [];
    if (input.capabilities) {
      await this.assertKnownCapabilities(input.capabilities);
      this.authorization.assertSubset(input.capabilities, actor.capabilities, CANNOT_GRANT);
      added = input.capabilities.filter((key) => !current.includes(key));
      removed = current.filter((key) => !input.capabilities?.includes(key));
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id: roleId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });
      if (input.capabilities) {
        await tx.roleCapability.deleteMany({ where: { roleId } });
        await tx.roleCapability.createMany({
          data: input.capabilities.map((capabilityKey) => ({ roleId, capabilityKey })),
        });
      }
      await this.audit.record(tx, {
        action: 'role.updated',
        actorUserId: actor.userId,
        targetType: 'role',
        targetId: roleId,
        request: meta,
        metadata: { key: role.key, added, removed },
      });
    });
    return this.get(roleId);
  }

  async delete(actor: AuthContext, roleId: string, meta: RequestMeta): Promise<void> {
    const role = await this.loadEditable(actor, roleId);
    if (role.isSystem) {
      throw new ApiException(403, 'FORBIDDEN', 'Built-in roles cannot be deleted.');
    }
    const assigned = await this.prisma.roleAssignment.count({ where: { roleId } });
    if (assigned > 0) {
      throw new ApiException(
        409,
        'CONFLICT',
        'Reassign the users who have this role before deleting it.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id: roleId } });
      await this.audit.record(tx, {
        action: 'role.deleted',
        actorUserId: actor.userId,
        targetType: 'role',
        targetId: roleId,
        request: meta,
        metadata: { key: role.key },
      });
    });
  }

  private async get(roleId: string): Promise<RoleInfo> {
    const { roles } = await this.list();
    const role = roles.find((candidate) => candidate.id === roleId);
    if (!role) {
      throw new ApiException(404, 'NOT_FOUND', 'Role not found.');
    }
    return role;
  }

  /** The role exists, is not the all-powerful role, is not the actor's own, and is not more privileged. */
  private async loadEditable(actor: AuthContext, roleId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { capabilities: { select: { capabilityKey: true } } },
    });
    if (!role) {
      throw new ApiException(404, 'NOT_FOUND', 'Role not found.');
    }
    if (role.grantsAll) {
      throw new ApiException(403, 'FORBIDDEN', 'The Super Administrator role cannot be modified.');
    }
    if (actor.role?.id === roleId) {
      throw new ApiException(
        403,
        'FORBIDDEN',
        'You cannot modify your own role. Ask another administrator.',
      );
    }
    this.authorization.assertSubset(
      role.capabilities.map((grant) => grant.capabilityKey),
      actor.capabilities,
      'You cannot modify a role with capabilities you do not hold.',
    );
    return role;
  }

  private async assertKnownCapabilities(keys: readonly string[]): Promise<void> {
    const known = new Set(await this.authorization.allCapabilityKeys());
    const unknown = keys.filter((key) => !known.has(key));
    if (unknown.length > 0) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
        { path: 'capabilities', message: `Unknown capabilities: ${unknown.join(', ')}` },
      ]);
    }
  }
}
