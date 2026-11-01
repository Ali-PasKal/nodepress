import { z } from 'zod';
import { isoDateTimeSchema, paginatedSchema, paginationQuerySchema, uuidSchema } from './common.js';
import { RESERVED_ROUTE_SEGMENTS } from './content-model.js';

// ---------------------------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------------------------

export const REDIRECT_STATUS_CODES = [301, 302, 307, 308] as const;
export const REDIRECT_SOURCES = ['auto', 'manual'] as const;

/** Paths the site runtime answers itself; redirects from them would never apply. */
const RUNTIME_FILES = new Set(['robots.txt', 'sitemap.xml', 'feed.xml', 'favicon.ico']);
// Whitespace, control characters and backslashes are never part of a redirect path.
// eslint-disable-next-line no-control-regex
const UNSAFE_PATH_CHARS = /[\s\u0000-\u001f\u007f\\]/;

function decodeSegments(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

/** Why a path cannot be the source of a redirect, or null when it can. */
export function redirectSourceProblem(path: string): string | null {
  if (!path.startsWith('/') || path === '/') {
    return 'Use a path on this site that starts with "/" (not the home page).';
  }
  if (path.startsWith('//') || path.includes('//')) {
    return 'The path cannot contain "//".';
  }
  if (path.includes('?') || path.includes('#')) {
    return 'Leave out the query string and fragment.';
  }
  if (UNSAFE_PATH_CHARS.test(path)) {
    return 'The path cannot contain spaces, control characters or backslashes.';
  }
  const first = path.slice(1).split('/')[0] ?? '';
  if (
    (RESERVED_ROUTE_SEGMENTS as readonly string[]).includes(first) ||
    first.startsWith('_') ||
    RUNTIME_FILES.has(first)
  ) {
    return 'This address is reserved by the application.';
  }
  return null;
}

/**
 * Source path of a redirect, stored decoded ("/über-uns", not "/%C3%BCber-uns") and without a trailing
 * slash, which is how the site runtime looks paths up.
 */
export const redirectSourceSchema = z
  .string()
  .trim()
  .max(2_000)
  .transform((value) => decodeSegments(value).replace(/(.)\/+$/, '$1'))
  .superRefine((value, ctx) => {
    const problem = redirectSourceProblem(value);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

/** Redirect targets: a path on this site (query and fragment allowed) or an absolute http(s) URL. */
export function isSafeRedirectTarget(value: string): boolean {
  if (value.length === 0 || value.length > 2_048 || UNSAFE_PATH_CHARS.test(value)) {
    return false;
  }
  if (value.startsWith('/')) {
    return !value.startsWith('//');
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

export const redirectTargetSchema = z.string().trim().max(2_048).refine(isSafeRedirectTarget, {
  message: 'Use a path on this site ("/new-page") or an http(s) URL.',
});

const statusCodeSchema = z.literal(REDIRECT_STATUS_CODES);

export const redirectSchema = z.object({
  id: uuidSchema,
  fromPath: z.string(),
  toPath: z.string(),
  statusCode: statusCodeSchema,
  source: z.enum(REDIRECT_SOURCES),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type RedirectInfo = z.infer<typeof redirectSchema>;

export const createRedirectSchema = z
  .object({
    fromPath: redirectSourceSchema,
    toPath: redirectTargetSchema,
    statusCode: statusCodeSchema.default(301),
  })
  .refine((value) => value.fromPath !== value.toPath, {
    path: ['toPath'],
    message: 'A redirect cannot point to itself.',
  });
export type CreateRedirectInput = z.input<typeof createRedirectSchema>;

export const updateRedirectSchema = z
  .object({
    fromPath: redirectSourceSchema,
    toPath: redirectTargetSchema,
    statusCode: statusCodeSchema,
  })
  .partial();
export type UpdateRedirectInput = z.input<typeof updateRedirectSchema>;

export const redirectListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  source: z.enum(REDIRECT_SOURCES).optional(),
});
export type RedirectListQuery = z.input<typeof redirectListQuerySchema>;

export const redirectListResponseSchema = paginatedSchema(redirectSchema);
export type RedirectListResponse = z.infer<typeof redirectListResponseSchema>;
