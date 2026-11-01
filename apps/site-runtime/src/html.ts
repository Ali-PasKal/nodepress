const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * JSON for an inline `<script type="application/ld+json">` block: characters that could end the script
 * element or confuse HTML parsing are escaped as JSON unicode escapes.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export type HeadTag =
  | { tag: 'meta'; name?: string; property?: string; content: string }
  | { tag: 'link'; rel: string; href: string; type?: string; title?: string; hreflang?: string }
  | { tag: 'jsonld'; data: unknown };

export function renderHeadTag(tag: HeadTag): string {
  switch (tag.tag) {
    case 'meta': {
      const key =
        tag.name !== undefined
          ? `name="${escapeHtml(tag.name)}"`
          : `property="${escapeHtml(tag.property ?? '')}"`;
      return `<meta ${key} content="${escapeHtml(tag.content)}">`;
    }
    case 'link': {
      const extra = [
        tag.type !== undefined ? ` type="${escapeHtml(tag.type)}"` : '',
        tag.title !== undefined ? ` title="${escapeHtml(tag.title)}"` : '',
        tag.hreflang !== undefined ? ` hreflang="${escapeHtml(tag.hreflang)}"` : '',
      ].join('');
      return `<link rel="${escapeHtml(tag.rel)}" href="${escapeHtml(tag.href)}"${extra}>`;
    }
    case 'jsonld':
      return `<script type="application/ld+json">${serializeJsonLd(tag.data)}</script>`;
  }
}

export interface DocumentParts {
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  readonly htmlAttributes: Readonly<Record<string, string>>;
  readonly title: string;
  readonly head: readonly HeadTag[];
  readonly stylesheets: readonly string[];
  /** Inline CSS blocks, each allowed by its SHA-256 in the CSP (never user-written CSS: compiled from typed values). */
  readonly inlineStyles?: readonly string[];
  readonly body: string;
}

/** The complete HTML document. The body comes from React (already escaped); everything else is escaped here. */
export function renderDocument(parts: DocumentParts): string {
  const attributes = Object.entries(parts.htmlAttributes)
    .filter(([name]) => /^data-[a-z][a-z0-9-]*$/.test(name))
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('');
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(parts.title)}</title>`,
    ...parts.stylesheets.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`),
    ...(parts.inlineStyles ?? [])
      .filter((css) => !/<\/?style|<!--/i.test(css))
      .map((css) => `<style>${css}</style>`),
    ...parts.head.map(renderHeadTag),
  ].join('\n');
  return `<!doctype html>\n<html lang="${escapeHtml(parts.language)}" dir="${parts.direction}"${attributes}>\n<head>\n${head}\n</head>\n<body>\n${parts.body}\n</body>\n</html>\n`;
}
