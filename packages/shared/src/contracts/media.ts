import { z } from 'zod';
import { isoDateTimeSchema, paginatedSchema, paginationQuerySchema, uuidSchema } from './common.js';

export const MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const;
export const mediaKindSchema = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof mediaKindSchema>;

export const mediaVariantSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  url: z.string(),
});
export type MediaVariant = z.infer<typeof mediaVariantSchema>;

export const mediaItemSchema = z.object({
  id: uuidSchema,
  url: z.string(),
  /** Small preview for images (a variant when available); null for other kinds. */
  thumbnailUrl: z.string().nullable(),
  filename: z.string(),
  title: z.string(),
  altText: z.string(),
  caption: z.string(),
  mimeType: z.string(),
  kind: mediaKindSchema,
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  variants: z.array(mediaVariantSchema),
  uploader: z.object({ id: uuidSchema, displayName: z.string() }),
  createdAt: isoDateTimeSchema,
  permissions: z.object({ edit: z.boolean(), delete: z.boolean() }),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;

export const mediaDetailSchema = mediaItemSchema.extend({
  /** Entries that use this file as their featured image, in their body or in a media field. */
  usageCount: z.number().int().nonnegative(),
});
export type MediaDetail = z.infer<typeof mediaDetailSchema>;

export const mediaListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  kind: mediaKindSchema.optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export const mediaListResponseSchema = paginatedSchema(mediaItemSchema);
export type MediaListResponse = z.infer<typeof mediaListResponseSchema>;

export const updateMediaSchema = z.object({
  title: z.string().trim().min(1, { message: 'Title is required.' }).max(255).optional(),
  altText: z.string().trim().max(500).optional(),
  caption: z.string().trim().max(1_000).optional(),
});
export type UpdateMediaInput = z.input<typeof updateMediaSchema>;

/** Upload constraints, so clients can validate before sending. */
export const mediaLimitsSchema = z.object({
  maxUploadBytes: z.number().int().positive(),
  acceptedTypes: z.array(z.string()),
});
export type MediaLimits = z.infer<typeof mediaLimitsSchema>;
