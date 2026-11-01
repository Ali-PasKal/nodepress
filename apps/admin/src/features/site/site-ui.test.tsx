import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionFixture } from '../../test/fixtures';
import { json, renderAdmin } from '../../test/render';

const ID = (n: number) => `0193e0a4-6a5b-7c2d-8e9f-${String(n).padStart(12, '0')}`;
const ADMIN = ['dashboard.access', 'appearance.manage', 'seo.manage', 'content.read'];

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** fetch mock keyed by "METHOD url" that records request bodies. */
function mockApi(routes: Record<string, (body: unknown) => Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, url, body });
    const responder = routes[`${method} ${url}`];
    if (!responder) throw new Error(`Unexpected fetch: ${method} ${url}`);
    return responder(body);
  };
  return calls;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const THEMES = {
  activeTheme: 'starter',
  themes: [
    {
      key: 'starter',
      name: 'Starter',
      version: '1.0.0',
      description: 'A theme.',
      author: 'NEXORA',
      settings: [
        {
          key: 'accentColor',
          type: 'color',
          label: 'Accent colour',
          description: '',
          default: '#1d4ed8',
        },
        {
          key: 'showTagline',
          type: 'boolean',
          label: 'Show the tagline',
          description: '',
          default: true,
        },
      ],
      menuLocations: [{ key: 'primary', label: 'Header navigation' }],
    },
  ],
};

const MODEL = {
  contentTypes: [
    {
      id: ID(1),
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
  taxonomies: [],
};

describe('appearance page', () => {
  it('generates theme setting inputs from the manifest and shows server validation errors', async () => {
    const calls = mockApi({
      'GET /api/v1/auth/session': () => json(sessionFixture(ADMIN)),
      'GET /api/v1/system/status': () => json({ installed: true }),
      'GET /api/v1/content-model': () => json(MODEL),
      'GET /api/v1/settings/general': () =>
        json({
          name: 'Site',
          tagline: '',
          language: 'fa',
          homepage: { mode: 'posts' },
          postsPerPage: 10,
        }),
      'GET /api/v1/appearance/themes': () => json(THEMES),
      'GET /api/v1/appearance/themes/starter/settings': () =>
        json({
          theme: 'starter',
          values: { accentColor: '#1d4ed8', showTagline: true },
          media: {},
        }),
      'GET /api/v1/entries?type=page&status=published&page=1&pageSize=100&sort=title': () =>
        json({
          items: [],
          page: 1,
          pageSize: 100,
          total: 0,
          counts: { all: 0, draft: 0, pending: 0, scheduled: 0, published: 0, trash: 0 },
        }),
      'PUT /api/v1/appearance/themes/starter/settings': () =>
        json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'The request contains invalid data.',
              issues: [{ path: 'values.accentColor', message: 'Use a colour like #1d4ed8.' }],
            },
          },
          422,
        ),
    });
    const user = userEvent.setup();
    renderAdmin('/appearance');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Appearance' }),
    ).toBeInTheDocument();
    // Direction follows the language tag.
    expect(await screen.findByText(/Text direction: right to left/)).toBeInTheDocument();
    const accent = await screen.findByLabelText('Accent colour');
    expect(screen.getByRole('checkbox', { name: 'Show the tagline' })).toBeChecked();
    await user.clear(accent);
    await user.type(accent, 'red');
    await user.click(screen.getByRole('button', { name: 'Save theme settings' }));
    expect(await screen.findByText('Use a colour like #1d4ed8.')).toBeInTheDocument();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.body).toEqual({ values: { accentColor: 'red', showTagline: true } });
  });
});

describe('redirects page', () => {
  it('validates targets in the browser before calling the API', async () => {
    const calls = mockApi({
      'GET /api/v1/auth/session': () => json(sessionFixture(ADMIN)),
      'GET /api/v1/system/status': () => json({ installed: true }),
      'GET /api/v1/content-model': () => json(MODEL),
      'GET /api/v1/redirects?page=1&pageSize=25': () =>
        json({ items: [], page: 1, pageSize: 25, total: 0 }),
    });
    const user = userEvent.setup();
    renderAdmin('/seo/redirects');
    expect(await screen.findByText('No redirects yet')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Add redirect' })[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Old path'), '/old');
    await user.type(within(dialog).getByLabelText('New address'), 'javascript:alert(1)');
    await user.click(within(dialog).getByRole('button', { name: 'Add redirect' }));
    expect(
      await within(dialog).findByText('Use a path on this site ("/new-page") or an http(s) URL.'),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });
});

describe('menus page', () => {
  it('edits a nested menu and saves parents as references to earlier items', async () => {
    const menu = {
      id: ID(50),
      name: 'Main',
      location: 'primary',
      itemCount: 2,
      updatedAt: '2026-11-01T10:00:00.000Z',
      items: [
        {
          id: ID(51),
          parentId: null,
          label: '',
          kind: 'home',
          entryId: null,
          termId: null,
          url: null,
          openInNewTab: false,
          target: { title: 'Home', url: '/', state: 'available' },
        },
        {
          id: ID(52),
          parentId: null,
          label: 'Docs',
          kind: 'url',
          entryId: null,
          termId: null,
          url: 'https://example.org',
          openInNewTab: false,
          target: { title: 'https://example.org', url: 'https://example.org', state: 'available' },
        },
      ],
    };
    const calls = mockApi({
      'GET /api/v1/auth/session': () => json(sessionFixture(ADMIN)),
      'GET /api/v1/system/status': () => json({ installed: true }),
      'GET /api/v1/content-model': () => json(MODEL),
      'GET /api/v1/menus': () =>
        json({
          menus: [
            {
              id: menu.id,
              name: 'Main',
              location: 'primary',
              itemCount: 2,
              updatedAt: menu.updatedAt,
            },
          ],
          locations: [{ key: 'primary', label: 'Header navigation', menuId: menu.id }],
        }),
      [`GET /api/v1/menus/${menu.id}`]: () => json(menu),
      'GET /api/v1/entries?type=page&status=all&page=1&pageSize=20&sort=title': () =>
        json({
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
          counts: { all: 0, draft: 0, pending: 0, scheduled: 0, published: 0, trash: 0 },
        }),
      [`PUT /api/v1/menus/${menu.id}`]: () =>
        json({ ...menu, updatedAt: '2026-11-01T10:05:00.000Z' }),
    });
    const user = userEvent.setup();
    renderAdmin('/appearance/menus');
    const items = await screen.findByRole('list', { name: 'Menu items' });
    const rows = within(items).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    // The first item cannot be nested; the second can go under it.
    expect(within(rows[0]!).getByRole('button', { name: 'Move in one level' })).toBeDisabled();
    await user.click(within(rows[1]!).getByRole('button', { name: 'Move in one level' }));
    await user.click(screen.getByRole('button', { name: 'Save menu' }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PUT')).toBe(true);
    });
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.body).toMatchObject({
      name: 'Main',
      location: 'primary',
      items: [
        { key: ID(51), parentKey: null, kind: 'home' },
        { key: ID(52), parentKey: ID(51), kind: 'url', url: 'https://example.org', label: 'Docs' },
      ],
    });
  });
});
