import { z } from 'zod';
import { paginatedSchema, uuidSchema } from './common.js';
import { fieldDefinitionsSchema, slugSchema } from './fields.js';

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
