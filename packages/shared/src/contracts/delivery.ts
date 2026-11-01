import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';
import { FIELD_TYPES } from './fields.js';
import { richTextDocumentSchema } from './rich-text.js';

// ---------------------------------------------------------------------------------------------
// Public URLs
// ---------------------------------------------------------------------------------------------

/** Public path of an entry: "/{prefix}/{path}", or "/{path}" for root types (pages). */
export function publicEntryPath(routePrefix: string, entryPath: string): string {
  return routePrefix === '' ? `/${entryPath}` : `/${routePrefix}/${entryPath}`;
}

/** Public path of a term archive ("/category/news"). */
export function publicTermPath(routePrefix: string, slug: string): string {
  return `/${routePrefix}/${slug}`;
}

/** Public path of a content type archive ("/blog"). */
export function publicArchivePath(routePrefix: string): string {
  return `/${routePrefix}`;
}

/** Percent-encodes a site path for use in an HTTP header or an absolute URL (keeps "/" separators). */
export function encodeSitePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

// ---------------------------------------------------------------------------------------------
// Delivery API (public, read-only, published content only)
// ---------------------------------------------------------------------------------------------

export const deliveryMediaSchema = z.object({
  id: uuidSchema,
  /** Original file. */
  url: z.string(),
  mimeType: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  altText: z.string(),
  caption: z.string(),
  /** Resized WebP variants, narrowest first (empty until the variants job has run, or for non-images). */
  sources: z.array(
    z.object({ url: z.string(), width: z.number().int(), height: z.number().int() }),
  ),
});
export type DeliveryMedia = z.infer<typeof deliveryMediaSchema>;

export interface DeliveryMenuItem {
  label: string;
  url: string;
  openInNewTab: boolean;
  children: DeliveryMenuItem[];
}
export const deliveryMenuItemSchema: z.ZodType<DeliveryMenuItem> = z.object({
  label: z.string(),
  url: z.string(),
  openInNewTab: z.boolean(),
  get children() {
    return z.array(deliveryMenuItemSchema);
  },
});

export const deliverySiteSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  /** Public base URL without a trailing slash ("https://example.com"). */
  baseUrl: z.string(),
  language: z.string(),
  direction: z.enum(['ltr', 'rtl']),
  seo: z.object({
    titleTemplate: z.string(),
    defaultDescription: z.string(),
    defaultImage: deliveryMediaSchema.nullable(),
    indexing: z.boolean(),
  }),
  theme: z.object({
    key: z.string(),
    settings: z.record(z.string(), z.union([z.string(), z.boolean(), z.null()])),
    /** Media chosen in the theme's media settings, keyed by setting key. */
    media: z.record(z.string(), deliveryMediaSchema),
  }),
  /** Menus by theme location; items whose target is not public are left out. */
  menus: z.record(z.string(), z.array(deliveryMenuItemSchema)),
});
export type DeliverySite = z.infer<typeof deliverySiteSchema>;

export const deliveryTermRefSchema = z.object({
  taxonomy: z.string(),
  taxonomyName: z.string(),
  name: z.string(),
  slug: z.string(),
  /** Null when the taxonomy is not public. */
  url: z.string().nullable(),
});
export type DeliveryTermRef = z.infer<typeof deliveryTermRefSchema>;

const deliveryTypeRefSchema = z.object({
  key: z.string(),
  name: z.string(),
  pluralName: z.string(),
  hierarchical: z.boolean(),
});

/** An entry as it appears in listings. */
export const deliveryEntryCardSchema = z.object({
  id: uuidSchema,
  type: z.string(),
  title: z.string(),
  url: z.string(),
  /** The excerpt, or the start of the body text when the excerpt is empty. */
  summary: z.string(),
  publishedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  author: z.object({ displayName: z.string() }),
  featuredMedia: deliveryMediaSchema.nullable(),
  terms: z.array(deliveryTermRefSchema),
});
export type DeliveryEntryCard = z.infer<typeof deliveryEntryCardSchema>;

export const deliveryFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(FIELD_TYPES),
  value: z.union([z.string(), z.number(), z.boolean()]),
  /** Human-readable value (the option label for choices). Media fields are resolved in `media`. */
  display: z.string(),
});
export type DeliveryField = z.infer<typeof deliveryFieldSchema>;

export const deliveryEntrySchema = deliveryEntryCardSchema.extend({
  contentType: deliveryTypeRefSchema,
  slug: z.string(),
  /** Absolute canonical URL. */
  canonicalUrl: z.string(),
  excerpt: z.string(),
  body: richTextDocumentSchema,
  /** Public custom fields with a value, in definition order. */
  fields: z.array(deliveryFieldSchema),
  /** Media referenced by the body and by media fields, keyed by id. */
  media: z.record(z.string(), deliveryMediaSchema),
  seo: z.object({ title: z.string(), description: z.string(), noindex: z.boolean() }),
});
export type DeliveryEntry = z.infer<typeof deliveryEntrySchema>;

export const deliveryListingSchema = z.object({
  items: z.array(deliveryEntryCardSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export type DeliveryListing = z.infer<typeof deliveryListingSchema>;

export const deliveryArchiveSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content_type'), contentType: deliveryTypeRefSchema }),
  z.object({
    type: z.literal('term'),
    taxonomy: z.object({ key: z.string(), name: z.string(), pluralName: z.string() }),
    term: z.object({ name: z.string(), slug: z.string(), description: z.string() }),
  }),
]);
export type DeliveryArchive = z.infer<typeof deliveryArchiveSchema>;

export const deliveryRouteSchema = z.discriminatedUnion('kind', [
  /** Home page: the latest posts (`listing`) or a static page (`entry`). */
  z.object({
    kind: z.literal('home'),
    canonicalUrl: z.string(),
    listing: deliveryListingSchema.nullable(),
    entry: deliveryEntrySchema.nullable(),
  }),
  z.object({ kind: z.literal('entry'), entry: deliveryEntrySchema }),
  z.object({
    kind: z.literal('archive'),
    canonicalUrl: z.string(),
    archive: deliveryArchiveSchema,
    listing: deliveryListingSchema,
  }),
  z.object({
    kind: z.literal('redirect'),
    /** Site path (percent-encoded) or absolute URL. */
    location: z.string(),
    statusCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]),
  }),
  z.object({ kind: z.literal('not_found') }),
]);
export type DeliveryRoute = z.infer<typeof deliveryRouteSchema>;

export const deliveryPageSchema = z.object({
  site: deliverySiteSchema,
  route: deliveryRouteSchema,
  /** True for preview links: never cache, never index. */
  preview: z.boolean(),
});
export type DeliveryPage = z.infer<typeof deliveryPageSchema>;

export const DELIVERY_PATH_MAX_LENGTH = 2_000;

export const deliveryPageQuerySchema = z.object({
  /** Decoded site path ("/blog/hello"). */
  path: z
    .string()
    .max(DELIVERY_PATH_MAX_LENGTH)
    .refine((value) => value.startsWith('/'), { message: 'The path must start with "/".' }),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export const PREVIEW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const deliverySitemapSchema = z.object({
  baseUrl: z.string(),
  indexing: z.boolean(),
  urls: z.array(z.object({ path: z.string(), lastModified: isoDateTimeSchema.nullable() })),
  /** True when the site has more URLs than one sitemap holds (50 000). */
  truncated: z.boolean(),
});
export type DeliverySitemap = z.infer<typeof deliverySitemapSchema>;

export const deliveryFeedSchema = z.object({
  site: deliverySiteSchema.pick({ name: true, tagline: true, baseUrl: true, language: true }),
  items: z.array(deliveryEntryCardSchema),
});
export type DeliveryFeed = z.infer<typeof deliveryFeedSchema>;
