import { Injectable } from '@nestjs/common';
import {
  fieldDefinitionsSchema,
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
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
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
  readonly fields: readonly FieldDefinition[];
  readonly taxonomyIds: readonly string[];
}

function parseFields(value: Prisma.JsonValue): FieldDefinition[] {
  // Stored definitions were validated on write; re-parse to apply defaults and guard against drift.
  return fieldDefinitionsSchema.parse(value);
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
    isSystem: row.isSystem,
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
  ) {}

  async model(): Promise<ContentModelResponse> {
    const [contentTypes, taxonomies] = await Promise.all([
      this.prisma.contentType.findMany({
        include: contentTypeInclude,
        orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
      }),
      this.prisma.taxonomy.findMany({
        include: taxonomyInclude,
        orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
      }),
    ]);
    return {
      contentTypes: contentTypes.map(toContentType),
      taxonomies: taxonomies.map(toTaxonomy),
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
      fields: parseFields(row.fields),
      taxonomyIds: row.taxonomies.map((link) => link.taxonomyId),
    };
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
    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contentType.create({
        data: {
          key: input.key,
          name: input.name,
          pluralName: input.pluralName,
          description: input.description,
          hierarchical: input.hierarchical,
          hasBody: input.hasBody,
          hasExcerpt: input.hasExcerpt,
          hasFeaturedImage: input.hasFeaturedImage,
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
        metadata: { key: input.key },
      });
      return created.id;
    });
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
    await this.prisma.$transaction(async (tx) => {
      await tx.contentType.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.pluralName !== undefined ? { pluralName: input.pluralName } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.hierarchical !== undefined ? { hierarchical: input.hierarchical } : {}),
          ...(input.hasBody !== undefined ? { hasBody: input.hasBody } : {}),
          ...(input.hasExcerpt !== undefined ? { hasExcerpt: input.hasExcerpt } : {}),
          ...(input.hasFeaturedImage !== undefined
            ? { hasFeaturedImage: input.hasFeaturedImage }
            : {}),
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
        metadata: { key: existing.key, changed: Object.keys(input).sort() },
      });
    });
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
    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.taxonomy.create({
        data: {
          key: input.key,
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
        metadata: { key: input.key },
      });
      return created.id;
    });
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
      select: { key: true },
    });
    if (!existing) {
      throw new ApiException(404, 'NOT_FOUND', 'Taxonomy not found.');
    }
    if (input.contentTypeIds) {
      await this.assertContentTypesExist(input.contentTypeIds);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.taxonomy.update({
        where: { id },
        data: {
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
        metadata: { key: existing.key, changed: Object.keys(input).sort() },
      });
    });
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
