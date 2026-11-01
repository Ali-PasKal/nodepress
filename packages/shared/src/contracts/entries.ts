import { z } from 'zod';
import { isoDateTimeSchema, paginatedSchema, paginationQuerySchema, uuidSchema } from './common.js';
import { slugSchema } from './fields.js';
import { richTextDocumentSchema } from './rich-text.js';

// ---------------------------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------------------------

export const ENTRY_STATUSES = ['draft', 'pending', 'scheduled', 'published'] as const;
export const entryStatusSchema = z.enum(ENTRY_STATUSES);
export type EntryStatus = z.infer<typeof entryStatusSchema>;

const personSchema = z.object({ id: uuidSchema, displayName: z.string() });

export const entryMediaRefSchema = z.object({
  id: uuidSchema,
  url: z.string(),
  thumbnailUrl: z.string(),
  altText: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type EntryMediaRef = z.infer<typeof entryMediaRefSchema>;

/** What the signed-in user may do with an entry, computed by the server's content policy. */
export const entryPermissionsSchema = z.object({
  edit: z.boolean(),
  publish: z.boolean(),
  trash: z.boolean(),
  restore: z.boolean(),
  delete: z.boolean(),
});
export type EntryPermissions = z.infer<typeof entryPermissionsSchema>;

/** Per-entry SEO overrides (empty values fall back to the title, excerpt and site defaults). */
export const entrySeoSchema = z.object({
  title: z.string().trim().max(200).default(''),
  description: z.string().trim().max(320).default(''),
  noindex: z.boolean().default(false),
});
export type EntrySeo = z.output<typeof entrySeoSchema>;

export const entrySummarySchema = z.object({
  id: uuidSchema,
  contentTypeId: uuidSchema,
  title: z.string(),
  slug: z.string(),
  path: z.string(),
  /** Public URL path ("/blog/hello"), or null when the content type is not public. */
  url: z.string().nullable(),
  status: entryStatusSchema,
  trashedAt: isoDateTimeSchema.nullable(),
  parentId: uuidSchema.nullable(),
  author: personSchema,
  publishedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  version: z.number().int().positive(),
  terms: z.array(z.object({ id: uuidSchema, taxonomyId: uuidSchema, name: z.string() })),
  featuredMedia: entryMediaRefSchema.nullable(),
  permissions: entryPermissionsSchema,
});
export type EntrySummary = z.infer<typeof entrySummarySchema>;

export const entryDetailSchema = entrySummarySchema.extend({
  excerpt: z.string(),
  body: richTextDocumentSchema,
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  termIds: z.array(uuidSchema),
  lastEditor: personSchema.nullable(),
  seo: entrySeoSchema,
});
export type EntryDetail = z.infer<typeof entryDetailSchema>;

export const ENTRY_LIST_STATUSES = ['all', ...ENTRY_STATUSES, 'trash'] as const;
export const entryListQuerySchema = paginationQuerySchema.extend({
  type: z.string().trim().min(1).max(32),
  /** "all" excludes trashed entries. */
  status: z.enum(ENTRY_LIST_STATUSES).default('all'),
  search: z.string().trim().max(200).optional(),
  authorId: uuidSchema.optional(),
  termId: uuidSchema.optional(),
  sort: z.enum(['updated', 'published', 'title']).default('updated'),
});
export type EntryListQuery = z.input<typeof entryListQuerySchema>;

export const entryListResponseSchema = paginatedSchema(entrySummarySchema).extend({
  /** Entries per status tab among those the user may see (same filters except status). */
  counts: z.object({
    all: z.number().int().nonnegative(),
    draft: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    scheduled: z.number().int().nonnegative(),
    published: z.number().int().nonnegative(),
    trash: z.number().int().nonnegative(),
  }),
});
export type EntryListResponse = z.infer<typeof entryListResponseSchema>;

const titleSchema = z.string().trim().max(300, { message: 'Use at most 300 characters.' });
const fieldValuesInput = z.record(z.string(), z.unknown());

export const createEntrySchema = z.object({
  type: z.string().trim().min(1).max(32),
  title: titleSchema.default(''),
  slug: slugSchema.optional(),
  excerpt: z.string().trim().max(1_000).default(''),
  body: richTextDocumentSchema.optional(),
  fields: fieldValuesInput.default({}),
  parentId: uuidSchema.nullable().default(null),
  termIds: z.array(uuidSchema).max(200).default([]),
  featuredMediaId: uuidSchema.nullable().default(null),
  status: entryStatusSchema.default('draft'),
  publishedAt: isoDateTimeSchema.nullable().optional(),
  seo: entrySeoSchema.optional(),
});
export type CreateEntryInput = z.input<typeof createEntrySchema>;

/** Partial update guarded by `version` (optimistic concurrency). */
export const updateEntrySchema = z.object({
  version: z.number().int().positive(),
  title: titleSchema.optional(),
  slug: slugSchema.optional(),
  excerpt: z.string().trim().max(1_000).optional(),
  body: richTextDocumentSchema.optional(),
  fields: fieldValuesInput.optional(),
  parentId: uuidSchema.nullable().optional(),
  termIds: z.array(uuidSchema).max(200).optional(),
  featuredMediaId: uuidSchema.nullable().optional(),
  status: entryStatusSchema.optional(),
  publishedAt: isoDateTimeSchema.nullable().optional(),
  seo: entrySeoSchema.optional(),
});
export type UpdateEntryInput = z.input<typeof updateEntrySchema>;

export const ENTRY_BULK_ACTIONS = ['trash', 'restore', 'delete', 'publish', 'draft'] as const;
export const entryBulkSchema = z.object({
  action: z.enum(ENTRY_BULK_ACTIONS),
  ids: z.array(uuidSchema).min(1).max(100),
});
export type EntryBulkInput = z.input<typeof entryBulkSchema>;

export const entryBulkResponseSchema = z.object({
  succeeded: z.array(uuidSchema),
  failed: z.array(z.object({ id: uuidSchema, message: z.string() })),
});
export type EntryBulkResponse = z.infer<typeof entryBulkResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------------------------

export const revisionSummarySchema = z.object({
  id: uuidSchema,
  entryVersion: z.number().int().positive(),
  title: z.string(),
  author: personSchema,
  createdAt: isoDateTimeSchema,
});
export type RevisionSummary = z.infer<typeof revisionSummarySchema>;

export const revisionSnapshotSchema = z.object({
  title: z.string(),
  slug: z.string(),
  excerpt: z.string(),
  body: richTextDocumentSchema,
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  termIds: z.array(uuidSchema),
  featuredMediaId: uuidSchema.nullable(),
  parentId: uuidSchema.nullable(),
});
export type RevisionSnapshot = z.infer<typeof revisionSnapshotSchema>;

export const revisionDetailSchema = revisionSummarySchema.extend({
  snapshot: revisionSnapshotSchema,
});
export type RevisionDetail = z.infer<typeof revisionDetailSchema>;

export const restoreRevisionSchema = z.object({ version: z.number().int().positive() });

export const previewLinkSchema = z.object({
  /** Absolute URL of the preview on the public site. */
  url: z.string(),
  expiresAt: isoDateTimeSchema,
});
export type PreviewLink = z.infer<typeof previewLinkSchema>;
