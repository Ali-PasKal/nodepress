import { z } from 'zod';
import { isSafeLinkHref } from './rich-text.js';

// ---------------------------------------------------------------------------------------------
// Shortcodes
//
// WordPress-style placeholders such as `[button text="Buy" url="/shop"]` inside text. Only registered shortcodes
// exist; each declares a schema for its attributes. Nothing is ever executed: the API resolves the data a shortcode
// needs (posts, media) and themes render it with React components. Unknown or invalid shortcodes stay literal text,
// and `[[name]]` is an escaped, literal `[name]` — both as in WordPress.
// ---------------------------------------------------------------------------------------------

export interface ShortcodeToken {
  readonly type: 'shortcode';
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  /** The exact source text, shown when the shortcode cannot be rendered. */
  readonly raw: string;
}
export type ShortcodeSegment = { readonly type: 'text'; readonly text: string } | ShortcodeToken;

/** Texts longer than this are not scanned (rich-text nodes are much shorter in practice). */
const MAX_SCAN_LENGTH = 20_000;
const MAX_SHORTCODES_PER_TEXT = 50;

// `[name attr="v" attr='v' attr=v flag]`, optionally self-closed with `/]`, optionally escaped as `[[…]]`.
// Every repetition starts with whitespace followed by a name, so matching stays linear.
const SHORTCODE_PATTERN =
  /(\[?)\[([a-z][a-z0-9_]{0,31})((?:\s+[a-z][a-z0-9_-]{0,31}(?:=(?:"[^"\]\n]*"|'[^'\]\n]*'|[^\s"'\]]+))?){0,20})\s*\/?\](\]?)/g;
const ATTRIBUTE_PATTERN = /([a-z][a-z0-9_-]{0,31})(?:=(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g;

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const [, name = '', double, single, bare] = match;
    if (!(name in attrs)) attrs[name] = double ?? single ?? bare ?? '';
  }
  return attrs;
}

/** Splits text into literal text and shortcode tokens. Escaped shortcodes become literal text. */
export function parseShortcodes(text: string): ShortcodeSegment[] {
  if (!text.includes('[') || text.length > MAX_SCAN_LENGTH) return [{ type: 'text', text }];
  const segments: ShortcodeSegment[] = [];
  let cursor = 0;
  let count = 0;
  const pushText = (value: string) => {
    if (value === '') return;
    const last = segments.at(-1);
    if (last?.type === 'text')
      segments[segments.length - 1] = { type: 'text', text: last.text + value };
    else segments.push({ type: 'text', text: value });
  };
  for (const match of text.matchAll(SHORTCODE_PATTERN)) {
    const [raw, open = '', name = '', attrSource = '', close = ''] = match;
    const index = match.index;
    pushText(text.slice(cursor, index));
    cursor = index + raw.length;
    if (open === '[' && close === ']') {
      pushText(raw.slice(1, -1));
      continue;
    }
    if (open === '[') pushText('[');
    count += 1;
    if (count > MAX_SHORTCODES_PER_TEXT) {
      pushText(raw.slice(open.length, raw.length - close.length));
    } else {
      segments.push({
        type: 'shortcode',
        name,
        attrs: parseAttributes(attrSource),
        raw: raw.slice(open.length, raw.length - close.length),
      });
    }
    if (close === ']') pushText(']');
  }
  pushText(text.slice(cursor));
  return segments;
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

const booleanAttr = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
  .transform((value) => value === 'true' || value === '1' || value === 'yes' || value === '');
const intAttr = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d{1,4}$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
const slugAttr = z
  .string()
  .regex(/^[\p{Ll}\p{Lo}\p{Lm}\p{M}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{Lm}\p{M}\p{N}]+)*$/u);
const urlAttr = z.string().max(2_048).refine(isSafeLinkHref);
export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
export const VIMEO_ID_PATTERN = /^\d{6,12}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const shortcodeRegistry = {
  button: {
    label: 'Button',
    example: '[button text="Read more" url="/about"]',
    attrs: z.object({
      text: z.string().trim().min(1).max(100),
      url: urlAttr,
      style: z.enum(['primary', 'secondary', 'outline']).default('primary'),
      new_tab: booleanAttr.default(false),
    }),
  },
  recent_posts: {
    label: 'Recent posts',
    example: '[recent_posts count="3"]',
    attrs: z.object({
      count: intAttr(1, 12).default(3),
      type: z
        .string()
        .regex(/^[a-z][a-z0-9_]{1,31}$/)
        .default('post'),
      category: slugAttr.optional(),
      tag: slugAttr.optional(),
    }),
  },
  gallery: {
    label: 'Gallery',
    example: '[gallery ids="…,…" columns="3"]',
    attrs: z.object({
      ids: z
        .string()
        .transform((value) =>
          value
            .split(',')
            .map((id) => id.trim().toLowerCase())
            .filter(Boolean),
        )
        .pipe(z.array(z.string().regex(uuidPattern)).min(1).max(24)),
      columns: intAttr(1, 6).default(3),
    }),
  },
  video: {
    label: 'Video',
    example: '[video youtube="dQw4w9WgXcQ"]',
    attrs: z
      .object({
        youtube: z.string().regex(YOUTUBE_ID_PATTERN).optional(),
        vimeo: z.string().regex(VIMEO_ID_PATTERN).optional(),
        title: z.string().max(200).default('Video'),
      })
      .refine((value) => (value.youtube === undefined) !== (value.vimeo === undefined), {
        message: 'Give either a youtube or a vimeo id.',
      }),
  },
  site_name: { label: 'Site name', example: '[site_name]', attrs: z.object({}) },
  year: { label: 'Current year', example: '[year]', attrs: z.object({}) },
} as const;

export type ShortcodeName = keyof typeof shortcodeRegistry;
export const SHORTCODE_NAMES = Object.keys(shortcodeRegistry) as ShortcodeName[];
export type ShortcodeAttrs<Name extends ShortcodeName> = z.output<
  (typeof shortcodeRegistry)[Name]['attrs']
>;

export type ValidatedShortcode = {
  [Name in ShortcodeName]: {
    readonly name: Name;
    readonly attrs: ShortcodeAttrs<Name>;
    readonly key: string;
  };
}[ShortcodeName];

/** Stable key of a shortcode occurrence (name + sorted attributes), used to match resolved data. */
export function shortcodeKey(token: Pick<ShortcodeToken, 'name' | 'attrs'>): string {
  const attrs = Object.entries(token.attrs)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('&');
  return `${token.name}?${attrs}`;
}

/** The registered shortcode with parsed attributes, or the reason it cannot be rendered. */
export function validateShortcode(
  token: ShortcodeToken,
): { ok: true; value: ValidatedShortcode } | { ok: false; reason: string } {
  if (!(token.name in shortcodeRegistry)) {
    return { ok: false, reason: `Unknown shortcode "${token.name}".` };
  }
  const name = token.name as ShortcodeName;
  const unknown = Object.keys(token.attrs).filter(
    (attr) => !(attr in shortcodeRegistry[name].attrs.shape),
  );
  if (unknown.length > 0) {
    return { ok: false, reason: `Unknown attribute "${unknown[0] ?? ''}" for [${name}].` };
  }
  const parsed = shortcodeRegistry[name].attrs.safeParse(token.attrs);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    return {
      ok: false,
      reason: `Invalid ${field === undefined ? 'attributes' : `"${String(field)}"`} for [${name}]${issue ? `: ${issue.message}` : ''}.`,
    };
  }
  return {
    ok: true,
    value: { name, attrs: parsed.data, key: shortcodeKey(token) } as ValidatedShortcode,
  };
}

/** Every valid shortcode in the given texts, de-duplicated by key. */
export function collectShortcodes(texts: Iterable<string>): ValidatedShortcode[] {
  const found = new Map<string, ValidatedShortcode>();
  for (const text of texts) {
    for (const segment of parseShortcodes(text)) {
      if (segment.type !== 'shortcode') continue;
      const result = validateShortcode(segment);
      if (result.ok) found.set(result.value.key, result.value);
    }
  }
  return [...found.values()];
}
