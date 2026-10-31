import { Injectable } from '@nestjs/common';
import type { AuditEventInfo, AuditListResponse } from '@nexora/shared';
import type { RequestMeta } from '../../common/http/request-meta.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

type MetadataValue = string | number | boolean | null | readonly string[];

export interface AuditEntry {
  readonly action: string;
  readonly actorUserId?: string | null;
  readonly targetType?: string;
  readonly targetId?: string;
  /** Small, secret-free context. Never put passwords, tokens or request bodies here. */
  readonly metadata?: Readonly<Record<string, MetadataValue>>;
  readonly request?: RequestMeta;
}

/**
 * Append-only security audit trail. Callers pass the transaction client of the change being audited,
 * so the event is committed if and only if the change is.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(db: DbClient, entry: AuditEntry): Promise<void> {
    await db.auditEvent.create({
      data: {
        action: entry.action,
        actorUserId: entry.actorUserId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ipAddress: entry.request?.ipAddress ?? null,
        requestId: entry.request?.requestId ?? null,
        metadata: entry.metadata ?? {},
      },
    });
  }

  async list(query: {
    page: number;
    pageSize: number;
    action?: string | undefined;
    actorId?: string | undefined;
  }): Promise<AuditListResponse> {
    const where = {
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.actorId ? { actorUserId: query.actorId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { id: true, email: true, displayName: true } } },
      }),
    ]);
    const items: AuditEventInfo[] = rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      action: row.action,
      actor: row.actor,
      targetType: row.targetType,
      targetId: row.targetId,
      ipAddress: row.ipAddress,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    }));
    return { items, page: query.page, pageSize: query.pageSize, total };
  }
}
