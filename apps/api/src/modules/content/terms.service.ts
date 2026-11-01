import { Injectable } from '@nestjs/common';
import {
  publicTermPath,
  slugify,
  type createTermSchema,
  type TermInfo,
  type TermListResponse,
  type updateTermSchema,
} from '@nexora/shared';
import type { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { RedirectsService } from '../redirects/redirects.service.js';
import type { AuthContext } from '../security/auth-context.js';

const termInclude = { _count: { select: { entries: true } } } satisfies Prisma.TermInclude;
type TermRow = Prisma.TermGetPayload<{ include: typeof termInclude }>;

function toTerm(row: TermRow): TermInfo {
  return {
    id: row.id,
    taxonomyId: row.taxonomyId,
    parentId: row.parentId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    entryCount: row._count.entries,
  };
}

function invalid(path: string, message: string): ApiException {
  return new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
    { path, message },
  ]);
}

/** Terms (categories, tags...) of a taxonomy, per site. */
@Injectable()
export class TermsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redirects: RedirectsService,
  ) {}

  async list(
    siteId: string,
    taxonomyId: string,
    query: { search?: string | undefined; page: number; pageSize: number },
  ): Promise<TermListResponse> {
    await this.requireTaxonomy(taxonomyId);
    const where: Prisma.TermWhereInput = {
      siteId,
      taxonomyId,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.term.count({ where }),
      this.prisma.term.findMany({
        where,
        include: termInclude,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toTerm), page: query.page, pageSize: query.pageSize, total };
  }

  async create(
    actor: AuthContext,
    taxonomyId: string,
    input: z.output<typeof createTermSchema>,
  ): Promise<TermInfo> {
    const taxonomy = await this.requireTaxonomy(taxonomyId);
    if (input.parentId !== null) {
      await this.assertParent(actor.siteId, taxonomy, input.parentId, null);
    }
    const slug = input.slug ?? (await this.uniqueSlug(actor.siteId, taxonomyId, input.name));
    await this.assertSlugFree(actor.siteId, taxonomyId, slug, null);
    const created = await this.prisma.term.create({
      data: {
        siteId: actor.siteId,
        taxonomyId,
        parentId: input.parentId,
        name: input.name,
        slug,
        description: input.description,
      },
      include: termInclude,
    });
    return toTerm(created);
  }

  async update(
    actor: AuthContext,
    id: string,
    input: z.output<typeof updateTermSchema>,
  ): Promise<TermInfo> {
    const term = await this.requireTerm(actor.siteId, id);
    const taxonomy = await this.requireTaxonomy(term.taxonomyId);
    if (input.parentId !== undefined && input.parentId !== null) {
      await this.assertParent(actor.siteId, taxonomy, input.parentId, id);
    }
    if (input.slug !== undefined) {
      await this.assertSlugFree(actor.siteId, term.taxonomyId, input.slug, id);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      // The archive keeps working at its old address.
      if (input.slug !== undefined && input.slug !== term.slug && taxonomy.isPublic) {
        await this.redirects.recordMoves(tx, actor.siteId, [
          {
            from: publicTermPath(taxonomy.routePrefix, term.slug),
            to: publicTermPath(taxonomy.routePrefix, input.slug),
          },
        ]);
      }
      return tx.term.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
        include: termInclude,
      });
    });
    return toTerm(updated);
  }

  /** Deletes a term; its children move up to its parent and entries simply lose the term. */
  async delete(actor: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const term = await this.requireTerm(actor.siteId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.term.updateMany({ where: { parentId: id }, data: { parentId: term.parentId } });
      await tx.term.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'term.deleted',
        actorUserId: actor.userId,
        targetType: 'term',
        targetId: id,
        request: meta,
        metadata: { name: term.name, taxonomyId: term.taxonomyId },
      });
    });
  }

  private async requireTaxonomy(
    id: string,
  ): Promise<{ id: string; hierarchical: boolean; routePrefix: string; isPublic: boolean }> {
    const taxonomy = await this.prisma.taxonomy.findUnique({
      where: { id },
      select: { id: true, hierarchical: true, routePrefix: true, isPublic: true },
    });
    if (!taxonomy) {
      throw new ApiException(404, 'NOT_FOUND', 'Taxonomy not found.');
    }
    return taxonomy;
  }

  private async requireTerm(siteId: string, id: string) {
    const term = await this.prisma.term.findFirst({ where: { id, siteId } });
    if (!term) {
      throw new ApiException(404, 'NOT_FOUND', 'Term not found.');
    }
    return term;
  }

  /** The parent must be a term of the same hierarchical taxonomy and not the term itself or a descendant. */
  private async assertParent(
    siteId: string,
    taxonomy: { id: string; hierarchical: boolean },
    parentId: string,
    termId: string | null,
  ): Promise<void> {
    if (!taxonomy.hierarchical) {
      throw invalid('parentId', 'Terms of this taxonomy cannot have a parent.');
    }
    let cursor: string | null = parentId;
    for (let depth = 0; cursor !== null; depth += 1) {
      if (cursor === termId || depth > 100) {
        throw invalid('parentId', 'A term cannot be its own ancestor.');
      }
      const parent: { taxonomyId: string; parentId: string | null } | null =
        await this.prisma.term.findFirst({
          where: { id: cursor, siteId },
          select: { taxonomyId: true, parentId: true },
        });
      if (parent?.taxonomyId !== taxonomy.id) {
        throw invalid('parentId', 'The parent must be a term of the same taxonomy.');
      }
      cursor = parent.parentId;
    }
  }

  private async assertSlugFree(
    siteId: string,
    taxonomyId: string,
    slug: string,
    exceptId: string | null,
  ): Promise<void> {
    const clash = await this.prisma.term.findFirst({
      where: { siteId, taxonomyId, slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw invalid('slug', 'Another term already uses this slug.');
    }
  }

  private async uniqueSlug(siteId: string, taxonomyId: string, name: string): Promise<string> {
    const base = slugify(name) || 'term';
    const taken = new Set(
      (
        await this.prisma.term.findMany({
          where: { siteId, taxonomyId, slug: { startsWith: base } },
          select: { slug: true },
        })
      ).map((term) => term.slug),
    );
    if (!taken.has(base)) return base;
    for (let n = 2; ; n += 1) {
      const candidate = `${base.slice(0, 190)}-${String(n)}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
}
