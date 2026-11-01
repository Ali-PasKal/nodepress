import { updateEntrySchema, type ContentModelResponse, type EntryDetail } from '@nexora/shared';
import type { z } from 'zod';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionFixture } from '../../test/fixtures';
import { json, renderAdmin } from '../../test/render';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ID = (n: number) => `0193e0a4-6a5b-7c2d-8e9f-${String(n).padStart(12, '0')}`;

function model(hasBuilder: boolean): ContentModelResponse {
  return {
    contentTypes: [
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
        hasBuilder,
        isSystem: true,
        routePrefix: '',
        isPublic: true,
        fields: [],
        taxonomyIds: [],
        entryCount: 1,
      },
    ],
    taxonomies: [],
  };
}

const ENTRY: EntryDetail = {
  id: ID(10),
  contentTypeId: ID(2),
  title: 'About us',
  slug: 'about-us',
  path: 'about-us',
  url: '/about-us',
  status: 'draft',
  trashedAt: null,
  parentId: null,
  author: { id: ID(20), displayName: 'Ada Author' },
  publishedAt: null,
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  version: 3,
  terms: [],
  featuredMedia: null,
  permissions: { edit: true, publish: true, trash: true, restore: false, delete: false },
  excerpt: '',
  body: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Existing introduction' }] }],
  },
  fields: {},
  termIds: [],
  lastEditor: null,
  seo: { title: '', description: '', noindex: false },
  editor: 'rich_text',
  builder: null,
};

interface Request {
  method: string;
  url: string;
  body: unknown;
}

/** A fetch stub that serves the builder's GET requests and records (and answers) entry updates. */
function stubApi(capabilities: string[], hasBuilder = true): Request[] {
  const requests: Request[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    requests.push({ method, url, body });
    if (url === '/api/v1/system/status') return json({ installed: true });
    if (url === '/api/v1/auth/session') return json(sessionFixture(capabilities));
    if (url === '/api/v1/content-model') return json(model(hasBuilder));
    if (url === `/api/v1/entries/${ID(10)}` && method === 'GET') return json(ENTRY);
    if (url === `/api/v1/entries/${ID(10)}` && method === 'PATCH') {
      const input = updateEntrySchema.parse(body);
      return json({
        ...ENTRY,
        version: ENTRY.version + 1,
        editor: input.editor,
        builder: input.builder,
        title: input.title ?? ENTRY.title,
        status: input.status ?? ENTRY.status,
      });
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };
  return requests;
}

/** The update request as the API reads it (validated with the shared schema). */
type SavedInput = z.output<typeof updateEntrySchema>;

const EDITOR = ['dashboard.access', 'content.create', 'content.edit_others', 'content.publish'];

describe('visual builder page', () => {
  it('starts from the rich-text body, adds widgets and saves the document', async () => {
    const requests = stubApi(EDITOR);
    const user = userEvent.setup();
    renderAdmin(`/content/page/${ID(10)}/builder`);

    const canvas = await screen.findByRole('main', { name: 'Canvas' });
    expect(await within(canvas).findByText('Existing introduction')).toBeInTheDocument();
    // HTML embeds need their own capability.
    const library = screen.getByRole('complementary', { name: 'Library' });
    expect(within(library).getByRole('button', { name: 'Add Heading' })).toBeInTheDocument();
    expect(within(library).queryByRole('button', { name: 'Add HTML embed' })).toBeNull();

    await user.click(within(library).getByRole('button', { name: 'Add Heading' }));
    const properties = screen.getByRole('complementary', { name: 'Properties' });
    const text = within(properties).getByRole('textbox', { name: 'Text' });
    await user.clear(text);
    await user.type(text, 'Welcome aboard');
    expect(within(canvas).getByRole('heading', { name: 'Welcome aboard' })).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    // A shortcode widget warns about unknown shortcodes (they render as plain text).
    await user.click(within(library).getByRole('button', { name: 'Add Shortcode' }));
    const code = within(properties).getByRole('textbox', { name: 'Shortcode' });
    // (paste, because user-event treats "[" as a key descriptor when typing)
    await user.clear(code);
    await user.paste('[nope]');
    expect(within(properties).getByText(/It will appear as plain text/)).toBeInTheDocument();
    await user.clear(code);
    await user.paste('[[nope]] [year]');
    expect(within(properties).queryByText(/It will appear as plain text/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    // Saved: the indicator clears and the button reflects the saved state.
    await waitFor(() => {
      expect(screen.queryByText('Unsaved changes')).toBeNull();
    });
    const patch = requests.find((request) => request.method === 'PATCH');
    const input: SavedInput = updateEntrySchema.parse(patch?.body);
    expect(input.version).toBe(3);
    expect(input.editor).toBe('builder');
    expect(input.status).toBeUndefined();
    const widgets = input.builder?.sections[0]?.children[0]?.children ?? [];
    expect(widgets.map((widget) => widget.widget)).toEqual(['text', 'heading', 'shortcode']);
    expect(widgets[1]?.props).toMatchObject({ text: 'Welcome aboard', level: 2 });
    expect(widgets[2]?.props).toMatchObject({ code: '[[nope]] [year]' });
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('undoes and redoes changes and publishes with the status', async () => {
    const requests = stubApi(EDITOR);
    const user = userEvent.setup();
    renderAdmin(`/content/page/${ID(10)}/builder`);
    const canvas = await screen.findByRole('main', { name: 'Canvas' });
    await within(canvas).findByText('Existing introduction');

    await user.click(screen.getByRole('button', { name: 'Add Divider' }));
    expect(within(canvas).getByRole('button', { name: 'Divider widget' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(canvas).queryByRole('button', { name: 'Divider widget' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(within(canvas).getByRole('button', { name: 'Divider widget' })).toBeInTheDocument();

    // A new section stays selected, so the next widget goes into its first column.
    await user.click(within(canvas).getByRole('button', { name: '2 columns' }));
    await user.click(screen.getByRole('button', { name: 'Add Spacer' }));
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    // Once published, the primary action becomes "Update".
    expect(await screen.findByRole('button', { name: 'Update' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    const input: SavedInput = updateEntrySchema.parse(
      requests.find((request) => request.method === 'PATCH')?.body,
    );
    expect(input.status).toBe('published');
    expect(input.builder?.sections).toHaveLength(2);
    expect(input.builder?.sections[1]?.children.map((column) => column.width.desktop)).toEqual([
      50, 50,
    ]);
    expect(
      input.builder?.sections[1]?.children.map((column) =>
        column.children.map((widget) => widget.widget),
      ),
    ).toEqual([['spacer'], []]);
  });

  it('offers HTML embeds only with the capability', async () => {
    stubApi([...EDITOR, 'content.embed_html']);
    renderAdmin(`/content/page/${ID(10)}/builder`);
    expect(await screen.findByRole('button', { name: 'Add HTML embed' })).toBeInTheDocument();
  });

  it('is not available for content types without the builder', async () => {
    stubApi(EDITOR, false);
    renderAdmin(`/content/page/${ID(10)}/builder`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
  });
});
