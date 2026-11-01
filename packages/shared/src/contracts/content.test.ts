import { describe, expect, it } from 'vitest';
import {
  buildFieldValuesSchema,
  fieldDefinitionsSchema,
  isSafeLinkHref,
  richTextDocumentSchema,
  richTextMediaIds,
  richTextToPlainText,
  slugify,
  slugSchema,
} from '../index.js';

const paragraph = (text: string, marks?: unknown[]) => ({
  type: 'paragraph',
  content: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
});
const doc = (...content: unknown[]) => ({ type: 'doc', content });

describe('rich text documents', () => {
  it('accepts the supported structure and drops unknown attributes', () => {
    const input = doc(
      {
        type: 'heading',
        attrs: { level: 2, id: 'x', onclick: 'alert(1)' },
        content: [{ type: 'text', text: 'Title' }],
      },
      paragraph('Hello ', [{ type: 'bold' }]),
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'link',
            marks: [
              {
                type: 'link',
                attrs: { href: 'https://example.com', target: '_blank', class: 'evil' },
              },
            ],
          },
          { type: 'hardBreak' },
          { type: 'text', text: 'next line' },
        ],
      },
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('item')] }] },
      {
        type: 'orderedList',
        attrs: { start: 3 },
        content: [{ type: 'listItem', content: [paragraph('third')] }],
      },
      { type: 'blockquote', content: [paragraph('quoted')] },
      {
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [{ type: 'text', text: 'const x = 1;' }],
      },
      { type: 'horizontalRule' },
      {
        type: 'image',
        attrs: {
          src: '/uploads/2026/11/0193e0a4-6a5b-7c2d-8e9f-0a1b2c3d4e5f/a.webp',
          alt: 'A cat',
          mediaId: '0193e0a4-6a5b-7c2d-8e9f-0a1b2c3d4e5f',
        },
      },
    );
    const parsed = richTextDocumentSchema.parse(input);
    expect(parsed.content[0]).toEqual({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Title' }],
    });
    const link = (parsed.content[2] as { content: { marks?: unknown[] }[] }).content[0]!.marks![0];
    expect(link).toEqual({
      type: 'link',
      attrs: { href: 'https://example.com', target: '_blank' },
    });
  });

  it.each([
    [
      'javascript: link',
      paragraph('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
    ],
    [
      'obfuscated javascript: link',
      paragraph('x', [{ type: 'link', attrs: { href: ' javascript:alert(1)' } }]),
    ],
    ['data: link', paragraph('x', [{ type: 'link', attrs: { href: 'data:text/html,<script>' } }])],
    [
      'protocol-relative link',
      paragraph('x', [{ type: 'link', attrs: { href: '//evil.example' } }]),
    ],
    ['unknown mark', paragraph('x', [{ type: 'script' }])],
    [
      'unknown node',
      { type: 'html', content: [{ type: 'text', text: '<script>alert(1)</script>' }] },
    ],
    ['iframe node', { type: 'iframe', attrs: { src: 'https://evil.example' } }],
    ['javascript: image', { type: 'image', attrs: { src: 'javascript:alert(1)' } }],
    ['data: image', { type: 'image', attrs: { src: 'data:image/svg+xml;base64,PHN2Zz4=' } }],
    ['traversal in image path', { type: 'image', attrs: { src: '/uploads/../../etc/passwd' } }],
    ['h1 heading (reserved for the title)', { type: 'heading', attrs: { level: 1 }, content: [] }],
    ['empty text node', { type: 'paragraph', content: [{ type: 'text', text: '' }] }],
  ])('rejects %s', (_label, node) => {
    expect(richTextDocumentSchema.safeParse(doc(node)).success).toBe(false);
  });

  it('rejects documents nested deeper than the limit without exhausting the stack', () => {
    let node: unknown = paragraph('deep');
    for (let i = 0; i < 50_000; i += 1) node = { type: 'blockquote', content: [node] };
    const result = richTextDocumentSchema.safeParse(doc(node));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/nested more than/);
  });

  it('extracts plain text and referenced media', () => {
    const parsed = richTextDocumentSchema.parse(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
        paragraph('First'),
        { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Item')] }] },
        {
          type: 'image',
          attrs: {
            src: '/uploads/a.webp',
            alt: 'Alt text',
            mediaId: '0193e0a4-6a5b-7c2d-8e9f-0a1b2c3d4e5f',
          },
        },
      ),
    );
    expect(richTextToPlainText(parsed)).toBe('Heading\nFirst\nItem\nAlt text');
    expect(richTextMediaIds(parsed)).toEqual(['0193e0a4-6a5b-7c2d-8e9f-0a1b2c3d4e5f']);
  });

  it('classifies link targets', () => {
    for (const ok of [
      'https://a.example/x?y#z',
      'http://a.example',
      'mailto:a@b.c',
      'tel:+123',
      '/about',
      '#top',
      '?q=1',
    ]) {
      expect(isSafeLinkHref(ok), ok).toBe(true);
    }
    for (const bad of [
      'javascript:x',
      'JAVASCRIPT:x',
      'vbscript:x',
      'file:///etc/passwd',
      '//evil',
      '/\\evil',
      'java\tscript:x',
      '',
    ]) {
      expect(isSafeLinkHref(bad), bad).toBe(false);
    }
  });
});

describe('custom fields', () => {
  const fields = fieldDefinitionsSchema.parse([
    { key: 'subtitle', label: 'Subtitle', type: 'text', maxLength: 10 },
    {
      key: 'price',
      label: 'Price',
      type: 'number',
      required: true,
      min: 0,
      max: 100,
      integer: true,
    },
    { key: 'featured', label: 'Featured', type: 'boolean' },
    { key: 'launch', label: 'Launch', type: 'date' },
    {
      key: 'size',
      label: 'Size',
      type: 'select',
      options: [
        { value: 's', label: 'Small' },
        { value: 'l', label: 'Large' },
      ],
    },
    { key: 'site', label: 'Site', type: 'url' },
    { key: 'contact', label: 'Contact', type: 'email' },
    { key: 'photo', label: 'Photo', type: 'media' },
  ]);
  const values = buildFieldValuesSchema(fields);

  it('accepts valid values, drops unknown keys and empty optional values', () => {
    expect(
      values.parse({
        subtitle: 'Short',
        price: 42,
        featured: true,
        launch: '2026-12-01',
        size: 'l',
        site: 'https://x.example',
        contact: 'a@b.example',
        photo: '0193e0a4-6a5b-7c2d-8e9f-0a1b2c3d4e5f',
        removed: 'x',
        subtitle2: '',
      }),
    ).toEqual({
      subtitle: 'Short',
      price: 42,
      featured: true,
      launch: '2026-12-01',
      size: 'l',
      site: 'https://x.example',
      contact: 'a@b.example',
      photo: '0193e0a4-6a5b-7c2d-8e9f-0a1b2c3d4e5f',
    });
    expect(values.parse({ price: 1, subtitle: '', site: null })).toEqual({ price: 1 });
  });

  it.each([
    [{}, 'price'],
    [{ price: 101 }, 'price'],
    [{ price: 1.5 }, 'price'],
    [{ price: 1, subtitle: 'far too long text' }, 'subtitle'],
    [{ price: 1, size: 'xl' }, 'size'],
    [{ price: 1, site: 'javascript:alert(1)' }, 'site'],
    [{ price: 1, launch: '01/12/2026' }, 'launch'],
    [{ price: 1, contact: 'nope' }, 'contact'],
    [{ price: 1, photo: 'not-a-uuid' }, 'photo'],
    [{ price: 1, featured: 'yes' }, 'featured'],
  ])('rejects %j at %s', (input, path) => {
    const result = values.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([path]);
  });

  it('rejects duplicate keys and inverted ranges in definitions', () => {
    const result = fieldDefinitionsSchema.safeParse([
      { key: 'a', label: 'A', type: 'text' },
      { key: 'a', label: 'A2', type: 'number', min: 5, max: 1 },
    ]);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'Field keys must be unique.',
      'Maximum is below minimum.',
    ]);
  });
});

describe('slugs', () => {
  it.each([
    ['Hello, World!', 'hello-world'],
    ['  Multiple   spaces -- and---dashes  ', 'multiple-spaces-and-dashes'],
    ['Café crème', 'café-crème'],
    ['سلام دنیا', 'سلام-دنیا'],
    ['日本語のタイトル', '日本語のタイトル'],
    ['../../etc/passwd', 'etc-passwd'],
    ['!!!', ''],
  ])('slugify(%j) = %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('validates explicit slugs', () => {
    expect(slugSchema.safeParse('valid-slug-2').success).toBe(true);
    expect(slugSchema.safeParse('سلام-دنیا').success).toBe(true);
    for (const bad of ['Upper', 'has space', 'a/b', 'double--dash', '-lead', 'trail-', 'q?x', '']) {
      expect(slugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
