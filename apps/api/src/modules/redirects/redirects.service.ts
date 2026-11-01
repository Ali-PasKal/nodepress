import { Injectable } from '@nestjs/common';
import type {
  createRedirectSchema,
  RedirectInfo,
  RedirectListResponse,
  redirectListQuerySchema,
  updateRedirectSchema,
} from '@nexora/shared';
import type { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../security/auth-context.js';

/** A public URL that moved (decoded site paths, e.g. "/blog/old" → "/blog/new"). */
export interface PathMove {
  readonly from: string;
  readonly to: string;
}

/** Upper bound for redirects created by one change (e.g. a route prefix change on a large site). */
export const MAX_PATH_MOVES = 10_000;
const MAX_CHAIN = 10;

type RedirectRow = Prisma.RedirectGetPayload<object>;

function toRedirect(row: RedirectRow): RedirectInfo {
  return {
    id: row.id,
    fromPath: row.fromPath,
    toPath: row.toPath,
    statusCode: row.statusCode as RedirectInfo['statusCode'],
    source: row.source as RedirectInfo['source'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function invalid(path: string, message: string): ApiException {
  return new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
    { path, message },
  ]);
}

/** Manual redirects (managed by SEO managers) and automatic ones recorded when public URLs move. */
@Injectable()
export class RedirectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records permanent redirects for moved public URLs, inside the caller's transaction:
   * redirects from the new locations are removed (live content is there now), chains are flattened so
   * every redirect that pointed to an old location points to the new one, and old → new is stored.
   */
  async recordMoves(db: DbClient, siteId: string, moves: readonly PathMove[]): Promise<number> {
    const unique = new Map<string, string>();
    for (const move of moves) {
      if (move.from !== move.to) unique.set(move.from, move.to);
    }
    if (unique.size === 0) return 0;
    if (unique.size > MAX_PATH_MOVES) {
      throw new ApiException(
        409,
        'CONFLICT',
        `This change would move more than ${String(MAX_PATH_MOVES)} public addresses at once.`,
      );
    }
    const froms = [...unique.keys()];
    const tos = [...unique.values()];
    await db.$executeRaw`
      DELETE FROM redirects WHERE site_id = ${siteId}::uuid AND from_path = ANY(${tos}::text[])`;
    await db.$executeRaw`
      UPDATE redirects AS r SET to_path = m.to_path, updated_at = now()
        FROM unnest(${froms}::text[], ${tos}::text[]) AS m(from_path, to_path)
       WHERE r.site_id = ${siteId}::uuid AND r.to_path = m.from_path`;
    await db.$executeRaw`
      DELETE FROM redirects WHERE site_id = ${siteId}::uuid AND from_path = ANY(${froms}::text[])`;
    for (let start = 0; start < froms.length; start += 1_000) {
      await db.redirect.createMany({
        data: froms.slice(start, start + 1_000).map((from) => ({
          siteId,
          fromPath: from,
          toPath: unique.get(from) ?? from,
          statusCode: 301,
          source: 'auto',
        })),
      });
    }
    return unique.size;
  }

  async list(
    siteId: string,
    query: z.output<typeof redirectListQuerySchema>,
  ): Promise<RedirectListResponse> {
    const where: Prisma.RedirectWhereInput = {
      siteId,
      ...(query.source ? { source: query.source } : {}),
      ...(query.search
        ? {
            OR: [
              { fromPath: { contains: query.search, mode: 'insensitive' } },
              { toPath: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.redirect.count({ where }),
      this.prisma.redirect.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toRedirect), page: query.page, pageSize: query.pageSize, total };
  }

  async create(
    actor: AuthContext,
    input: z.output<typeof createRedirectSchema>,
    meta: RequestMeta,
  ): Promise<RedirectInfo> {
    await this.assertNoLoop(actor.siteId, input.fromPath, input.toPath, null);
    const row = await this.withUniqueSource(async () =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.redirect.create({
          data: {
            siteId: actor.siteId,
            fromPath: input.fromPath,
            toPath: input.toPath,
            statusCode: input.statusCode,
            source: 'manual',
          },
        });
        await this.audit.record(tx, {
          action: 'redirect.created',
          actorUserId: actor.userId,
          targetType: 'redirect',
          targetId: created.id,
          request: meta,
          metadata: { fromPath: created.fromPath, toPath: created.toPath },
        });
        return created;
      }),
    );
    return toRedirect(row);
  }

  async update(
    actor: AuthContext,
    id: string,
    input: z.output<typeof updateRedirectSchema>,
    meta: RequestMeta,
  ): Promise<RedirectInfo> {
    const existing = await this.require(actor.siteId, id);
    const fromPath = input.fromPath ?? existing.fromPath;
    const toPath = input.toPath ?? existing.toPath;
    if (fromPath === toPath) {
      throw invalid('toPath', 'A redirect cannot point to itself.');
    }
    await this.assertNoLoop(actor.siteId, fromPath, toPath, id);
    const row = await this.withUniqueSource(async () =>
      this.prisma.$transaction(async (tx) => {
        const updated = await tx.redirect.update({
          where: { id },
          // An edited automatic redirect becomes a manual one.
          data: {
            fromPath,
            toPath,
            ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
            source: 'manual',
          },
        });
        await this.audit.record(tx, {
          action: 'redirect.updated',
          actorUserId: actor.userId,
          targetType: 'redirect',
          targetId: id,
          request: meta,
          metadata: { fromPath, toPath },
        });
        return updated;
      }),
    );
    return toRedirect(row);
  }

  async delete(actor: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const existing = await this.require(actor.siteId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.redirect.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'redirect.deleted',
        actorUserId: actor.userId,
        targetType: 'redirect',
        targetId: id,
        request: meta,
        metadata: { fromPath: existing.fromPath, toPath: existing.toPath },
      });
    });
  }

  private async require(siteId: string, id: string): Promise<RedirectRow> {
    const row = await this.prisma.redirect.findFirst({ where: { id, siteId } });
    if (!row) {
      throw new ApiException(404, 'NOT_FOUND', 'Redirect not found.');
    }
    return row;
  }

  /** Follows existing redirects from the target; refuses when the chain leads back to the source. */
  private async assertNoLoop(
    siteId: string,
    fromPath: string,
    toPath: string,
    exceptId: string | null,
  ): Promise<void> {
    let cursor = toPath.split(/[?#]/)[0] ?? toPath;
    for (let hop = 0; hop < MAX_CHAIN && cursor.startsWith('/'); hop += 1) {
      if (cursor === fromPath) {
        throw invalid('toPath', 'This redirect would create a loop.');
      }
      const next = await this.prisma.redirect.findFirst({
        where: { siteId, fromPath: cursor, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
        select: { toPath: true },
      });
      if (!next) return;
      cursor = next.toPath.split(/[?#]/)[0] ?? next.toPath;
    }
    if (cursor === fromPath) {
      throw invalid('toPath', 'This redirect would create a loop.');
    }
  }

  private async withUniqueSource<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw invalid('fromPath', 'A redirect from this path already exists.');
      }
      throw error;
    }
  }
}
