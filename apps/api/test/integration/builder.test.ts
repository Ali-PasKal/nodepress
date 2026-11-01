import {
  createSection,
  createWidget,
  deliveryEmbedSchema,
  deliveryPageSchema,
  entryListResponseSchema,
  previewLinkSchema,
  revisionSummarySchema,
  type BuilderDocument,
  type DeliveryEntry,
} from '@nexora/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEntry, idsByKey, paragraphDoc, patchEntry, signInAs } from '../helpers/content.js';
import {
  createIdentityApp,
  install,
  OWNER,
  resetIdentityData,
  signIn,
  type SignedIn,
} from '../helpers/identity.js';
import { MINIMAL_PDF, pngImage, upload } from '../helpers/media.js';
import type { TestApp } from '../helpers/test-app.js';

function documentWith(...widgets: ReturnType<typeof createWidget>[]): BuilderDocument {
  const section = createSection([60, 40]);
  section.children[0]!.children.push(...widgets);
  return { schemaVersion: 1, settings: { hideTitle: true }, sections: [section] };
}

describe('visual builder and shortcodes', () => {
  let testApp: TestApp;
  let owner: SignedIn;
  let editor: SignedIn;
  let author: SignedIn;

  async function deliveredEntry(path: string): Promise<DeliveryEntry> {
    const response = await request(testApp.server)
      .get('/api/v1/delivery/page')
      .query({ path })
      .expect(200);
    const page = deliveryPageSchema.parse(response.body);
    if (page.route.kind !== 'entry')
      throw new Error(`expected an entry at ${path}, got ${page.route.kind}`);
    return page.route.entry;
  }

  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
    await install(testApp.server);
    owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    editor = await signInAs(testApp.server, owner, 'editor');
    author = await signInAs(testApp.server, owner, 'author');
  });
  afterAll(() => testApp.close());

  it('stores builder documents for types that opt in and validates them', async () => {
    const { type } = await idsByKey(owner);
    expect(type('page').hasBuilder).toBe(true);
    expect(type('post').hasBuilder).toBe(false);
    const heading = createWidget('heading');
    heading.props.text = 'Welcome to the builder';
    const document = documentWith(heading, createWidget('button'));

    const refused = await createEntry(
      owner,
      { title: 'Post', editor: 'builder', builder: document },
      422,
    );
    expect(
      (refused as unknown as { error: { issues: { path: string }[] } }).error.issues[0]?.path,
    ).toBe('editor');

    const page = await createEntry(owner, {
      type: 'page',
      title: 'Landing',
      editor: 'builder',
      builder: document,
    });
    expect(page.editor).toBe('builder');
    expect(page.builder?.sections[0]?.children[0]?.children.map((widget) => widget.widget)).toEqual(
      ['heading', 'button'],
    );
    const search = entryListResponseSchema.parse(
      (
        await owner.agent
          .get('/api/v1/entries')
          .query({ type: 'page', search: 'welcome to the builder' })
          .expect(200)
      ).body,
    );
    expect(search.items.map((item) => item.id)).toEqual([page.id]);

    const hostile = structuredClone(document) as unknown as {
      sections: { children: { children: { props: Record<string, unknown> }[] }[] }[];
    };
    hostile.sections[0]!.children[0]!.children[1]!.props.url = 'javascript:alert(1)';
    const invalid = await patchEntry(owner, page, { builder: hostile }, 422);
    expect(invalid.body.error.issues[0].path).toBe(
      'builder.sections.0.children.0.children.1.props.url',
    );
    const newer = await patchEntry(
      owner,
      page,
      { builder: { ...document, schemaVersion: 2 } },
      422,
    );
    expect(newer.body.error.issues[0].message).toContain('newer version');
  });

  it('starts the builder from the rich-text body and keeps revisions of layouts', async () => {
    const page = await createEntry(owner, {
      type: 'page',
      title: 'About',
      body: paragraphDoc('Original body text'),
    });
    expect(page.editor).toBe('rich_text');
    const switched = (await patchEntry(owner, page, { editor: 'builder' })).body as {
      version: number;
      builder: BuilderDocument;
    };
    const text = switched.builder.sections[0]?.children[0]?.children[0];
    expect(text?.widget).toBe('text');
    expect(JSON.stringify(text)).toContain('Original body text');

    const edited = structuredClone(switched.builder);
    edited.sections.push(createSection([100]));
    const saved = (
      await patchEntry(owner, { id: page.id, version: switched.version }, { builder: edited })
    ).body as {
      version: number;
    };
    const revisions = revisionSummarySchema
      .array()
      .parse((await owner.agent.get(`/api/v1/entries/${page.id}/revisions`).expect(200)).body);
    expect(revisions).toHaveLength(3);
    const restored = (
      await owner.agent
        .post(`/api/v1/entries/${page.id}/revisions/${revisions[1]!.id}/restore`)
        .set('X-CSRF-Token', owner.csrf)
        .send({ version: saved.version })
        .expect(200)
    ).body as { builder: BuilderDocument; editor: string };
    expect(restored.editor).toBe('builder');
    expect(restored.builder.sections).toHaveLength(1);
  });

  it('requires content.embed_html to add or change HTML embeds', async () => {
    const embed = createWidget('html');
    embed.props.html = '<script>document.title = "x"</script><p>Booking widget</p>';
    const document = documentWith(embed);
    const denied = await author.agent
      .post('/api/v1/entries')
      .set('X-CSRF-Token', author.csrf)
      .send({ type: 'page', title: 'Author page', editor: 'builder', builder: document })
      .expect(403);
    expect(denied.body.error.message).toBe(
      'You do not have permission to add or change HTML embeds.',
    );
    const page = await createEntry(editor, {
      type: 'page',
      title: 'Editor page',
      editor: 'builder',
      builder: document,
    });
    expect(page.builder?.sections[0]?.children[0]?.children[0]?.widget).toBe('html');

    // An author may keep an embed an editor added to their page, but not change it or add another.
    const own = await createEntry(author, { type: 'page', title: 'Own page', editor: 'builder' });
    const withEmbed = (
      await patchEntry(editor, own, { builder: documentWith(structuredClone(embed)) })
    ).body as { version: number; builder: BuilderDocument };
    const kept = (
      await patchEntry(
        author,
        { id: own.id, version: withEmbed.version },
        {
          title: 'Own page, renamed',
          builder: withEmbed.builder,
        },
      )
    ).body as { version: number; builder: BuilderDocument };
    const changed = structuredClone(kept.builder);
    const changedEmbed = changed.sections[0]?.children[0]?.children[0];
    if (changedEmbed?.widget !== 'html') throw new Error('expected the embed');
    changedEmbed.props.html = '<p>Swapped code</p>';
    await patchEntry(author, { id: own.id, version: kept.version }, { builder: changed }, 403);
    const another = structuredClone(kept.builder);
    another.sections[0]?.children[0]?.children.push(createWidget('html'));
    await patchEntry(author, { id: own.id, version: kept.version }, { builder: another }, 403);
  });

  it('delivers builder pages with compiled CSS, resolved dynamic content and sandboxable embeds', async () => {
    const photo = (await upload(owner, await pngImage(640, 480), 'photo.png').expect(201)).body as {
      id: string;
    };
    const pdf = (await upload(owner, MINIMAL_PDF, 'file.pdf').expect(201)).body as { id: string };
    await createEntry(owner, { title: 'Public news', status: 'published' });
    await createEntry(owner, { title: 'Secret draft' });

    const heading = createWidget('heading');
    heading.styles = { desktop: { fontSize: 40 }, mobile: { fontSize: 24 } };
    const text = createWidget('text');
    text.props.content = paragraphDoc(
      `Latest: [recent_posts count=5] Gallery: [gallery ids="${photo.id},${pdf.id}"] Year [year] [unknown_code]`,
    ) as typeof text.props.content;
    const image = createWidget('image');
    image.props.mediaId = photo.id;
    const posts = createWidget('posts');
    const embed = createWidget('html');
    embed.props.html = '<p>Map embed</p>';
    const document = documentWith(heading, text, image, posts, embed);
    const page = await createEntry(owner, {
      type: 'page',
      title: 'Showcase',
      status: 'published',
      editor: 'builder',
      builder: document,
    });

    const delivered = await deliveredEntry('/showcase');
    expect(delivered.editor).toBe('builder');
    expect(delivered.builder?.settings.hideTitle).toBe(true);
    expect(delivered.builderCss).toContain(`.nx-el-${heading.id}{font-size:40px}`);
    expect(delivered.builderCss).toContain('@container nxb (max-width:640px)');
    expect(delivered.media[photo.id]?.width).toBe(640);
    // Embed HTML is not part of the page payload.
    const deliveredEmbed = delivered.builder?.sections[0]?.children[0]?.children.find(
      (widget) => widget.widget === 'html',
    );
    expect(deliveredEmbed?.widget === 'html' && deliveredEmbed.props.html).toBe('');
    expect(JSON.stringify(delivered)).not.toContain('Map embed');
    // Dynamic content only shows public entries and images.
    const recent = delivered.shortcodes['recent_posts?count=5'];
    expect(recent?.name === 'recent_posts' && recent.items.map((item) => item.title)).toEqual([
      'Public news',
    ]);
    const gallery = Object.values(delivered.shortcodes).find((item) => item.name === 'gallery');
    expect(gallery?.name === 'gallery' && gallery.media.map((item) => item.id)).toEqual([photo.id]);
    expect(delivered.posts[posts.id]?.map((item) => item.title)).toEqual(['Public news']);
    expect(Object.keys(delivered.shortcodes)).toHaveLength(2);
    // The summary derives from the layout text without shortcode tokens.
    expect(delivered.summary).not.toContain('[');

    const served = deliveryEmbedSchema.parse(
      (
        await request(testApp.server)
          .get(`/api/v1/delivery/embed/${page.id}/${embed.id}`)
          .expect(200)
      ).body,
    );
    expect(served).toEqual({ html: '<p>Map embed</p>', title: 'Embedded content' });
    await request(testApp.server)
      .get(`/api/v1/delivery/embed/${page.id}/${heading.id}`)
      .expect(404);
    await request(testApp.server).get(`/api/v1/delivery/embed/${page.id}/bad-id`).expect(404);
    await request(testApp.server).get(`/api/v1/delivery/embed/not-a-uuid/${embed.id}`).expect(404);

    // A draft's embed is only reachable through a preview link.
    const draft = await createEntry(owner, {
      type: 'page',
      title: 'Draft layout',
      editor: 'builder',
      builder: documentWith(embed),
    });
    await request(testApp.server).get(`/api/v1/delivery/embed/${draft.id}/${embed.id}`).expect(404);
    const link = previewLinkSchema.parse(
      (
        await owner.agent
          .post(`/api/v1/entries/${draft.id}/preview`)
          .set('X-CSRF-Token', owner.csrf)
          .expect(200)
      ).body,
    );
    const token = link.url.split('/').at(-1)!;
    const previewed = await request(testApp.server)
      .get(`/api/v1/delivery/preview/${token}/embed/${embed.id}`)
      .expect(200);
    expect(previewed.headers['cache-control']).toBe('no-store');
    expect(previewed.body.html).toBe('<p>Map embed</p>');
    await request(testApp.server)
      .get(`/api/v1/delivery/preview/${'A'.repeat(43)}/embed/${embed.id}`)
      .expect(404);
  });
});
