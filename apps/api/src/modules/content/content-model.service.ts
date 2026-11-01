import { Injectable } from '@nestjs/common';
import {
  defaultRoutePrefix,
  fieldDefinitionsSchema,
  publicArchivePath,
  publicEntryPath,
  publicTermPath,
  type ContentModelResponse,
  type ContentTypeInfo,
  type createContentTypeSchema,
  type createTaxonomySchema,
  type FieldDefinition,
  type TaxonomyInfo,
  type updateContentTypeSchema,
  type updateTaxonomySchema,
} from '@nexora/shared';
import type { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { RedirectsService, type PathMove } from '../redirects/redirects.service.js';
import type { AuthContext } from '../security/auth-context.js';

const contentTypeInclude = {
  taxonomies: { select: { taxonomyId: true } },
  _count: { select: { entries: true } },
} satisfies Prisma.ContentTypeInclude;
type ContentTypeRow = Prisma.ContentTypeGetPayload<{ include: typeof contentTypeInclude }>;

const taxonomyInclude = {
  contentTypes: { select: { contentTypeId: true } },
  _count: { select: { terms: true } },
} satisfies Prisma.TaxonomyInclude;
type TaxonomyRow = Prisma.TaxonomyGetPayload<{ include: typeof taxonomyInclude }>;

/** Loaded definition of a content type, as the entries service needs it. */
export interface ContentTypeDefinition {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly hierarchical: boolean;
  readonly hasBody: boolean;
  readonly hasExcerpt: boolean;
  readonly hasFeaturedImage: boolean;
  readonly hasBuilder: boolean;
  readonly fields: readonly FieldDefinition[];
  readonly taxonomyIds: readonly string[];
  /** "" for root types (pages). */
  readonly routePrefix: string;
  readonly isPublic: boolean;
}

function invalid(path: string, message: string): ApiException {
  return new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
    { path, message },
  ]);
}

function parseFields(value: Prisma.JsonValue): FieldDefinition[] {
  // Stored definitions were validated on write; re-parse to apply defaults and guard against drift.
  return fieldDefinitionsSchema.parse(value);
}

/** Built-in definitions first in a fixed order (they share a creation time), then custom ones by age. */
const BUILT_IN_ORDER = ['post', 'page', 'category', 'tag'];
function definitionOrder(
  a: { key: string; isSystem: boolean; createdAt: Date },
  b: { key: string; isSystem: boolean; createdAt: Date },
): number {
  if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
  const rank = (key: string) => {
    const index = BUILT_IN_ORDER.indexOf(key);
    return index === -1 ? BUILT_IN_ORDER.length : index;
  };
  return (
    rank(a.key) - rank(b.key) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.key.localeCompare(b.key)
  );
}

function toContentType(row: ContentTypeRow): ContentTypeInfo {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    pluralName: row.pluralName,
    description: row.description,
    hierarchical: row.hierarchical,
    hasBody: row.hasBody,
    hasExcerpt: row.hasExcerpt,
    hasFeaturedImage: row.hasFeaturedImage,
    hasBuilder: row.hasBuilder,
    isSystem: row.isSystem,
    routePrefix: row.routePrefix,
    isPublic: row.isPublic,
    fields: parseFields(row.fields),
    taxonomyIds: row.taxonomies.map((link) => link.taxonomyId),
    entryCount: row._count.entries,
  };
}

function toTaxonomy(row: TaxonomyRow): TaxonomyInfo {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    pluralName: row.pluralName,
    description: row.description,
    hierarchical: row.hierarchical,
    isSystem: row.isSystem,
    routePrefix: row.routePrefix,
    isPublic: row.isPublic,
    contentTypeIds: row.contentTypes.map((link) => link.contentTypeId),
    termCount: row._count.terms,
  };
}

/** Content types, their custom fields, and taxonomies (instance-wide definitions). */
@Injectable()
export class ContentModelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redirects: RedirectsService,
  ) {}

  async model(): Promise<ContentModelResponse> {
    const [contentTypes, taxonomies] = await Promise.all([
      this.prisma.contentType.findMany({ include: contentTypeInclude }),
      this.prisma.taxonomy.findMany({ include: taxonomyInclude }),
    ]);
    return {
      contentTypes: contentTypes.sort(definitionOrder).map(toContentType),
      taxonomies: taxonomies.sort(definitionOrder).map(toTaxonomy),
    };
  }

  async definitionByKey(key: string, db: DbClient = this.prisma): Promise<ContentTypeDefinition> {
    const row = await db.contentType.findUnique({
      where: { key },
      include: { taxonomies: { select: { taxonomyId: true } } },
    });
    if (!row) {
      throw new ApiException(404, 'NOT_FOUND', 'Content type not found.');
    }
    return this.toDefinition(row);
  }

  async definitionById(id: string, db: DbClient = this.prisma): Promise<ContentTypeDefinition> {
    const row = await db.contentType.findUniqueOrThrow({
      where: { id },
      include: { taxonomies: { select: { taxonomyId: true } } },
    });
    return this.toDefinition(row);
  }

  private toDefinition(
    row: Prisma.ContentTypeGetPayload<{
      include: { taxonomies: { select: { taxonomyId: true } } };
    }>,
  ): ContentTypeDefinition {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      hierarchical: row.hierarchical,
      hasBody: row.hasBody,
      hasExcerpt: row.hasExcerpt,
      hasFeaturedImage: row.hasFeaturedImage,
      hasBuilder: row.hasBuilder,
      fields: parseFields(row.fields),
      taxonomyIds: row.taxonomies.map((link) => link.taxonomyId),
      routePrefix: row.routePrefix,
      isPublic: row.isPublic,
    };
  }

  // ------------------------------------------------------------------ routes

  /**
   * A route prefix must be unique across content types and taxonomies and must not be the first
   * segment of a page at the site root (pages own the root namespace below the prefixes).
   */
  private async assertPrefixAvailable(
    db: DbClient,
    prefix: string,
    except: { contentTypeId?: string; taxonomyId?: string },
  ): Promise<void> {
    const [type, taxonomy, page] = await Promise.all([
      db.contentType.findFirst({
        where: {
          routePrefix: prefix,
          ...(except.contentTypeId ? { NOT: { id: except.contentTypeId } } : {}),
        },
        select: { name: true },
      }),
      db.taxonomy.findFirst({
        where: {
          routePrefix: prefix,
          ...(except.taxonomyId ? { NOT: { id: except.taxonomyId } } : {}),
        },
        select: { name: true },
      }),
      db.entry.findFirst({
        where: {
          contentType: { routePrefix: '' },
          OR: [{ path: prefix }, { path: { startsWith: `${prefix}/` } }],
        },
        select: { title: true },
      }),
    ]);
    if (type) {
      throw invalid('routePrefix', `The content type "${type.name}" already uses this address.`);
    }
    if (taxonomy) {
      throw invalid('routePrefix', `The taxonomy "${taxonomy.name}" already uses this address.`);
    }
    if (page) {
      throw invalid(
        'routePrefix',
        `A page already uses this address ("/${prefix}"). Change the page's slug first.`,
      );
    }
  }

  /**
   * Redirects for a content type's published entries (and its archive) after a prefix change, per site.
   * Definitions are instance-wide while entries and redirects belong to a site.
   */
  private async recordContentTypeMoves(
    db: DbClient,
    type: { id: string; hierarchical: boolean },
    from: string,
    to: string,
  ): Promise<number> {
    const [sites, entries] = await Promise.all([
      db.site.findMany({ select: { id: true } }),
      db.entry.findMany({
        where: { contentTypeId: type.id, status: 'published', trashedAt: null },
        select: { siteId: true, path: true },
      }),
    ]);
    let moved = 0;
    for (const site of sites) {
      const moves: PathMove[] = entries
        .filter((entry) => entry.siteId === site.id)
        .map((entry) => ({
          from: publicEntryPath(from, entry.path),
          to: publicEntryPath(to, entry.path),
        }));
      if (!type.hierarchical) {
        moves.push({ from: publicArchivePath(from), to: publicArchivePath(to) });
      }
      moved += await this.redirects.recordMoves(db, site.id, moves);
    }
    return moved;
  }

  // ------------------------------------------------------------------ content types

  async createContentType(
    actor: AuthContext,
    input: z.output<typeof createContentTypeSchema>,
    meta: RequestMeta,
  ): Promise<ContentTypeInfo> {
    await this.assertTaxonomiesExist(input.taxonomyIds);
    if (
      await this.prisma.contentType.findUnique({ where: { key: input.key }, select: { id: true } })
    ) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
        { path: 'key', message: 'A content type with this key already exists.' },
      ]);
    }
    const routePrefix = input.routePrefix ?? defaultRoutePrefix(input.key);
    await this.assertPrefixAvailable(this.prisma, routePrefix, {});
    const id = await this.withUniquePrefix(async () =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.contentType.create({
          data: {
            key: input.key,
            routePrefix,
            isPublic: input.isPublic,
            name: input.name,
            pluralName: input.pluralName,
            description: input.description,
            hierarchical: input.hierarchical,
            hasBody: input.hasBody,
            hasExcerpt: input.hasExcerpt,
            hasFeaturedImage: input.hasFeaturedImage,
            hasBuilder: input.hasBuilder,
            fields: input.fields,
            taxonomies: { create: input.taxonomyIds.map((taxonomyId) => ({ taxonomyId })) },
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          action: 'content_type.created',
          actorUserId: actor.userId,
          targetType: 'content_type',
          targetId: created.id,
          request: meta,
          metadata: { key: input.key, routePrefix },
        });
        return created.id;
      }),
    );
    return this.contentTypeInfo(id);
  }

  async updateContentType(
    actor: AuthContext,
    id: string,
    input: z.output<typeof updateContentTypeSchema>,
    meta: RequestMeta,
  ): Promise<ContentTypeInfo> {
    const existing = await this.prisma.contentType.findUnique({
      where: { id },
      include: contentTypeInclude,
    });
    if (!existing) {
      throw new ApiException(404, 'NOT_FOUND', 'Content type not found.');
    }
    if (
      input.hierarchical !== undefined &&
      input.hierarchical !== existing.hierarchical &&
      existing._count.entries > 0
    ) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
        {
          path: 'hierarchical',
          message: 'The hierarchy setting cannot change while entries of this type exist.',
        },
      ]);
    }
    if (input.taxonomyIds) {
      await this.assertTaxonomiesExist(input.taxonomyIds);
    }
    const prefixChanges =
      input.routePrefix !== undefined && input.routePrefix !== existing.routePrefix;
    if (prefixChanges && existing.routePrefix === '') {
      throw invalid('routePrefix', 'Pages always live at the site root.');
    }
    if (prefixChanges && input.routePrefix !== undefined) {
      await this.assertPrefixAvailable(this.prisma, input.routePrefix, { contentTypeId: id });
    }
    const nextPublic = input.isPublic ?? existing.isPublic;
    await this.withUniquePrefix(async () =>
      this.prisma.$transaction(async (tx) => {
        // Published entries keep working at their old addresses through permanent redirects.
        let moved = 0;
        if (prefixChanges && input.routePrefix !== undefined && existing.isPublic && nextPublic) {
          moved = await this.recordContentTypeMoves(
            tx,
            existing,
            existing.routePrefix,
            input.routePrefix,
          );
        }
        await tx.contentType.update({
          where: { id },
          data: {
            ...(input.routePrefix !== undefined ? { routePrefix: input.routePrefix } : {}),
            ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.pluralName !== undefined ? { pluralName: input.pluralName } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.hierarchical !== undefined ? { hierarchical: input.hierarchical } : {}),
            ...(input.hasBody !== undefined ? { hasBody: input.hasBody } : {}),
            ...(input.hasExcerpt !== undefined ? { hasExcerpt: input.hasExcerpt } : {}),
            ...(input.hasFeaturedImage !== undefined
              ? { hasFeaturedImage: input.hasFeaturedImage }
              : {}),
            ...(input.hasBuilder !== undefined ? { hasBuilder: input.hasBuilder } : {}),
            ...(input.fields !== undefined ? { fields: input.fields } : {}),
          },
        });
        if (input.taxonomyIds) {
          await tx.contentTypeTaxonomy.deleteMany({ where: { contentTypeId: id } });
          await tx.contentTypeTaxonomy.createMany({
            data: input.taxonomyIds.map((taxonomyId) => ({ contentTypeId: id, taxonomyId })),
          });
        }
        await this.audit.record(tx, {
          action: 'content_type.updated',
          actorUserId: actor.userId,
          targetType: 'content_type',
          targetId: id,
          request: meta,
          metadata: {
            key: existing.key,
            changed: Object.keys(input).sort(),
            ...(prefixChanges && input.routePrefix !== undefined
              ? { routePrefix: input.routePrefix, redirects: moved }
              : {}),
          },
        });
      }),
    );
    return this.contentTypeInfo(id);
  }

  async deleteContentType(actor: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const existing = await this.prisma.contentType.findUnique({
      where: { id },
      include: { _count: { select: { entries: true } } },
    });
    if (!existing) {
      throw new ApiException(404, 'NOT_FOUND', 'Content type not found.');
    }
    if (existing.isSystem) {
      throw new ApiException(409, 'CONFLICT', 'Built-in content types cannot be deleted.');
    }
    if (existing._count.entries > 0) {
      throw new ApiException(
        409,
        'CONFLICT',
        'This content type still has entries (including trashed ones). Delete them first.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.contentType.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'content_type.deleted',
        actorUserId: actor.userId,
        targetType: 'content_type',
        targetId: id,
        request: meta,
        metadata: { key: existing.key },
      });
    });
  }

  private async contentTypeInfo(id: string): Promise<ContentTypeInfo> {
    return toContentType(
      await this.prisma.contentType.findUniqueOrThrow({
        where: { id },
        include: contentTypeInclude,
      }),
    );
  }

  private async assertTaxonomiesExist(ids: readonly string[]): Promise<void> {
    const unique = [...new Set(ids)];
    const count = await this.prisma.taxonomy.count({ where: { id: { in: unique } } });
    if (count !== unique.length) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
        { path: 'taxonomyIds', message: 'One or more taxonomies do not exist.' },
      ]);
    }
  }

  // ------------------------------------------------------------------ taxonomies

  async createTaxonomy(
    actor: AuthContext,
    input: z.output<typeof createTaxonomySchema>,
    meta: RequestMeta,
  ): Promise<TaxonomyInfo> {
    await this.assertContentTypesExist(input.contentTypeIds);
    if (
      await this.prisma.taxonomy.findUnique({ where: { key: input.key }, select: { id: true } })
    ) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
        { path: 'key', message: 'A taxonomy with this key already exists.' },
      ]);
    }
    const routePrefix = input.routePrefix ?? defaultRoutePrefix(input.key);
    await this.assertPrefixAvailable(this.prisma, routePrefix, {});
    const id = await this.withUniquePrefix(async () =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.taxonomy.create({
          data: {
            key: input.key,
            routePrefix,
            isPublic: input.isPublic,
            name: input.name,
            pluralName: input.pluralName,
            description: input.description,
            hierarchical: input.hierarchical,
            contentTypes: {
              create: input.contentTypeIds.map((contentTypeId) => ({ contentTypeId })),
            },
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          action: 'taxonomy.created',
          actorUserId: actor.userId,
          targetType: 'taxonomy',
          targetId: created.id,
          request: meta,
          metadata: { key: input.key, routePrefix },
        });
        return created.id;
      }),
    );
    return this.taxonomyInfo(id);
  }

  async updateTaxonomy(
    actor: AuthContext,
    id: string,
    input: z.output<typeof updateTaxonomySchema>,
    meta: RequestMeta,
  ): Promise<TaxonomyInfo> {
    const existing = await this.prisma.taxonomy.findUnique({
      where: { id },
      select: { key: true, routePrefix: true, isPublic: true },
    });
    if (!existing) {
      throw new ApiException(404, 'NOT_FOUND', 'Taxonomy not found.');
    }
    if (input.contentTypeIds) {
      await this.assertContentTypesExist(input.contentTypeIds);
    }
    const prefixChanges =
      input.routePrefix !== undefined && input.routePrefix !== existing.routePrefix;
    if (prefixChanges && input.routePrefix !== undefined) {
      await this.assertPrefixAvailable(this.prisma, input.routePrefix, { taxonomyId: id });
    }
    const nextPublic = input.isPublic ?? existing.isPublic;
    await this.withUniquePrefix(async () =>
      this.prisma.$transaction(async (tx) => {
        let moved = 0;
        if (prefixChanges && input.routePrefix !== undefined && existing.isPublic && nextPublic) {
          const to = input.routePrefix;
          const terms = await tx.term.findMany({
            where: { taxonomyId: id },
            select: { siteId: true, slug: true },
          });
          const bySite = new Map<string, PathMove[]>();
          for (const term of terms) {
            const list = bySite.get(term.siteId) ?? [];
            list.push({
              from: publicTermPath(existing.routePrefix, term.slug),
              to: publicTermPath(to, term.slug),
            });
            bySite.set(term.siteId, list);
          }
          for (const [siteId, moves] of bySite) {
            moved += await this.redirects.recordMoves(tx, siteId, moves);
          }
        }
        await tx.taxonomy.update({
          where: { id },
          data: {
            ...(input.routePrefix !== undefined ? { routePrefix: input.routePrefix } : {}),
            ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.pluralName !== undefined ? { pluralName: input.pluralName } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
          },
        });
        if (input.contentTypeIds) {
          await tx.contentTypeTaxonomy.deleteMany({ where: { taxonomyId: id } });
          await tx.contentTypeTaxonomy.createMany({
            data: input.contentTypeIds.map((contentTypeId) => ({ contentTypeId, taxonomyId: id })),
          });
        }
        await this.audit.record(tx, {
          action: 'taxonomy.updated',
          actorUserId: actor.userId,
          targetType: 'taxonomy',
          targetId: id,
          request: meta,
          metadata: {
            key: existing.key,
            changed: Object.keys(input).sort(),
            ...(prefixChanges && input.routePrefix !== undefined
              ? { routePrefix: input.routePrefix, redirects: moved }
              : {}),
          },
        });
      }),
    );
    return this.taxonomyInfo(id);
  }

  async deleteTaxonomy(actor: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const existing = await this.prisma.taxonomy.findUnique({
      where: { id },
      select: { key: true, isSystem: true },
    });
    if (!existing) {
      throw new ApiException(404, 'NOT_FOUND', 'Taxonomy not found.');
    }
    if (existing.isSystem) {
      throw new ApiException(409, 'CONFLICT', 'Built-in taxonomies cannot be deleted.');
    }
    await this.prisma.$transaction(async (tx) => {
      // Terms (and their assignments to entries) go with the taxonomy.
      await tx.taxonomy.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'taxonomy.deleted',
        actorUserId: actor.userId,
        targetType: 'taxonomy',
        targetId: id,
        request: meta,
        metadata: { key: existing.key },
      });
    });
  }

  private async taxonomyInfo(id: string): Promise<TaxonomyInfo> {
    return toTaxonomy(
      await this.prisma.taxonomy.findUniqueOrThrow({ where: { id }, include: taxonomyInclude }),
    );
  }

  /** Maps a race on the unique route prefix to a validation error. */
  private async withUniquePrefix<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw invalid('routePrefix', 'Another content type or taxonomy already uses this address.');
      }
      throw error;
    }
  }

  private async assertContentTypesExist(ids: readonly string[]): Promise<void> {
    const unique = [...new Set(ids)];
    const count = await this.prisma.contentType.count({ where: { id: { in: unique } } });
    if (count !== unique.length) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
        { path: 'contentTypeIds', message: 'One or more content types do not exist.' },
      ]);
    }
  }
}
