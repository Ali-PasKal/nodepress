import { z } from 'zod';

/**
 * Structured rich text (ProseMirror/TipTap JSON). The API accepts only the node types, marks and
 * attributes listed here, so stored content can never contain HTML, scripts, event handlers or
 * dangerous URLs. Unknown attributes are dropped; unknown node or mark types are rejected. Renderers
 * must still escape text and emit only these constructs.
 */

export const RICH_TEXT_MAX_DEPTH = 24;
const MAX_TEXT_LENGTH = 100_000;
const MAX_URL_LENGTH = 2_048;

// Control characters and whitespace are never valid inside a URL we store.
// eslint-disable-next-line no-control-regex -- deliberately matching control characters
const UNSAFE_URL_CHARS = /[\u0000- \u007f-\u009f]/;

/**
 * Link targets: http(s), mailto and tel URLs, or same-site references (`/path`, `#anchor`, `?query`).
 * Protocol-relative URLs (`//host`) and every other scheme (`javascript:`, `data:`, `vbscript:`...) are
 * rejected.
 */
export function isSafeLinkHref(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH || UNSAFE_URL_CHARS.test(value)) {
    return false;
  }
  if (value.startsWith('//') || value.startsWith('/\\')) {
    return false;
  }
  if (value.startsWith('/') || value.startsWith('#') || value.startsWith('?')) {
    return true;
  }
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol);
  } catch {
    return false;
  }
}

/** Image sources: files served from /uploads/ or absolute http(s) URLs. */
export function isSafeImageSrc(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH || UNSAFE_URL_CHARS.test(value)) {
    return false;
  }
  if (value.startsWith('/uploads/')) {
    return !value.includes('..');
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

const linkMark = z.object({
  type: z.literal('link'),
  attrs: z.object({
    href: z.string().refine(isSafeLinkHref, { message: 'Links must use http(s), mailto or tel.' }),
    target: z.enum(['_blank']).nullable().optional(),
  }),
});

const markSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }),
  z.object({ type: z.literal('italic') }),
  z.object({ type: z.literal('underline') }),
  z.object({ type: z.literal('strike') }),
  z.object({ type: z.literal('code') }),
  linkMark,
]);
export type RichTextMark = z.infer<typeof markSchema>;

const textNode = z.object({
  type: z.literal('text'),
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
  marks: z.array(markSchema).max(10).optional(),
});
const hardBreakNode = z.object({ type: z.literal('hardBreak') });
const inlineNode = z.discriminatedUnion('type', [textNode, hardBreakNode]);
export type RichTextInline = z.infer<typeof inlineNode>;

export interface RichTextBlock {
  type:
    | 'paragraph'
    | 'heading'
    | 'blockquote'
    | 'bulletList'
    | 'orderedList'
    | 'listItem'
    | 'codeBlock'
    | 'horizontalRule'
    | 'image';
  attrs?: Record<string, unknown> | undefined;
  content?: (RichTextBlock | RichTextInline)[] | undefined;
}

const inlineContent = z.array(inlineNode).max(10_000).optional();

const paragraphNode = z.object({ type: z.literal('paragraph'), content: inlineContent });
const headingNode = z.object({
  type: z.literal('heading'),
  attrs: z.object({ level: z.number().int().min(2).max(6) }),
  content: inlineContent,
});
const codeBlockNode = z.object({
  type: z.literal('codeBlock'),
  attrs: z
    .object({
      language: z
        .string()
        .regex(/^[a-z0-9+#-]{1,32}$/i)
        .nullable()
        .optional(),
    })
    .optional(),
  content: z
    .array(z.object({ type: z.literal('text'), text: z.string().min(1).max(MAX_TEXT_LENGTH) }))
    .max(1_000)
    .optional(),
});
const horizontalRuleNode = z.object({ type: z.literal('horizontalRule') });
const imageNode = z.object({
  type: z.literal('image'),
  attrs: z.object({
    src: z.string().refine(isSafeImageSrc, { message: 'Images must come from the media library.' }),
    alt: z.string().max(500).nullable().optional(),
    title: z.string().max(255).nullable().optional(),
    mediaId: z.uuid().nullable().optional(),
  }),
});

const blockNode: z.ZodType<RichTextBlock> = z.lazy(() =>
  z.discriminatedUnion('type', [
    paragraphNode,
    headingNode,
    codeBlockNode,
    horizontalRuleNode,
    imageNode,
    z.object({ type: z.literal('blockquote'), content: z.array(blockNode).min(1).max(1_000) }),
    z.object({ type: z.literal('bulletList'), content: z.array(listItemNode).min(1).max(1_000) }),
    z.object({
      type: z.literal('orderedList'),
      attrs: z
        .object({
          start: z.number().int().min(0).max(1_000_000).optional(),
          type: z.enum(['1', 'a', 'A', 'i', 'I']).nullable().optional(),
        })
        .optional(),
      content: z.array(listItemNode).min(1).max(1_000),
    }),
  ]),
);

const listItemNode: z.ZodType<RichTextBlock> = z.lazy(() =>
  z.object({ type: z.literal('listItem'), content: z.array(blockNode).min(1).max(1_000) }),
);

/** Iterative depth check, run before schema parsing so hostile nesting cannot exhaust the stack. */
export function richTextDepthWithin(value: unknown, maxDepth = RICH_TEXT_MAX_DEPTH): boolean {
  const stack: [unknown, number][] = [[value, 1]];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const [node, depth] = item;
    if (depth > maxDepth) {
      return false;
    }
    if (node !== null && typeof node === 'object' && 'content' in node) {
      const content = node.content;
      if (Array.isArray(content)) {
        for (const child of content) {
          stack.push([child, depth + 1]);
        }
      }
    }
  }
  return true;
}

const documentShape = z.object({
  type: z.literal('doc'),
  content: z.array(blockNode).max(10_000),
});

export const richTextDocumentSchema = z
  .unknown()
  .refine((value) => richTextDepthWithin(value), {
    message: `Content is nested more than ${String(RICH_TEXT_MAX_DEPTH)} levels deep.`,
    abort: true,
  })
  .pipe(documentShape);
export type RichTextDocument = z.infer<typeof documentShape>;

export const EMPTY_RICH_TEXT: RichTextDocument = { type: 'doc', content: [] };

/** Text content with blocks separated by newlines (search, excerpts, word counts). */
export function richTextToPlainText(document: RichTextDocument): string {
  const lines: string[] = [];
  const visit = (node: RichTextBlock | RichTextInline, line: string[]): void => {
    if (node.type === 'text') {
      line.push(node.text);
      return;
    }
    if (node.type === 'hardBreak') {
      line.push('\n');
      return;
    }
    if (node.type === 'image') {
      const alt = node.attrs?.alt;
      if (typeof alt === 'string' && alt !== '') lines.push(alt);
      return;
    }
    const isTextBlock =
      node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock';
    if (isTextBlock) {
      const own: string[] = [];
      for (const child of node.content ?? []) visit(child, own);
      if (own.length > 0) lines.push(own.join(''));
      return;
    }
    for (const child of node.content ?? []) visit(child, line);
  };
  for (const block of document.content) visit(block, []);
  return lines.join('\n');
}

/** Media ids referenced by image nodes (for usage tracking). */
export function richTextMediaIds(document: RichTextDocument): string[] {
  const ids = new Set<string>();
  const visit = (node: RichTextBlock | RichTextInline): void => {
    if (node.type === 'image') {
      const id = node.attrs?.mediaId;
      if (typeof id === 'string') ids.add(id);
    }
    if ('content' in node) for (const child of node.content ?? []) visit(child);
  };
  for (const block of document.content) visit(block);
  return [...ids];
}
