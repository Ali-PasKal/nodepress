import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api-exception.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

export interface RoleSummary {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly grantsAll: boolean;
}

export interface EffectiveAccess {
  readonly role: RoleSummary | null;
  readonly capabilities: ReadonlySet<string>;
}

const CAPABILITY_CACHE_MS = 30_000;

/**
 * Computes effective capabilities and enforces the privilege-escalation rules shared by the users and
 * roles modules. Capabilities are resolved per request, so role changes take effect immediately.
 */
@Injectable()
export class AuthorizationService {
  private allKeys: { at: number; keys: readonly string[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async allCapabilityKeys(db: DbClient = this.prisma): Promise<readonly string[]> {
    if (this.allKeys && Date.now() - this.allKeys.at < CAPABILITY_CACHE_MS) {
      return this.allKeys.keys;
    }
    const rows = await db.capability.findMany({ select: { key: true }, orderBy: { key: 'asc' } });
    this.allKeys = { at: Date.now(), keys: rows.map((row) => row.key) };
    return this.allKeys.keys;
  }

  /** Capabilities granted by a role (all capabilities for `grantsAll` roles). */
  async roleCapabilities(
    role: { grantsAll: boolean; capabilities: readonly { capabilityKey: string }[] },
    db: DbClient = this.prisma,
  ): Promise<ReadonlySet<string>> {
    if (role.grantsAll) {
      return new Set(await this.allCapabilityKeys(db));
    }
    return new Set(role.capabilities.map((grant) => grant.capabilityKey));
  }

  async effectiveAccess(
    userId: string,
    siteId: string,
    db: DbClient = this.prisma,
  ): Promise<EffectiveAccess> {
    const assignment = await db.roleAssignment.findUnique({
      where: { userId_siteId: { userId, siteId } },
      include: { role: { include: { capabilities: { select: { capabilityKey: true } } } } },
    });
    if (!assignment) {
      return { role: null, capabilities: new Set() };
    }
    const { role } = assignment;
    return {
      role: { id: role.id, key: role.key, name: role.name, grantsAll: role.grantsAll },
      capabilities: await this.roleCapabilities(role, db),
    };
  }

  /** Nobody may grant (or edit a role into holding) capabilities they do not hold themselves. */
  assertSubset(requested: Iterable<string>, held: ReadonlySet<string>, message: string): void {
    for (const capability of requested) {
      if (!held.has(capability)) {
        throw new ApiException(403, 'FORBIDDEN', message);
      }
    }
  }
}
