import { z } from 'zod';
import { isoDateTimeSchema, paginatedSchema, paginationQuerySchema, uuidSchema } from './common.js';
import { fieldDefinitionsSchema, slugSchema } from './fields.js';
import { richTextDocumentSchema } from './rich-text.js';

// ---------------------------------------------------------------------------------------------
// Content types and taxonomies (instance-wide definitions)
// ---------------------------------------------------------------------------------------------

const definitionKey = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,31}$/, {
    message: 'Use 2–32 lower-case letters, digits or underscores, starting with a letter.',
  });
const label = z.string().trim().min(1, { message: 'Name is required.' }).max(100);
const description = z.string().trim().max(500);

export const contentTypeSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  name: z.string(),
  pluralName: z.string(),
  description: z.string(),
  hierarchical: z.boolean(),
  hasBody: z.boolean(),
  hasExcerpt: z.boolean(),
  hasFeaturedImage: z.boolean(),
  isSystem: z.boolean(),
  fields: fieldDefinitionsSchema,
  taxonomyIds: z.array(uuidSchema),
  entryCount: z.number().int().nonnegative(),
});
export type ContentTypeInfo = z.infer<typeof contentTypeSchema>;

export const createContentTypeSchema = z.object({
  key: definitionKey,
  name: label,
  pluralName: label,
  description: description.default(''),
  hierarchical: z.boolean().default(false),
  hasBody: z.boolean().default(true),
  hasExcerpt: z.boolean().default(true),
  hasFeaturedImage: z.boolean().default(true),
  fields: fieldDefinitionsSchema.default([]),
  taxonomyIds: z.array(uuidSchema).max(20).default([]),
});
export type CreateContentTypeInput = z.input<typeof createContentTypeSchema>;

export const updateContentTypeSchema = createContentTypeSchema.omit({ key: true }).partial();
export type UpdateContentTypeInput = z.input<typeof updateContentTypeSchema>;

export const taxonomySchema = z.object({
  id: uuidSchema,
  key: z.string(),
  name: z.string(),
  pluralName: z.string(),
  description: z.string(),
  hierarchical: z.boolean(),
  isSystem: z.boolean(),
  contentTypeIds: z.array(uuidSchema),
  termCount: z.number().int().nonnegative(),
});
export type TaxonomyInfo = z.infer<typeof taxonomySchema>;

export const createTaxonomySchema = z.object({
  key: definitionKey,
  name: label,
  pluralName: label,
  description: description.default(''),
  hierarchical: z.boolean().default(false),
  contentTypeIds: z.array(uuidSchema).max(50).default([]),
});
export type CreateTaxonomyInput = z.input<typeof createTaxonomySchema>;

export const updateTaxonomySchema = createTaxonomySchema
  .omit({ key: true, hierarchical: true })
  .partial();
export type UpdateTaxonomyInput = z.input<typeof updateTaxonomySchema>;

export const contentModelResponseSchema = z.object({
  contentTypes: z.array(contentTypeSchema),
  taxonomies: z.array(taxonomySchema),
});
export type ContentModelResponse = z.infer<typeof contentModelResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------------------------

export const termSchema = z.object({
  id: uuidSchema,
  taxonomyId: uuidSchema,
  parentId: uuidSchema.nullable(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  entryCount: z.number().int().nonnegative(),
});
export type TermInfo = z.infer<typeof termSchema>;

export const termListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});
export const termListResponseSchema = paginatedSchema(termSchema);
export type TermListResponse = z.infer<typeof termListResponseSchema>;

export const createTermSchema = z.object({
  name: z.string().trim().min(1, { message: 'Name is required.' }).max(200),
  slug: slugSchema.optional(),
  parentId: uuidSchema.nullable().default(null),
  description: z.string().trim().max(1_000).default(''),
});
export type CreateTermInput = z.input<typeof createTermSchema>;

export const updateTermSchema = createTermSchema.partial();
export type UpdateTermInput = z.input<typeof updateTermSchema>;

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

export const entrySummarySchema = z.object({
  id: uuidSchema,
  contentTypeId: uuidSchema,
  title: z.string(),
  slug: z.string(),
  path: z.string(),
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
