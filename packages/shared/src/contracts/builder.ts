import { z } from 'zod';
import { uuidSchema } from './common.js';
import {
  EMPTY_RICH_TEXT,
  isSafeLinkHref,
  richTextDocumentSchema,
  richTextMediaIds,
  richTextToPlainText,
  type RichTextBlock,
  type RichTextDocument,
  type RichTextInline,
} from './rich-text.js';
import { VIMEO_ID_PATTERN, YOUTUBE_ID_PATTERN } from './shortcodes.js';

// ---------------------------------------------------------------------------------------------
// Builder documents
//
// A page built visually is a typed, versioned document: sections → columns → widgets. Styles are typed values
// (hex colours, bounded integers, enums) compiled to CSS by `compileBuilderCss`, never raw CSS. The same schema
// validates in the editor and in the API; older documents are upgraded by `upgradeBuilderDocument`, documents
// from a newer version are refused.
// ---------------------------------------------------------------------------------------------

export const BUILDER_SCHEMA_VERSION = 1;
export const BREAKPOINTS = ['desktop', 'tablet', 'mobile'] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];
/** Container widths (px) at and below which tablet and mobile values apply. */
export const BREAKPOINT_WIDTHS = { tablet: 1024, mobile: 640 } as const;
export const BUILDER_MAX_NODES = 2_000;
export const BUILDER_MAX_SECTIONS = 200;

const ELEMENT_ID = /^[a-z0-9]{8}$/;
const HEX = /^#[0-9a-f]{6}$/;
export const elementIdSchema = z.string().regex(ELEMENT_ID, { message: 'Invalid element id.' });
const color = z.string().trim().toLowerCase().regex(HEX, { message: 'Use a colour like #1d4ed8.' });
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const linkUrl = z.string().trim().max(2_048).refine(isSafeLinkHref, {
  message: 'Use a site path ("/about") or an http(s), mailto or tel link.',
});

/** Style values for one breakpoint. Everything is optional: unset values inherit. */
export const styleValuesSchema = z.strictObject({
  paddingTop: int(0, 400).optional(),
  paddingEnd: int(0, 400).optional(),
  paddingBottom: int(0, 400).optional(),
  paddingStart: int(0, 400).optional(),
  marginTop: int(-200, 400).optional(),
  marginBottom: int(-200, 400).optional(),
  backgroundColor: color.optional(),
  textColor: color.optional(),
  textAlign: z.enum(['start', 'center', 'end', 'justify']).optional(),
  fontSize: int(8, 160).optional(),
  borderRadius: int(0, 200).optional(),
  maxWidth: int(100, 2_400).optional(),
  minHeight: int(0, 2_000).optional(),
  hidden: z.boolean().optional(),
});
export type StyleValues = z.output<typeof styleValuesSchema>;
export type StyleKey = keyof StyleValues;

export const stylesSchema = z
  .strictObject({
    desktop: styleValuesSchema.default({}),
    tablet: styleValuesSchema.optional(),
    mobile: styleValuesSchema.optional(),
  })
  .default({ desktop: {} });
export type Styles = z.output<typeof stylesSchema>;

const responsiveWidth = z.strictObject({
  desktop: int(5, 100),
  tablet: int(5, 100).optional(),
  mobile: int(5, 100).optional(),
});

// ---------------------------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------------------------

export const widgetPropsSchemas = {
  heading: z.strictObject({
    text: z.string().trim().min(1, { message: 'Enter the heading text.' }).max(300),
    level: int(1, 6).default(2),
    link: linkUrl.nullable().default(null),
  }),
  text: z.strictObject({ content: richTextDocumentSchema }),
  image: z.strictObject({
    mediaId: uuidSchema.nullable().default(null),
    alt: z.string().trim().max(500).default(''),
    caption: z.string().trim().max(500).default(''),
    link: linkUrl.nullable().default(null),
    width: z.enum(['auto', 'full']).default('full'),
  }),
  button: z.strictObject({
    label: z.string().trim().min(1, { message: 'Enter the button text.' }).max(100),
    url: linkUrl,
    variant: z.enum(['primary', 'secondary', 'outline']).default('primary'),
    size: z.enum(['sm', 'md', 'lg']).default('md'),
    openInNewTab: z.boolean().default(false),
    fullWidth: z.boolean().default(false),
  }),
  spacer: z.strictObject({ height: int(0, 600).default(48) }),
  divider: z.strictObject({
    style: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
    thickness: int(1, 20).default(1),
    color: color.nullable().default(null),
    width: int(10, 100).default(100),
  }),
  video: z
    .strictObject({
      provider: z.enum(['youtube', 'vimeo']),
      videoId: z.string().trim(),
      title: z.string().trim().max(200).default('Video'),
      aspectRatio: z.enum(['16:9', '4:3', '1:1', '9:16']).default('16:9'),
    })
    .superRefine((value, ctx) => {
      const pattern = value.provider === 'youtube' ? YOUTUBE_ID_PATTERN : VIMEO_ID_PATTERN;
      if (!pattern.test(value.videoId)) {
        ctx.addIssue({ code: 'custom', path: ['videoId'], message: 'Enter a valid video id.' });
      }
    }),
  posts: z.strictObject({
    type: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,31}$/)
      .default('post'),
    termId: uuidSchema.nullable().default(null),
    count: int(1, 24).default(3),
    columns: int(1, 4).default(3),
    showImage: z.boolean().default(true),
    showExcerpt: z.boolean().default(true),
    showDate: z.boolean().default(true),
  }),
  shortcode: z.strictObject({ code: z.string().max(2_000).default('') }),
  html: z.strictObject({
    html: z.string().max(50_000).default(''),
    height: int(50, 3_000).default(300),
    title: z.string().trim().max(200).default('Embedded content'),
  }),
} as const;

export type WidgetType = keyof typeof widgetPropsSchemas;
export const WIDGET_TYPES = Object.keys(widgetPropsSchemas) as WidgetType[];
export type WidgetProps<Type extends WidgetType> = z.output<(typeof widgetPropsSchemas)[Type]>;

const widgetNode = <Type extends WidgetType>(type: Type) =>
  z.strictObject({
    id: elementIdSchema,
    type: z.literal('widget'),
    widget: z.literal(type),
    props: widgetPropsSchemas[type],
    styles: stylesSchema,
  });

export const widgetSchema = z.discriminatedUnion('widget', [
  widgetNode('heading'),
  widgetNode('text'),
  widgetNode('image'),
  widgetNode('button'),
  widgetNode('spacer'),
  widgetNode('divider'),
  widgetNode('video'),
  widgetNode('posts'),
  widgetNode('shortcode'),
  widgetNode('html'),
]);
export type BuilderWidget = z.output<typeof widgetSchema>;
export type BuilderWidgetOf<Type extends WidgetType> = Extract<BuilderWidget, { widget: Type }>;

export const columnSchema = z.strictObject({
  id: elementIdSchema,
  type: z.literal('column'),
  width: responsiveWidth.default({ desktop: 100 }),
  verticalAlign: z.enum(['start', 'center', 'end']).default('start'),
  styles: stylesSchema,
  children: z.array(widgetSchema).max(200),
});
export type BuilderColumn = z.output<typeof columnSchema>;

export const sectionSchema = z.strictObject({
  id: elementIdSchema,
  type: z.literal('section'),
  layout: z.enum(['boxed', 'full']).default('boxed'),
  gap: int(0, 160).default(24),
  styles: stylesSchema,
  children: z.array(columnSchema).min(1).max(6),
});
export type BuilderSection = z.output<typeof sectionSchema>;

const documentShape = z
  .strictObject({
    schemaVersion: z.literal(BUILDER_SCHEMA_VERSION),
    settings: z
      .strictObject({ hideTitle: z.boolean().default(false) })
      .default({ hideTitle: false }),
    sections: z.array(sectionSchema).max(BUILDER_MAX_SECTIONS),
  })
  .superRefine((document, ctx) => {
    const ids = new Set<string>();
    let nodes = 0;
    const visit = (id: string, path: (string | number)[]) => {
      nodes += 1;
      if (ids.has(id))
        ctx.addIssue({ code: 'custom', path: [...path, 'id'], message: 'Duplicate element id.' });
      ids.add(id);
    };
    document.sections.forEach((section, s) => {
      visit(section.id, ['sections', s]);
      section.children.forEach((column, c) => {
        visit(column.id, ['sections', s, 'children', c]);
        column.children.forEach((widget, w) => {
          visit(widget.id, ['sections', s, 'children', c, 'children', w]);
        });
      });
    });
    if (nodes > BUILDER_MAX_NODES) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections'],
        message: `A page can have at most ${String(BUILDER_MAX_NODES)} elements.`,
      });
    }
  });
export type BuilderDocument = z.output<typeof documentShape>;

/** Upgrades older documents to the current schema version (pure functions, one per version step). */
const MIGRATIONS: Readonly<
  Record<number, (document: Record<string, unknown>) => Record<string, unknown>>
> = {};

export function upgradeBuilderDocument(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  let document = value as Record<string, unknown>;
  let version = document.schemaVersion;
  while (typeof version === 'number' && version < BUILDER_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) break;
    document = migrate(document);
    version = document.schemaVersion;
  }
  return document;
}

/** Validates (and upgrades) a builder document; newer schema versions are refused with a clear message. */
export const builderDocumentSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    const version = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
    if (typeof version === 'number' && version > BUILDER_SCHEMA_VERSION) {
      ctx.addIssue({
        code: 'custom',
        path: ['schemaVersion'],
        message: 'This page was saved by a newer version of NEXORA and cannot be edited here.',
        fatal: true,
      });
    }
  })
  .transform(upgradeBuilderDocument)
  .pipe(documentShape);

export const EMPTY_BUILDER_DOCUMENT: BuilderDocument = {
  schemaVersion: BUILDER_SCHEMA_VERSION,
  settings: { hideTitle: false },
  sections: [],
};

// ---------------------------------------------------------------------------------------------
// Factories (editor) and traversal helpers (API, renderers)
// ---------------------------------------------------------------------------------------------

/** Element ids only need to be unique within a document (they are not secrets), so Math.random suffices. */
export function createElementId(): string {
  let id = '';
  for (let index = 0; index < 8; index += 1) id += Math.floor(Math.random() * 36).toString(36);
  return id;
}

const WIDGET_DEFAULTS: { [Type in WidgetType]: z.input<(typeof widgetPropsSchemas)[Type]> } = {
  heading: { text: 'Heading', level: 2 },
  text: {
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Write something…' }] }],
    },
  },
  image: {},
  button: { label: 'Click here', url: '/' },
  spacer: {},
  divider: {},
  video: { provider: 'youtube', videoId: 'aqz-KE-bpKQ' },
  posts: {},
  shortcode: { code: '[year]' },
  html: { html: '<p>Embedded content</p>' },
};

export function createWidget<Type extends WidgetType>(type: Type): BuilderWidgetOf<Type> {
  return widgetSchema.parse({
    id: createElementId(),
    type: 'widget',
    widget: type,
    props: WIDGET_DEFAULTS[type],
    styles: { desktop: {} },
  }) as BuilderWidgetOf<Type>;
}

export function createColumn(width = 100, children: BuilderWidget[] = []): BuilderColumn {
  return {
    id: createElementId(),
    type: 'column',
    width: { desktop: width },
    verticalAlign: 'start',
    styles: { desktop: {} },
    children,
  };
}

/** A section with equal columns (`[50, 50]`, `[33, 33, 34]` …). */
export function createSection(widths: readonly number[] = [100]): BuilderSection {
  return {
    id: createElementId(),
    type: 'section',
    layout: 'boxed',
    gap: 24,
    styles: { desktop: { paddingTop: 48, paddingBottom: 48 } },
    children: widths.map((width) => createColumn(width)),
  };
}

/** Deep copy with fresh ids (duplicate). */
export function cloneWithNewIds<Node extends BuilderSection | BuilderColumn | BuilderWidget>(
  node: Node,
): Node {
  const copy = JSON.parse(JSON.stringify(node)) as Node & { children?: unknown[] };
  const renew = (item: { id: string; children?: unknown[] }) => {
    item.id = createElementId();
    for (const child of (item.children ?? []) as { id: string; children?: unknown[] }[])
      renew(child);
  };
  renew(copy);
  return copy;
}

export function allWidgets(document: BuilderDocument): BuilderWidget[] {
  return document.sections.flatMap((section) =>
    section.children.flatMap((column) => column.children),
  );
}

function richTextTexts(document: RichTextDocument): string[] {
  const texts: string[] = [];
  const visit = (node: RichTextBlock | RichTextInline) => {
    if (node.type === 'text') texts.push(node.text);
    else if ('content' in node) for (const child of node.content ?? []) visit(child);
  };
  for (const block of document.content) visit(block);
  return texts;
}

/** Texts that may contain shortcodes: rich-text nodes (entry body or text widgets) and shortcode widgets. */
export function shortcodeTexts(body: RichTextDocument, builder: BuilderDocument | null): string[] {
  const texts = richTextTexts(body);
  for (const widget of builder ? allWidgets(builder) : []) {
    if (widget.widget === 'text') texts.push(...richTextTexts(widget.props.content));
    if (widget.widget === 'shortcode') texts.push(widget.props.code);
  }
  return texts;
}

/** Searchable text of a builder document. */
export function builderPlainText(document: BuilderDocument): string {
  const parts: string[] = [];
  for (const widget of allWidgets(document)) {
    switch (widget.widget) {
      case 'heading':
        parts.push(widget.props.text);
        break;
      case 'text':
        parts.push(richTextToPlainText(widget.props.content));
        break;
      case 'button':
        parts.push(widget.props.label);
        break;
      case 'image':
        parts.push(widget.props.caption, widget.props.alt);
        break;
      default:
        break;
    }
  }
  return parts.filter(Boolean).join('\n');
}

/** Media ids used by image widgets and by images inside text widgets. */
export function builderMediaIds(document: BuilderDocument): string[] {
  const ids = new Set<string>();
  for (const widget of allWidgets(document)) {
    if (widget.widget === 'image' && widget.props.mediaId) ids.add(widget.props.mediaId);
    if (widget.widget === 'text')
      for (const id of richTextMediaIds(widget.props.content)) ids.add(id);
  }
  return [...ids];
}

/** A text widget holding an existing rich-text body (switching an entry to the builder keeps its content). */
export function builderFromRichText(body: RichTextDocument): BuilderDocument {
  const section = createSection([100]);
  const text = createWidget('text');
  text.props.content = body.content.length > 0 ? body : EMPTY_RICH_TEXT;
  section.children[0]?.children.push(text);
  return {
    schemaVersion: BUILDER_SCHEMA_VERSION,
    settings: { hideTitle: false },
    sections: [section],
  };
}

// ---------------------------------------------------------------------------------------------
// CSS compiler
// ---------------------------------------------------------------------------------------------

const px = (value: number) => `${String(value)}px`;
const DECLARATIONS: { [Key in StyleKey]: (value: NonNullable<StyleValues[Key]>) => string } = {
  paddingTop: (v) => `padding-block-start:${px(v)}`,
  paddingEnd: (v) => `padding-inline-end:${px(v)}`,
  paddingBottom: (v) => `padding-block-end:${px(v)}`,
  paddingStart: (v) => `padding-inline-start:${px(v)}`,
  marginTop: (v) => `margin-block-start:${px(v)}`,
  marginBottom: (v) => `margin-block-end:${px(v)}`,
  backgroundColor: (v) => `background-color:${v}`,
  textColor: (v) => `color:${v}`,
  textAlign: (v) => `text-align:${v}`,
  fontSize: (v) => `font-size:${px(v)}`,
  borderRadius: (v) => `border-radius:${px(v)}`,
  maxWidth: (v) => `max-width:${px(v)};margin-inline:auto`,
  minHeight: (v) => `min-height:${px(v)}`,
  hidden: (v) => (v ? 'display:none!important' : ''),
};

/** Re-checks a value before it reaches CSS (the schema already guarantees this; defence in depth). */
function safeValue(value: unknown): boolean {
  return (
    (typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 10_000) ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && (HEX.test(value) || /^(start|center|end|justify)$/.test(value)))
  );
}

function declarations(values: StyleValues | undefined, extra: string[] = []): string {
  const list = [...extra];
  for (const [key, value] of Object.entries(values ?? {}) as [StyleKey, unknown][]) {
    if (value === undefined || !safeValue(value)) continue;
    const declaration = DECLARATIONS[key](value as never);
    if (declaration) list.push(declaration);
  }
  return list.join(';');
}

/**
 * CSS for a document's per-element styles, scoped by element id, with tablet and mobile overrides as container
 * queries on the builder root (so the editor's device preview and the site behave the same).
 */
export function compileBuilderCss(document: BuilderDocument): string {
  const base: string[] = [];
  const tablet: string[] = [];
  const mobile: string[] = [];
  const rule = (target: string[], id: string, body: string, suffix = '') => {
    if (ELEMENT_ID.test(id) && body !== '') target.push(`.nx-el-${id}${suffix}{${body}}`);
  };
  const add = (id: string, styles: Styles, extra: Partial<Record<Breakpoint, string[]>> = {}) => {
    rule(base, id, declarations(styles.desktop, extra.desktop));
    rule(tablet, id, declarations(styles.tablet, extra.tablet));
    rule(mobile, id, declarations(styles.mobile, extra.mobile));
  };
  for (const section of document.sections) {
    add(section.id, section.styles);
    rule(base, section.id, `gap:${px(section.gap)}`, '>.nx-b-row');
    for (const column of section.children) {
      // Widths in a row add up to 100%; each column gives up its share of the gaps so the row fits exactly.
      const width = (value: number | undefined) => {
        if (value === undefined) return [];
        const share = (section.gap * (100 - value)) / 100;
        const basis = value === 100 ? '100%' : `calc(${String(value)}% - ${share.toFixed(2)}px)`;
        return [`flex:0 0 ${basis}`, `max-width:${basis}`];
      };
      add(column.id, column.styles, {
        desktop: width(column.width.desktop),
        tablet: width(column.width.tablet),
        mobile: width(column.width.mobile ?? 100),
      });
      for (const widget of column.children) {
        const extra: string[] = [];
        if (widget.widget === 'spacer') extra.push(`height:${px(widget.props.height)}`);
        if (widget.widget === 'divider') {
          const { style, thickness, color: lineColor, width: lineWidth } = widget.props;
          extra.push(
            `border-block-start:${px(thickness)} ${style} ${lineColor && HEX.test(lineColor) ? lineColor : 'currentColor'}`,
            `width:${String(lineWidth)}%`,
          );
        }
        add(widget.id, widget.styles, { desktop: extra });
      }
    }
  }
  return [
    ...base,
    tablet.length > 0
      ? `@container nxb (max-width:${px(BREAKPOINT_WIDTHS.tablet)}){${tablet.join('')}}`
      : '',
    mobile.length > 0
      ? `@container nxb (max-width:${px(BREAKPOINT_WIDTHS.mobile)}){${mobile.join('')}}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
