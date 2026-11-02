import type { DeliveryMedia, RichTextDocument } from '@nexora/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatTitle,
  isCurrentLink,
  linkAttributes,
  readingMinutes,
} from './helpers.js';
import { ResponsiveImage } from './image.js';
import { RichText } from './rich-text.js';

const media: DeliveryMedia = {
  id: '0191a0b0-0000-7000-8000-000000000001',
  url: '/uploads/a.jpg',
  mimeType: 'image/jpeg',
  width: 1000,
  height: 500,
  altText: 'Library alt',
  caption: '',
  sources: [
    { url: '/uploads/a-320.webp', width: 320, height: 160 },
    { url: '/uploads/a-768.webp', width: 768, height: 384 },
  ],
};

describe('RichText', () => {
  it('renders the allowlisted nodes and escapes all text', () => {
    const document: RichTextDocument = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '<b>Title</b>' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }, { type: 'italic' }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: '/about' } }] },
            {
              type: 'text',
              text: 'tab',
              marks: [{ type: 'link', attrs: { href: 'https://example.org', target: '_blank' } }],
            },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 3, type: 'i' },
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }],
            },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'const a = "<x>";' }],
        },
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quote' }] }],
        },
        { type: 'horizontalRule' },
      ],
    };
    const html = renderToStaticMarkup(<RichText document={document} className="prose" />);
    expect(html).toBe(
      '<div class="prose"><h2>&lt;b&gt;Title&lt;/b&gt;</h2>' +
        '<p><em><strong>bold</strong></em><br/><a href="/about">site</a>' +
        '<a href="https://example.org" target="_blank" rel="noopener noreferrer">tab</a></p>' +
        '<ol start="3" type="i"><li><p>item</p></li></ol>' +
        '<pre><code class="language-ts">const a = &quot;&lt;x&gt;&quot;;</code></pre>' +
        '<blockquote><p>quote</p></blockquote><hr/></div>',
    );
  });

  it('drops unsafe links and images even when the stored document bypassed validation', () => {
    const hostile = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'js',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
            {
              type: 'text',
              text: 'data',
              marks: [{ type: 'link', attrs: { href: 'data:text/html,x' } }],
            },
            {
              type: 'text',
              text: 'proto',
              marks: [{ type: 'link', attrs: { href: '//evil.example' } }],
            },
          ],
        },
        { type: 'image', attrs: { src: 'javascript:alert(1)', alt: 'x' } },
        { type: 'image', attrs: { src: '/uploads/../etc/passwd', alt: 'x' } },
        {
          type: 'codeBlock',
          attrs: { language: '"><script>' },
          content: [{ type: 'text', text: 'x' }],
        },
        { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
      ],
    } as unknown as RichTextDocument;
    const html = renderToStaticMarkup(<RichText document={hostile} />);
    expect(html).toBe('<div><p>jsdataproto</p><pre><code>x</code></pre></div>');
  });

  it('uses responsive media for images that reference the media library', () => {
    const document: RichTextDocument = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: '/uploads/a.jpg', alt: 'Body alt', title: 'Caption', mediaId: media.id },
        },
      ],
    };
    const html = renderToStaticMarkup(
      <RichText document={document} media={{ [media.id]: media }} imageSizes="50vw" />,
    );
    expect(html).toContain(
      'srcSet="/uploads/a-320.webp 320w, /uploads/a-768.webp 768w, /uploads/a.jpg 1000w"',
    );
    expect(html).toContain('sizes="50vw"');
    expect(html).toContain('alt="Body alt"');
    expect(html).toContain('<figcaption>Caption</figcaption>');
  });
});

describe('ResponsiveImage', () => {
  it('sets dimensions, srcset and loading hints', () => {
    const html = renderToStaticMarkup(<ResponsiveImage media={media} priority />);
    expect(html).toContain('width="1000" height="500"');
    expect(html).toContain('alt="Library alt"');
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchPriority="high"');
    const plain = renderToStaticMarkup(
      <ResponsiveImage media={{ ...media, sources: [] }} alt="" />,
    );
    expect(plain).not.toContain('srcSet');
    expect(plain).toContain('alt=""');
    expect(plain).toContain('loading="lazy"');
    expect(
      renderToStaticMarkup(<ResponsiveImage media={{ ...media, url: 'javascript:x' }} />),
    ).toBe('');
  });
});

describe('helpers', () => {
  it('formats titles, dates and reading time', () => {
    expect(formatTitle('%title% – %site%', 'Hello', 'Site')).toBe('Hello – Site');
    expect(formatTitle('%title% – %site%', '', 'Site')).toBe('Site');
    expect(formatDate('2026-10-01T10:00:00Z', 'en')).toBe('October 1, 2026');
    expect(formatDate('2026-10-01T10:00:00Z', 'fa')).toContain('۱۴۰۵');
    expect(formatDate('2026-10-01T10:00:00Z', 'not a locale!')).toBe('October 1, 2026');
    expect(readingMinutes('word '.repeat(450))).toBe(2);
    expect(readingMinutes('')).toBe(1);
  });

  it('builds safe link attributes and detects the current page', () => {
    expect(linkAttributes('/about')).toEqual({ href: '/about' });
    expect(linkAttributes('https://example.org')).toEqual({
      href: 'https://example.org',
      rel: 'noopener noreferrer',
    });
    expect(linkAttributes('/x', true)).toEqual({
      href: '/x',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(linkAttributes('javascript:alert(1)')).toBeNull();
    expect(linkAttributes('//evil.example')).toBeNull();
    expect(isCurrentLink('/blog', '/blog')).toBe(true);
    expect(isCurrentLink('/blog', '/blog/post')).toBe(false);
    expect(isCurrentLink('/blog', '/blog/post', true)).toBe(true);
    expect(isCurrentLink('/', '/blog', true)).toBe(false);
    expect(isCurrentLink(`/${encodeURIComponent('درباره')}`, '/درباره')).toBe(true);
    expect(isCurrentLink('https://example.org/blog', '/blog')).toBe(false);
  });
});

describe('shortcodes in rich text', () => {
  const context = {
    resolved: {
      'recent_posts?count=2': {
        name: 'recent_posts' as const,
        items: [
          {
            id: '0193e0a4-6a5b-7c2d-8e9f-0000000000aa',
            type: 'post',
            title: '<b>Post</b>',
            url: '/blog/post',
            summary: '',
            publishedAt: '2026-10-01T10:00:00.000Z',
            updatedAt: '2026-10-01T10:00:00.000Z',
            author: { displayName: 'A' },
            featuredMedia: null,
            terms: [],
          },
        ],
      },
    },
    siteName: 'My <Site>',
    language: 'en',
    now: new Date('2031-05-01T00:00:00Z'),
  };
  const doc = (text: string): RichTextDocument => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

  it('renders registered shortcodes, escapes data and keeps unknown ones literal', () => {
    const html = renderToStaticMarkup(
      <RichText
        document={doc(
          '© [year] [site_name] — [button text="Go <now>" url="/go" style=outline] [missing] [[year]]',
        )}
        shortcodes={context}
      />,
    );
    expect(html).toBe(
      '<div><p>© 2031 My &lt;Site&gt; — <a href="/go" class="nx-btn nx-btn-outline">Go &lt;now&gt;</a> [missing] [year]</p></div>',
    );
  });

  it('turns paragraphs with block shortcodes into divs and refuses unsafe attributes', () => {
    const html = renderToStaticMarkup(
      <RichText
        document={doc('Latest: [recent_posts count=2] [button text=x url="javascript:alert(1)"]')}
        shortcodes={context}
      />,
    );
    expect(html).toContain(
      '<div class="nx-p">Latest: <ul class="nx-sc-posts"><li><a href="/blog/post">&lt;b&gt;Post&lt;/b&gt;</a>',
    );
    expect(html).toContain('[button text=x url=&quot;javascript:alert(1)&quot;]');
    expect(html).not.toContain('href="javascript');
    const video = renderToStaticMarkup(
      <RichText document={doc('[video youtube=dQw4w9WgXcQ]')} shortcodes={context} />,
    );
    expect(video).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(video).toContain(
      'sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"',
    );
    // Without a context, text stays literal (e.g. the admin's read-only views).
    expect(renderToStaticMarkup(<RichText document={doc('[year]')} />)).toBe(
      '<div><p>[year]</p></div>',
    );
  });
});

describe('plugin shortcodes', () => {
  const paragraph = (text: string): RichTextDocument => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
  const body = (text: string): RichTextDocument => paragraph(text);

  it('renders resolved plugin output inline or as a block, without expanding shortcodes inside it', () => {
    const inline = renderToStaticMarkup(
      <RichText
        document={body('Takes [reading_time] to read.')}
        shortcodes={{
          resolved: {
            'reading_time?': {
              name: 'plugin',
              plugin: 'nexora.reading-time',
              content: paragraph('3 min read [year]'),
            },
          },
          siteName: 'Site',
          language: 'en',
        }}
      />,
    );
    expect(inline).toContain(
      '<p>Takes <span class="nx-plugin-output">3 min read [year]</span> to read.</p>',
    );
    const block = renderToStaticMarkup(
      <RichText
        document={body('[related_posts]')}
        shortcodes={{
          resolved: {
            'related_posts?': {
              name: 'plugin',
              plugin: 'nexora.related-posts',
              content: {
                type: 'doc',
                content: [
                  {
                    type: 'heading',
                    attrs: { level: 3 },
                    content: [{ type: 'text', text: 'More' }],
                  },
                  paragraph('One').content[0]!,
                ],
              },
            },
          },
          siteName: 'Site',
          language: 'en',
        }}
      />,
    );
    // A block result inside a paragraph is wrapped in a div (no <div> inside <p>).
    expect(block).toContain(
      '<div class="nx-p"><div class="nx-plugin-output"><h3>More</h3><p>One</p></div></div>',
    );
  });

  it('keeps unresolved plugin shortcodes literal on the site and shows placeholders in the editor', () => {
    const context = { resolved: {}, siteName: 'Site', language: 'en' };
    expect(
      renderToStaticMarkup(<RichText document={body('[reading_time]')} shortcodes={context} />),
    ).toContain('<p>[reading_time]</p>');
    const editing = renderToStaticMarkup(
      <RichText
        document={body('[reading_time]')}
        shortcodes={{ ...context, editing: true, pluginShortcodes: new Set(['reading_time']) }}
      />,
    );
    expect(editing).toContain('[reading_time] from a plugin (shown on the site)');
  });
});
