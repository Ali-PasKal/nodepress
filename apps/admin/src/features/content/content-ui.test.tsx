import type { ContentModelResponse, EntryListResponse, RichTextDocument } from '@nexora/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { visibleNavigation } from '../../layouts/navigation';
import { sessionFixture } from '../../test/fixtures';
import { json, mockFetch, renderAdmin } from '../../test/render';
import { RichTextView } from './rich-text-view';
import { orderTerms } from './term-order';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ID = (n: number) => `0193e0a4-6a5b-7c2d-8e9f-${String(n).padStart(12, '0')}`;

const MODEL: ContentModelResponse = {
  contentTypes: [
    {
      id: ID(1),
      key: 'post',
      name: 'Post',
      pluralName: 'Posts',
      description: '',
      hierarchical: false,
      hasBody: true,
      hasExcerpt: true,
      hasFeaturedImage: true,
      hasBuilder: false,
      isSystem: true,
      routePrefix: 'blog',
      isPublic: true,
      fields: [],
      taxonomyIds: [ID(3)],
      entryCount: 2,
    },
    {
      id: ID(2),
      key: 'page',
      name: 'Page',
      pluralName: 'Pages',
      description: '',
      hierarchical: true,
      hasBody: true,
      hasExcerpt: true,
      hasFeaturedImage: true,
      hasBuilder: false,
      isSystem: true,
      routePrefix: '',
      isPublic: true,
      fields: [],
      taxonomyIds: [],
      entryCount: 0,
    },
  ],
  taxonomies: [
    {
      id: ID(3),
      key: 'category',
      name: 'Category',
      pluralName: 'Categories',
      description: '',
      hierarchical: true,
      isSystem: true,
      routePrefix: 'category',
      isPublic: true,
      contentTypeIds: [ID(1)],
      termCount: 0,
    },
  ],
};

describe('RichTextView', () => {
  it('renders allowed structure and escapes text', () => {
    const document = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '<script>alert(1)</script>' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            {
              type: 'text',
              text: 'link',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }],
            },
          ],
        },
      ],
    } as RichTextDocument;
    const { container } = render(<RichTextView document={document} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Heading' })).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    const link = screen.getByRole('link', { name: 'link' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(screen.getByRole('listitem')).toHaveTextContent('item');
  });

  it('drops unsafe links and images even if they reach the client', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click me',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
        { type: 'image', attrs: { src: 'javascript:alert(1)', alt: 'bad' } },
        { type: 'image', attrs: { src: '/uploads/2026/11/AAAAAAAAAAAA/ok.png', alt: 'fine' } },
      ],
    } as unknown as RichTextDocument;
    const { container } = render(<RichTextView document={document} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('click me')).toBeInTheDocument();
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'fine' })).toHaveAttribute(
      'src',
      '/uploads/2026/11/AAAAAAAAAAAA/ok.png',
    );
  });

  it('says so when there is no content', () => {
    render(<RichTextView document={{ type: 'doc', content: [] }} />);
    expect(screen.getByText('No content.')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  const labels = (capabilities: string[]) =>
    visibleNavigation(new Set(capabilities), MODEL).flatMap((group) =>
      group.items.map((item) => item.label),
    );

  it('lists content types and taxonomies from the content model, filtered by capability', () => {
    expect(
      labels(['dashboard.access', 'content.create', 'content.publish', 'media.upload']),
    ).toEqual(['Dashboard', 'Posts', 'Pages', 'Media', 'System status']);
    expect(labels(['dashboard.access', 'content.read'])).toEqual([
      'Dashboard',
      'Posts',
      'Pages',
      'Media',
      'System status',
    ]);
    expect(labels(['dashboard.access'])).toEqual(['Dashboard', 'System status']);
    expect(labels(['dashboard.access', 'seo.manage'])).toEqual([
      'Dashboard',
      'SEO',
      'Redirects',
      'System status',
    ]);
    expect(labels(['dashboard.access', 'appearance.manage', 'seo.manage'])).toEqual([
      'Dashboard',
      'Appearance',
      'Menus',
      'SEO',
      'Redirects',
      'System status',
    ]);
    expect(labels(['content.read', 'terms.manage', 'content_types.manage', 'jobs.manage'])).toEqual(
      [
        'Dashboard',
        'Posts',
        'Pages',
        'Media',
        'Categories',
        'System status',
        'Background jobs',
        'Content types',
      ],
    );
  });
});

describe('orderTerms', () => {
  it('orders terms as a tree and treats terms with unknown parents as roots', () => {
    const term = (id: number, name: string, parent: number | null) => ({
      id: ID(id),
      taxonomyId: ID(99),
      parentId: parent === null ? null : ID(parent),
      name,
      slug: name.toLowerCase(),
      description: '',
      entryCount: 0,
    });
    const ordered = orderTerms([
      term(3, 'Child', 1),
      term(1, 'Root', null),
      term(4, 'Grandchild', 3),
      term(5, 'Orphan', 42),
    ]);
    expect(ordered.map(({ term: item, depth }) => [item.name, depth])).toEqual([
      ['Root', 0],
      ['Child', 1],
      ['Grandchild', 2],
      ['Orphan', 0],
    ]);
  });
});

describe('entries page', () => {
  const list: EntryListResponse = {
    items: [
      {
        id: ID(10),
        contentTypeId: ID(1),
        title: 'Hello world',
        slug: 'hello-world',
        path: 'hello-world',
        url: '/blog/hello-world',
        status: 'published',
        trashedAt: null,
        parentId: null,
        author: { id: ID(20), displayName: 'Ada Author' },
        publishedAt: '2026-11-01T10:00:00.000Z',
        createdAt: '2026-11-01T09:00:00.000Z',
        updatedAt: '2026-11-01T10:00:00.000Z',
        version: 2,
        terms: [],
        featuredMedia: null,
        permissions: { edit: true, publish: true, trash: true, restore: false, delete: false },
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
    counts: { all: 1, draft: 0, pending: 0, scheduled: 0, published: 1, trash: 0 },
  };

  it('shows status tabs with counts, rows and the actions the user may take', async () => {
    mockFetch({
      '/api/v1/system/status': () => json({ installed: true }),
      '/api/v1/auth/session': () =>
        json(
          sessionFixture([
            'dashboard.access',
            'content.create',
            'content.publish',
            'content.delete',
          ]),
        ),
      '/api/v1/content-model': () => json(MODEL),
      '/api/v1/taxonomies/0193e0a4-6a5b-7c2d-8e9f-000000000003/terms?pageSize=200': () =>
        json({ items: [], page: 1, pageSize: 200, total: 0 }),
      '/api/v1/entries?type=post&status=all&page=1&pageSize=20&sort=updated': () => json(list),
    });
    renderAdmin('/content/post');
    expect(await screen.findByRole('heading', { level: 1, name: 'Posts' })).toBeInTheDocument();
    const row = await screen.findByTestId('entry-row');
    expect(within(row).getByRole('link', { name: 'Hello world' })).toHaveAttribute(
      'href',
      `/content/post/${ID(10)}`,
    );
    expect(screen.getByRole('button', { name: /^Published/ })).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: 'New post' })).toBeInTheDocument();

    await userEvent.click(within(row).getByRole('checkbox'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to trash' })).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Actions for Hello world' }));
    expect(await screen.findByRole('menuitem', { name: /Move to trash/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Delete permanently/ })).toBeNull();
  });

  it('shows a not-found page for unknown content types', async () => {
    mockFetch({
      '/api/v1/system/status': () => json({ installed: true }),
      '/api/v1/auth/session': () => json(sessionFixture(['dashboard.access', 'content.read'])),
      '/api/v1/content-model': () => json(MODEL),
    });
    renderAdmin('/content/unknown');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
  });

  it('denies the page to users without content capabilities', async () => {
    mockFetch({
      '/api/v1/system/status': () => json({ installed: true }),
      '/api/v1/auth/session': () => json(sessionFixture(['dashboard.access'])),
    });
    renderAdmin('/content/post');
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });
});
