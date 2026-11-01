import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  allWidgets,
  builderDocumentSchema,
  builderFromRichText,
  builderMediaIds,
  builderPlainText,
  buildFieldValuesSchema,
  EMPTY_RICH_TEXT,
  entrySeoSchema,
  publicEntryPath,
  RESERVED_ROUTE_SEGMENTS,
  revisionSnapshotSchema,
  richTextDocumentSchema,
  richTextToPlainText,
  slugify,
  type createEntrySchema,
  type EntryBulkResponse,
  type EntryDetail,
  type EntryListResponse,
  type BuilderDocument,
  type EntryEditor,
  type EntrySeo,
  type EntryStatus,
  type EntrySummary,
  type entryBulkSchema,
  type entryListQuerySchema,
  type FieldValues,
  type PreviewLink,
  type RevisionDetail,
  type RevisionSnapshot,
  type RevisionSummary,
  type RichTextDocument,
  type updateEntrySchema,
} from '@nexora/shared';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { defineJob } from '../jobs/job-definition.js';
import { JobRegistry } from '../jobs/job-registry.service.js';
import { MediaUrls, type StoredVariant } from '../media/media-urls.js';
import { RedirectsService, type PathMove } from '../redirects/redirects.service.js';
import type { AuthContext } from '../security/auth-context.js';
import { generateToken, sha256 } from '../security/crypto.js';
import { SiteService } from '../sites/site.service.js';
import { ContentModelService, type ContentTypeDefinition } from './content-model.service.js';
import {
  canCreate,
  canEdit,
  canRestore,
  canSeeAllEntries,
  canSetStatus,
  canTrash,
  canView,
  permissionsFor,
  type PolicyActor,
} from './content-policy.js';

export const PublishScheduledJob = defineJob('content.publish_scheduled', z.object({}));
export const PurgeTrashJob = defineJob('content.purge_trash', z.object({}));

const MAX_PATH_LENGTH = 2_000;
/** Lifetime of a preview link. */
export const PREVIEW_TTL_MS = 60 * 60 * 1000;
const LIVE: readonly EntryStatus[] = ['published', 'scheduled'];
const FORBIDDEN = (): ApiException =>
  new ApiException(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
const NOT_FOUND = (): ApiException => new ApiException(404, 'NOT_FOUND', 'Entry not found.');
const CONFLICT = (): ApiException =>
  new ApiException(
    409,
    'CONFLICT',
    'This entry was changed by someone else since you opened it. Reload to see the latest version.',
  );

function invalid(path: string, message: string): ApiException {
  return new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
    { path, message },
  ]);
}

const person = { select: { id: true, displayName: true } } as const;
const entryInclude = {
  contentType: { select: { routePrefix: true, isPublic: true } },
  author: person,
  lastEditor: person,
  terms: { select: { term: { select: { id: true, taxonomyId: true, name: true } } } },
  featuredMedia: {
    select: {
      id: true,
      storageKey: true,
      variants: true,
      altText: true,
      width: true,
      height: true,
    },
  },
} satisfies Prisma.EntryInclude;
type EntryRow = Prisma.EntryGetPayload<{ include: typeof entryInclude }>;

/** Editable content of an entry: what a revision captures and restores. */
interface EntryContent {
  title: string;
  slug: string;
  excerpt: string;
  body: RichTextDocument;
  fields: FieldValues;
  termIds: string[];
  featuredMediaId: string | null;
  parentId: string | null;
  editor: EntryEditor;
  builder: BuilderDocument | null;
}

/** HTML embed widgets of a document, by id (to detect added or changed embeds). */
function htmlEmbeds(document: BuilderDocument | null): Map<string, string> {
  const embeds = new Map<string, string>();
  for (const widget of document ? allWidgets(document) : []) {
    if (widget.widget === 'html') embeds.set(widget.id, widget.props.html);
  }
  return embeds;
}

function builderJson(document: BuilderDocument | null) {
  return document === null ? Prisma.DbNull : (document as unknown as Prisma.InputJsonValue);
}

function actorOf(auth: AuthContext): PolicyActor {
  return { userId: auth.userId, capabilities: auth.capabilities };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** JSON with sorted object keys, for comparing content regardless of key order (jsonb reorders keys). */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

/** Stored SEO overrides; anything unreadable falls back to the defaults. */
function seoOf(value: Prisma.JsonValue): EntrySeo {
  const parsed = entrySeoSchema.safeParse(value);
  return parsed.success ? parsed.data : entrySeoSchema.parse({});
}

function searchTextOf(content: EntryContent): string {
  const builder =
    content.editor === 'builder' && content.builder ? builderPlainText(content.builder) : '';
  return `${content.title}\n${content.excerpt}\n${richTextToPlainText(content.body)}\n${builder}`
    .toLowerCase()
    .slice(0, 100_000);
}

/**
 * Entries: create, edit (optimistic concurrency), status workflow and scheduling, trash, revisions and
 * bulk actions. Authorisation combines the route's capability check with the per-entry content policy.
 */
@Injectable()
export class EntriesService implements OnModuleInit {
  private readonly logger = new Logger(EntriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly model: ContentModelService,
    private readonly audit: AuditService,
    private readonly registry: JobRegistry,
    private readonly mediaUrls: MediaUrls,
    private readonly redirects: RedirectsService,
    private readonly sites: SiteService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.registry.register(PublishScheduledJob, async () => {
      await this.publishDue();
    });
    this.registry.register(PurgeTrashJob, async () => {
      await this.purgeTrash();
    });
    this.registry.schedule('content.publish_scheduled', 60_000, PublishScheduledJob, {});
    this.registry.schedule('content.purge_trash', 3_600_000, PurgeTrashJob, {});
  }

  // ---------------------------------------------------------------------------- reads

  async list(
    auth: AuthContext,
    query: z.output<typeof entryListQuerySchema>,
  ): Promise<EntryListResponse> {
    const actor = actorOf(auth);
    const type = await this.model.definitionByKey(query.type);
    const base: Prisma.EntryWhereInput = {
      siteId: auth.siteId,
      contentTypeId: type.id,
      ...(canSeeAllEntries(actor) ? {} : { authorId: actor.userId }),
      ...(query.authorId ? { authorId: query.authorId } : {}),
      ...(query.termId ? { terms: { some: { termId: query.termId } } } : {}),
      ...(query.search ? { searchText: { contains: query.search.toLowerCase() } } : {}),
    };
    if (!canSeeAllEntries(actor) && query.authorId && query.authorId !== actor.userId) {
      base.id = { in: [] };
    }
    const statusWhere: Prisma.EntryWhereInput =
      query.status === 'all'
        ? { trashedAt: null }
        : query.status === 'trash'
          ? { trashedAt: { not: null } }
          : { status: query.status, trashedAt: null };
    const where: Prisma.EntryWhereInput = { AND: [base, statusWhere] };
    const orderBy: Prisma.EntryOrderByWithRelationInput[] =
      query.sort === 'title'
        ? [{ title: 'asc' }, { id: 'asc' }]
        : query.sort === 'published'
          ? [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }]
          : [{ updatedAt: 'desc' }, { id: 'desc' }];

    const [total, rows, grouped, trash] = await Promise.all([
      this.prisma.entry.count({ where }),
      this.prisma.entry.findMany({
        where,
        include: entryInclude,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.entry.groupBy({
        by: ['status'],
        where: { AND: [base, { trashedAt: null }] },
        _count: { _all: true },
      }),
      this.prisma.entry.count({ where: { AND: [base, { trashedAt: { not: null } }] } }),
    ]);
    const counts = { all: 0, draft: 0, pending: 0, scheduled: 0, published: 0, trash };
    for (const group of grouped) {
      counts[group.status] = group._count._all;
      counts.all += group._count._all;
    }
    return {
      items: rows.map((row) => this.toSummary(row, actor)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      counts,
    };
  }

  async get(auth: AuthContext, id: string): Promise<EntryDetail> {
    const row = await this.loadViewable(auth, id);
    return this.toDetail(row, actorOf(auth));
  }

  // ---------------------------------------------------------------------------- writes

  async create(
    auth: AuthContext,
    input: z.output<typeof createEntrySchema>,
    meta: RequestMeta,
  ): Promise<EntryDetail> {
    const actor = actorOf(auth);
    const type = await this.model.definitionByKey(input.type);
    if (!canCreate(actor, input.status)) {
      throw FORBIDDEN();
    }
    const content = await this.validateContent(auth.siteId, type, actor, null, {
      title: input.title,
      slug: input.slug ?? '',
      excerpt: input.excerpt,
      body: input.body ?? EMPTY_RICH_TEXT,
      fields: input.fields,
      termIds: input.termIds,
      featuredMediaId: input.featuredMediaId,
      parentId: input.parentId,
      editor: input.editor,
      builder: input.builder,
    });
    this.assertTitleForStatus(content.title, input.status);
    const publishedAt = this.resolvePublishedAt(input.status, input.publishedAt, null);

    const id = await this.withUniquePath(async () =>
      this.prisma.$transaction(async (tx) => {
        const parentPath = await this.parentPath(tx, auth.siteId, type, content.parentId, null);
        const reserved = await this.reservedRootSlugs(tx, type, parentPath);
        if (input.slug === undefined) {
          content.slug = await this.uniqueSlug(
            tx,
            auth.siteId,
            type.id,
            parentPath,
            content.title,
            reserved,
          );
        }
        this.assertSlugNotReserved(content.slug, reserved);
        const path = this.joinPath(parentPath, content.slug);
        await this.assertPathFree(tx, auth.siteId, type.id, path, null, 'slug');
        const entry = await tx.entry.create({
          data: {
            siteId: auth.siteId,
            contentTypeId: type.id,
            authorId: auth.userId,
            lastEditorId: auth.userId,
            parentId: content.parentId,
            title: content.title,
            slug: content.slug,
            path,
            status: input.status,
            excerpt: content.excerpt,
            body: content.body as unknown as Prisma.InputJsonValue,
            fields: content.fields,
            searchText: searchTextOf(content),
            featuredMediaId: content.featuredMediaId,
            editor: content.editor,
            builder: builderJson(content.builder),
            publishedAt,
            seo: input.seo ?? entrySeoSchema.parse({}),
            terms: { create: content.termIds.map((termId) => ({ termId })) },
          },
          select: { id: true },
        });
        await this.recordRevision(tx, entry.id, auth.userId, 1, content);
        await this.auditTransition(
          tx,
          auth,
          entry.id,
          type,
          content.title,
          null,
          input.status,
          meta,
        );
        return entry.id;
      }),
    );
    return this.get(auth, id);
  }

  async update(
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateEntrySchema>,
    meta: RequestMeta,
  ): Promise<EntryDetail> {
    const actor = actorOf(auth);
    const current = await this.loadViewable(auth, id);
    if (current.version !== input.version) {
      throw CONFLICT();
    }
    const facts = {
      authorId: current.authorId,
      status: current.status,
      trashed: current.trashedAt !== null,
    };
    const contentKeys = [
      'title',
      'slug',
      'excerpt',
      'body',
      'fields',
      'parentId',
      'termIds',
      'featuredMediaId',
      'editor',
      'builder',
    ] as const;
    const currentSeo = seoOf(current.seo);
    const changesSeo = input.seo !== undefined && stableJson(input.seo) !== stableJson(currentSeo);
    const changesContent = contentKeys.some((key) => input[key] !== undefined) || changesSeo;
    const nextStatus = input.status ?? current.status;
    const changesStatus = nextStatus !== current.status || input.publishedAt !== undefined;
    if (facts.trashed) {
      throw new ApiException(
        409,
        'CONFLICT',
        'Restore this entry from the trash before editing it.',
      );
    }
    if (changesContent && !canEdit(actor, facts)) {
      throw FORBIDDEN();
    }
    if (changesStatus && !canSetStatus(actor, facts, nextStatus)) {
      throw FORBIDDEN();
    }
    if (!changesContent && !changesStatus) {
      return this.toDetail(current, actor);
    }

    const type = await this.model.definitionById(current.contentTypeId);
    const previous = this.contentOf(current);
    const content = changesContent
      ? await this.validateContent(auth.siteId, type, actor, previous.builder, {
          title: input.title ?? previous.title,
          slug: input.slug ?? previous.slug,
          excerpt: input.excerpt ?? previous.excerpt,
          body: input.body ?? previous.body,
          fields: input.fields ?? previous.fields,
          termIds: input.termIds ?? previous.termIds,
          featuredMediaId:
            input.featuredMediaId !== undefined ? input.featuredMediaId : previous.featuredMediaId,
          parentId: input.parentId !== undefined ? input.parentId : previous.parentId,
          editor: input.editor ?? previous.editor,
          builder: input.builder !== undefined ? input.builder : previous.builder,
        })
      : previous;
    this.assertTitleForStatus(content.title, nextStatus);
    const publishedAt = changesStatus
      ? this.resolvePublishedAt(nextStatus, input.publishedAt, current.publishedAt)
      : current.publishedAt;

    await this.withUniquePath(async () =>
      this.prisma.$transaction(async (tx) => {
        let path = current.path;
        if (content.slug !== previous.slug || content.parentId !== previous.parentId) {
          const parentPath = await this.parentPath(
            tx,
            auth.siteId,
            type,
            content.parentId,
            current,
          );
          if (content.slug !== previous.slug || parentPath === null) {
            this.assertSlugNotReserved(
              content.slug,
              await this.reservedRootSlugs(tx, type, parentPath),
            );
          }
          path = this.joinPath(parentPath, content.slug);
          await this.assertPathFree(
            tx,
            auth.siteId,
            type.id,
            path,
            id,
            content.slug !== previous.slug ? 'slug' : 'parentId',
          );
        }
        const updated = await tx.entry.updateMany({
          where: { id, version: input.version },
          data: {
            title: content.title,
            slug: content.slug,
            path,
            parentId: content.parentId,
            excerpt: content.excerpt,
            body: content.body as unknown as Prisma.InputJsonValue,
            fields: content.fields,
            searchText: searchTextOf(content),
            featuredMediaId: content.featuredMediaId,
            editor: content.editor,
            builder: builderJson(content.builder),
            status: nextStatus,
            publishedAt,
            ...(changesSeo && input.seo ? { seo: input.seo } : {}),
            lastEditorId: auth.userId,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw CONFLICT();
        }
        if (path !== current.path) {
          await tx.$executeRaw`
            UPDATE entries
               SET path = ${path} || substr(path, char_length(${current.path}) + 1), updated_at = now()
             WHERE site_id = ${auth.siteId}::uuid AND content_type_id = ${type.id}::uuid
               AND path LIKE ${`${escapeLike(current.path)}/%`}`;
          // Live addresses keep working: permanent redirects for the entry and its published descendants.
          if (type.isPublic && current.status === 'published' && nextStatus === 'published') {
            await this.recordPathMoves(tx, auth.siteId, type, current.path, path);
          }
        }
        if (input.termIds !== undefined) {
          await tx.entryTerm.deleteMany({ where: { entryId: id } });
          await tx.entryTerm.createMany({
            data: content.termIds.map((termId) => ({ entryId: id, termId })),
          });
        }
        // Saves that change nothing (e.g. a status change only) do not create a revision.
        if (
          changesContent &&
          stableJson({ ...content, termIds: [...content.termIds].sort() }) !==
            stableJson({ ...previous, termIds: [...previous.termIds].sort() })
        ) {
          await this.recordRevision(tx, id, auth.userId, input.version + 1, content);
        }
        if (nextStatus !== current.status) {
          await this.auditTransition(
            tx,
            auth,
            id,
            type,
            content.title,
            current.status,
            nextStatus,
            meta,
          );
        }
      }),
    );
    return this.get(auth, id);
  }

  async trash(auth: AuthContext, id: string, meta: RequestMeta): Promise<EntryDetail> {
    const entry = await this.loadViewable(auth, id);
    if (!canTrash(actorOf(auth), this.facts(entry))) {
      throw entry.trashedAt
        ? new ApiException(409, 'CONFLICT', 'This entry is already in the trash.')
        : FORBIDDEN();
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.entry.update({
        where: { id },
        data: { trashedAt: new Date(), trashedById: auth.userId, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'entry.trashed',
        actorUserId: auth.userId,
        targetType: 'entry',
        targetId: id,
        request: meta,
        metadata: { title: entry.title.slice(0, 200) },
      });
    });
    return this.get(auth, id);
  }

  async restore(auth: AuthContext, id: string, meta: RequestMeta): Promise<EntryDetail> {
    const entry = await this.loadViewable(auth, id);
    if (!canRestore(actorOf(auth), this.facts(entry))) {
      throw entry.trashedAt
        ? FORBIDDEN()
        : new ApiException(409, 'CONFLICT', 'This entry is not in the trash.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.entry.update({
        where: { id },
        data: { trashedAt: null, trashedById: null, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'entry.restored',
        actorUserId: auth.userId,
        targetType: 'entry',
        targetId: id,
        request: meta,
        metadata: { title: entry.title.slice(0, 200) },
      });
    });
    return this.get(auth, id);
  }

  /** Permanent deletion of a trashed entry (with its revisions). Entries with child entries are kept. */
  async deletePermanently(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const entry = await this.loadViewable(auth, id);
    if (!canRestore(actorOf(auth), this.facts(entry))) {
      throw entry.trashedAt
        ? FORBIDDEN()
        : new ApiException(
            409,
            'CONFLICT',
            'Move the entry to the trash before deleting it permanently.',
          );
    }
    if (await this.prisma.entry.count({ where: { parentId: id } })) {
      throw new ApiException(
        409,
        'CONFLICT',
        'This entry has child entries. Move or delete them first.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.entry.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'entry.deleted',
        actorUserId: auth.userId,
        targetType: 'entry',
        targetId: id,
        request: meta,
        metadata: { title: entry.title.slice(0, 200) },
      });
    });
  }

  async bulk(
    auth: AuthContext,
    input: z.output<typeof entryBulkSchema>,
    meta: RequestMeta,
  ): Promise<EntryBulkResponse> {
    const result: EntryBulkResponse = { succeeded: [], failed: [] };
    for (const id of new Set(input.ids)) {
      try {
        switch (input.action) {
          case 'trash':
            await this.trash(auth, id, meta);
            break;
          case 'restore':
            await this.restore(auth, id, meta);
            break;
          case 'delete':
            await this.deletePermanently(auth, id, meta);
            break;
          case 'publish':
          case 'draft': {
            const current = await this.loadViewable(auth, id);
            await this.update(
              auth,
              id,
              {
                version: current.version,
                status: input.action === 'publish' ? 'published' : 'draft',
              },
              meta,
            );
            break;
          }
        }
        result.succeeded.push(id);
      } catch (error) {
        if (!(error instanceof ApiException)) {
          this.logger.error({ err: error, entryId: id }, 'Bulk action failed unexpectedly');
        }
        result.failed.push({
          id,
          message: error instanceof ApiException ? error.message : 'Unexpected error.',
        });
      }
    }
    return result;
  }

  /** Issues a short-lived link that shows the entry's latest saved content on the public site. */
  async createPreview(auth: AuthContext, id: string): Promise<PreviewLink> {
    const entry = await this.loadViewable(auth, id);
    if (entry.trashedAt) {
      throw new ApiException(409, 'CONFLICT', 'Restore this entry from the trash to preview it.');
    }
    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);
    await this.prisma.previewToken.create({
      data: { entryId: id, createdById: auth.userId, tokenHash: sha256(token), expiresAt },
    });
    const site = await this.sites.requireDefault();
    return { url: `${site.baseUrl}/_preview/${token}`, expiresAt: expiresAt.toISOString() };
  }

  // ---------------------------------------------------------------------------- revisions

  async revisions(auth: AuthContext, entryId: string): Promise<RevisionSummary[]> {
    await this.loadViewable(auth, entryId);
    const rows = await this.prisma.entryRevision.findMany({
      where: { entryId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { author: person },
    });
    return rows.map((row) => ({
      id: row.id,
      entryVersion: row.entryVersion,
      title: row.title,
      author: row.author,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async revision(auth: AuthContext, entryId: string, revisionId: string): Promise<RevisionDetail> {
    await this.loadViewable(auth, entryId);
    const row = await this.prisma.entryRevision.findFirst({
      where: { id: revisionId, entryId },
      include: { author: person },
    });
    if (!row) {
      throw new ApiException(404, 'NOT_FOUND', 'Revision not found.');
    }
    return {
      id: row.id,
      entryVersion: row.entryVersion,
      title: row.title,
      author: row.author,
      createdAt: row.createdAt.toISOString(),
      snapshot: revisionSnapshotSchema.parse(row.snapshot),
    };
  }

  /** Applies a revision's content as a new save (which itself becomes the newest revision). */
  async restoreRevision(
    auth: AuthContext,
    entryId: string,
    revisionId: string,
    version: number,
    meta: RequestMeta,
  ): Promise<EntryDetail> {
    const { snapshot } = await this.revision(auth, entryId, revisionId);
    const entry = await this.loadViewable(auth, entryId);
    const type = await this.model.definitionById(entry.contentTypeId);
    // Terms, media and parents deleted since the revision was taken are dropped rather than failing.
    const [terms, media, parent] = await Promise.all([
      this.prisma.term.findMany({
        where: {
          id: { in: snapshot.termIds },
          siteId: auth.siteId,
          taxonomyId: { in: [...type.taxonomyIds] },
        },
        select: { id: true },
      }),
      snapshot.featuredMediaId
        ? this.prisma.media.findFirst({
            where: { id: snapshot.featuredMediaId, siteId: auth.siteId },
            select: { id: true },
          })
        : null,
      snapshot.parentId
        ? this.prisma.entry.findFirst({
            where: { id: snapshot.parentId, siteId: auth.siteId, trashedAt: null },
            select: { id: true },
          })
        : null,
    ]);
    return this.update(
      auth,
      entryId,
      {
        version,
        title: snapshot.title,
        slug: snapshot.slug,
        excerpt: snapshot.excerpt,
        body: snapshot.body,
        fields: snapshot.fields,
        termIds: terms.map((term) => term.id),
        featuredMediaId: media?.id ?? null,
        parentId: parent?.id ?? null,
        editor: snapshot.editor,
        builder: snapshot.builder,
      },
      meta,
    );
  }

  // ---------------------------------------------------------------------------- jobs

  /** Publishes scheduled entries whose time has come. Returns the number published. */
  async publishDue(now = new Date()): Promise<number> {
    const due = await this.prisma.entry.findMany({
      where: { status: 'scheduled', publishedAt: { lte: now }, trashedAt: null },
      select: { id: true, version: true, title: true, contentType: { select: { key: true } } },
      orderBy: { publishedAt: 'asc' },
      take: 200,
    });
    let published = 0;
    for (const entry of due) {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.entry.updateMany({
          where: { id: entry.id, version: entry.version, status: 'scheduled' },
          data: { status: 'published', version: { increment: 1 } },
        });
        if (updated.count === 1) {
          published += 1;
          await this.audit.record(tx, {
            action: 'entry.published',
            targetType: 'entry',
            targetId: entry.id,
            metadata: {
              type: entry.contentType.key,
              title: entry.title.slice(0, 200),
              scheduled: true,
            },
          });
        }
      });
    }
    if (published > 0) {
      this.logger.log({ published }, 'Published scheduled entries');
    }
    return published;
  }

  /** Permanently deletes entries that have been in the trash longer than the retention period. */
  async purgeTrash(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.content.trashRetentionDays * 86_400_000);
    let deleted = 0;
    // Leaves first: an entry is only purged once it has no children left.
    for (let round = 0; round < 20; round += 1) {
      const batch = await this.prisma.entry.findMany({
        where: { trashedAt: { lt: cutoff }, children: { none: {} } },
        select: { id: true, title: true },
        take: 200,
      });
      if (batch.length === 0) break;
      for (const entry of batch) {
        await this.prisma.$transaction(async (tx) => {
          await tx.entry.delete({ where: { id: entry.id } });
          await this.audit.record(tx, {
            action: 'entry.deleted',
            targetType: 'entry',
            targetId: entry.id,
            metadata: { title: entry.title.slice(0, 200), reason: 'trash_retention' },
          });
        });
        deleted += 1;
      }
    }
    if (deleted > 0) {
      this.logger.log({ deleted }, 'Purged entries from the trash');
    }
    return deleted;
  }

  // ---------------------------------------------------------------------------- helpers

  private async loadViewable(auth: AuthContext, id: string): Promise<EntryRow> {
    const row = await this.prisma.entry.findFirst({
      where: { id, siteId: auth.siteId },
      include: entryInclude,
    });
    if (!row || !canView(actorOf(auth), this.facts(row))) {
      throw NOT_FOUND();
    }
    return row;
  }

  private facts(row: { authorId: string; status: EntryStatus; trashedAt: Date | null }) {
    return { authorId: row.authorId, status: row.status, trashed: row.trashedAt !== null };
  }

  private contentOf(row: EntryRow): EntryContent {
    return {
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt,
      body: richTextDocumentSchema.parse(row.body),
      fields: row.fields as FieldValues,
      termIds: row.terms.map((link) => link.term.id),
      featuredMediaId: row.featuredMediaId,
      parentId: row.parentId,
      editor: row.editor === 'builder' ? 'builder' : 'rich_text',
      builder:
        row.builder === null ? null : (builderDocumentSchema.safeParse(row.builder).data ?? null),
    };
  }

  /** Validates content against the type definition and the site's terms, media and entries. */
  private async validateContent(
    siteId: string,
    type: ContentTypeDefinition,
    actor: PolicyActor,
    previousBuilder: BuilderDocument | null,
    input: Omit<EntryContent, 'fields'> & { fields: Record<string, unknown> },
  ): Promise<EntryContent> {
    if (input.editor === 'builder' && !type.hasBuilder) {
      throw invalid('editor', 'This content type does not use the visual builder.');
    }
    // Switching to the builder without a document starts from the existing rich-text body.
    const builder =
      input.editor === 'builder' && input.builder === null
        ? builderDocumentSchema.parse(builderFromRichText(input.body))
        : input.builder;
    if (builder) {
      const before = htmlEmbeds(previousBuilder);
      const changed = [...htmlEmbeds(builder)].some(([id, html]) => before.get(id) !== html);
      if (changed && !actor.capabilities.has('content.embed_html')) {
        throw new ApiException(
          403,
          'FORBIDDEN',
          'You do not have permission to add or change HTML embeds.',
        );
      }
      const mediaIds = builderMediaIds(builder);
      if (mediaIds.length > 0) {
        const found = await this.prisma.media.count({
          where: { id: { in: mediaIds }, siteId, mimeType: { startsWith: 'image/' } },
        });
        if (found !== mediaIds.length) {
          throw invalid('builder', 'An image in the layout no longer exists in the media library.');
        }
      }
    }
    const fields = buildFieldValuesSchema(type.fields).safeParse(input.fields);
    if (!fields.success) {
      throw new ApiException(
        422,
        'VALIDATION_FAILED',
        'The request contains invalid data.',
        fields.error.issues.map((issue) => ({
          path: ['fields', ...issue.path.map(String)].join('.'),
          message: issue.message,
        })),
      );
    }
    const termIds = [...new Set(input.termIds)];
    if (termIds.length > 0) {
      const valid = await this.prisma.term.count({
        where: { id: { in: termIds }, siteId, taxonomyId: { in: [...type.taxonomyIds] } },
      });
      if (valid !== termIds.length) {
        throw invalid(
          'termIds',
          'One or more terms do not exist or do not apply to this content type.',
        );
      }
    }
    if (input.featuredMediaId !== null) {
      if (!type.hasFeaturedImage) {
        throw invalid('featuredMediaId', 'This content type has no featured image.');
      }
      const media = await this.prisma.media.findFirst({
        where: { id: input.featuredMediaId, siteId },
        select: { mimeType: true },
      });
      if (!media?.mimeType.startsWith('image/')) {
        throw invalid('featuredMediaId', 'Choose an image from the media library.');
      }
    }
    const mediaFieldIds = type.fields
      .filter((field) => field.type === 'media')
      .map((field) => fields.data[field.key])
      .filter((value): value is string => typeof value === 'string');
    if (mediaFieldIds.length > 0) {
      const found = await this.prisma.media.count({ where: { id: { in: mediaFieldIds }, siteId } });
      if (found !== new Set(mediaFieldIds).size) {
        throw invalid('fields', 'A media field refers to a file that does not exist.');
      }
    }
    if (input.parentId !== null && !type.hierarchical) {
      throw invalid('parentId', 'Entries of this type cannot have a parent.');
    }
    return {
      title: input.title,
      slug: input.slug,
      excerpt: type.hasExcerpt ? input.excerpt : '',
      body: type.hasBody ? input.body : EMPTY_RICH_TEXT,
      fields: fields.data,
      termIds,
      featuredMediaId: input.featuredMediaId,
      parentId: input.parentId,
      editor: input.editor,
      builder,
    };
  }

  private assertTitleForStatus(title: string, status: EntryStatus): void {
    if (status !== 'draft' && title.trim() === '') {
      throw invalid('title', 'Add a title before submitting, scheduling or publishing.');
    }
  }

  private resolvePublishedAt(
    status: EntryStatus,
    requested: string | null | undefined,
    current: Date | null,
  ): Date | null {
    const now = Date.now();
    const requestedDate = requested ? new Date(requested) : null;
    switch (status) {
      case 'scheduled':
        if (!requestedDate || requestedDate.getTime() <= now) {
          throw invalid('publishedAt', 'Choose a future date and time to schedule publication.');
        }
        return requestedDate;
      case 'published':
        if (requestedDate) {
          if (requestedDate.getTime() > now + 60_000) {
            throw invalid('publishedAt', 'For a future date, schedule the entry instead.');
          }
          return requestedDate;
        }
        return current && current.getTime() <= now ? current : new Date(now);
      case 'draft':
      case 'pending':
        return requested === undefined ? current : requestedDate;
    }
  }

  /** Path of the new parent (or null at the root), refusing cycles, other types and trashed parents. */
  private async parentPath(
    db: DbClient,
    siteId: string,
    type: ContentTypeDefinition,
    parentId: string | null,
    self: { id: string; path: string } | null,
  ): Promise<string | null> {
    if (parentId === null) {
      return null;
    }
    const parent = await db.entry.findFirst({
      where: { id: parentId, siteId, contentTypeId: type.id },
      select: { id: true, path: true, trashedAt: true },
    });
    if (!parent) {
      throw invalid('parentId', `The parent must be another ${type.name.toLowerCase()}.`);
    }
    if (parent.trashedAt) {
      throw invalid('parentId', 'Choose a parent that is not in the trash.');
    }
    if (self && (parent.id === self.id || parent.path.startsWith(`${self.path}/`))) {
      throw invalid(
        'parentId',
        'An entry cannot be placed under itself or one of its descendants.',
      );
    }
    return parent.path;
  }

  /**
   * Slugs a root-level entry of a root type (a page directly under "/") cannot use: application paths
   * and the route prefixes of content types and taxonomies. Empty for every other entry.
   */
  private async reservedRootSlugs(
    db: DbClient,
    type: ContentTypeDefinition,
    parentPath: string | null,
  ): Promise<Map<string, string>> {
    const reserved = new Map<string, string>();
    if (type.routePrefix !== '' || parentPath !== null) {
      return reserved;
    }
    for (const segment of RESERVED_ROUTE_SEGMENTS) {
      reserved.set(segment, 'This address is reserved by the application.');
    }
    const [types, taxonomies] = await Promise.all([
      db.contentType.findMany({
        where: { routePrefix: { not: '' } },
        select: { routePrefix: true, name: true },
      }),
      db.taxonomy.findMany({ select: { routePrefix: true, name: true } }),
    ]);
    for (const item of [...types, ...taxonomies]) {
      reserved.set(
        item.routePrefix,
        `"/${item.routePrefix}" is the address of ${item.name}. Choose another slug.`,
      );
    }
    return reserved;
  }

  private assertSlugNotReserved(slug: string, reserved: ReadonlyMap<string, string>): void {
    const message = reserved.get(slug);
    if (message !== undefined) {
      throw invalid('slug', message);
    }
  }

  /** Redirects old → new public URLs for a moved published entry and its published descendants. */
  private async recordPathMoves(
    db: DbClient,
    siteId: string,
    type: ContentTypeDefinition,
    oldPath: string,
    newPath: string,
  ): Promise<void> {
    const descendants = await db.entry.findMany({
      where: {
        siteId,
        contentTypeId: type.id,
        path: { startsWith: `${newPath}/` },
        status: 'published',
        trashedAt: null,
      },
      select: { path: true },
    });
    const moves: PathMove[] = [
      {
        from: publicEntryPath(type.routePrefix, oldPath),
        to: publicEntryPath(type.routePrefix, newPath),
      },
      ...descendants.map((entry) => ({
        from: publicEntryPath(type.routePrefix, oldPath + entry.path.slice(newPath.length)),
        to: publicEntryPath(type.routePrefix, entry.path),
      })),
    ];
    await this.redirects.recordMoves(db, siteId, moves);
  }

  private joinPath(parentPath: string | null, slug: string): string {
    const path = parentPath === null ? slug : `${parentPath}/${slug}`;
    if (path.length > MAX_PATH_LENGTH) {
      throw invalid('parentId', 'The page hierarchy is too deep.');
    }
    return path;
  }

  private async assertPathFree(
    db: DbClient,
    siteId: string,
    contentTypeId: string,
    path: string,
    exceptId: string | null,
    field: 'slug' | 'parentId',
  ): Promise<void> {
    const clash = await db.entry.findFirst({
      where: { siteId, contentTypeId, path, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { trashedAt: true },
    });
    if (clash) {
      throw invalid(
        field,
        clash.trashedAt
          ? 'An entry in the trash uses this slug at the same level. Change the slug or delete that entry.'
          : 'Another entry uses this slug at the same level.',
      );
    }
  }

  private async uniqueSlug(
    db: DbClient,
    siteId: string,
    contentTypeId: string,
    parentPath: string | null,
    title: string,
    reserved: ReadonlyMap<string, string>,
  ): Promise<string> {
    const base = slugify(title) || 'untitled';
    const prefix = parentPath === null ? '' : `${parentPath}/`;
    const taken = new Set([
      ...reserved.keys(),
      ...(
        await db.entry.findMany({
          where: { siteId, contentTypeId, path: { startsWith: `${prefix}${base}` } },
          select: { path: true },
        })
      ).map((row) => row.path.slice(prefix.length)),
    ]);
    if (!taken.has(base)) return base;
    for (let n = 2; ; n += 1) {
      const candidate = `${base.slice(0, 190).replace(/-+$/, '')}-${String(n)}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /** Maps a unique-path race (two writers claiming the same path at once) to a validation error. */
  private async withUniquePath<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw invalid('slug', 'Another entry uses this slug at the same level.');
      }
      throw error;
    }
  }

  private async recordRevision(
    db: DbClient,
    entryId: string,
    authorId: string,
    entryVersion: number,
    content: EntryContent,
  ): Promise<void> {
    const snapshot: RevisionSnapshot = { ...content, fields: content.fields };
    await db.entryRevision.create({
      data: {
        entryId,
        authorId,
        entryVersion,
        title: content.title,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
    // Keep only the newest revisions.
    await db.$executeRaw`
      DELETE FROM entry_revisions
       WHERE entry_id = ${entryId}::uuid
         AND id NOT IN (SELECT id FROM entry_revisions WHERE entry_id = ${entryId}::uuid
                         ORDER BY created_at DESC, id DESC LIMIT ${this.config.content.revisionLimit}::integer)`;
  }

  private async auditTransition(
    db: DbClient,
    auth: AuthContext,
    entryId: string,
    type: ContentTypeDefinition,
    title: string,
    from: EntryStatus | null,
    to: EntryStatus,
    meta: RequestMeta,
  ): Promise<void> {
    let action: string | null = null;
    if (to === 'published') action = 'entry.published';
    else if (to === 'scheduled') action = 'entry.scheduled';
    else if (from !== null && LIVE.includes(from)) action = 'entry.unpublished';
    if (action === null) return;
    await this.audit.record(db, {
      action,
      actorUserId: auth.userId,
      targetType: 'entry',
      targetId: entryId,
      request: meta,
      metadata: { type: type.key, title: title.slice(0, 200), ...(from ? { from } : {}) },
    });
  }

  private toSummary(row: EntryRow, actor: PolicyActor): EntrySummary {
    const media = row.featuredMedia;
    return {
      id: row.id,
      contentTypeId: row.contentTypeId,
      title: row.title,
      slug: row.slug,
      path: row.path,
      url: row.contentType.isPublic ? publicEntryPath(row.contentType.routePrefix, row.path) : null,
      status: row.status,
      trashedAt: row.trashedAt?.toISOString() ?? null,
      parentId: row.parentId,
      author: row.author,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
      terms: row.terms.map((link) => link.term),
      featuredMedia: media
        ? {
            id: media.id,
            url: this.mediaUrls.url(media.storageKey),
            thumbnailUrl: this.mediaUrls.bestUrl(
              media.storageKey,
              media.variants as unknown as StoredVariant[],
              320,
            ),
            altText: media.altText,
            width: media.width,
            height: media.height,
          }
        : null,
      permissions: permissionsFor(actor, this.facts(row)),
    };
  }

  private toDetail(row: EntryRow, actor: PolicyActor): EntryDetail {
    const content = this.contentOf(row);
    return {
      ...this.toSummary(row, actor),
      excerpt: content.excerpt,
      body: content.body,
      fields: content.fields,
      termIds: content.termIds,
      lastEditor: row.lastEditor,
      seo: seoOf(row.seo),
      editor: content.editor,
      builder: content.builder,
    };
  }
}
