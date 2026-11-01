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
