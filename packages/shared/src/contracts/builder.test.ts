import { describe, expect, it } from 'vitest';
import {
  BUILDER_SCHEMA_VERSION,
  builderDocumentSchema,
  builderFromRichText,
  builderMediaIds,
  builderPlainText,
  cloneWithNewIds,
  compileBuilderCss,
  createSection,
  createWidget,
  shortcodeTexts,
  type BuilderDocument,
} from './builder.js';
import {
  collectShortcodes,
  parseShortcodes,
  shortcodeKey,
  validateShortcode,
} from './shortcodes.js';

const MEDIA = '0193e0a4-6a5b-7c2d-8e9f-000000000001';

function documentWith(...widgets: ReturnType<typeof createWidget>[]): BuilderDocument {
  const section = createSection([50, 50]);
  section.children[0]!.children.push(...widgets);
  return {
    schemaVersion: BUILDER_SCHEMA_VERSION,
    settings: { hideTitle: false },
    sections: [section],
  };
}

describe('shortcode parser', () => {
  it('splits text into literal text and shortcodes with quoted, bare and flag attributes', () => {
    expect(
      parseShortcodes('Hi [button text="Buy now" url=\'/shop\' style=outline new_tab] there'),
    ).toEqual([
      { type: 'text', text: 'Hi ' },
      {
        type: 'shortcode',
        name: 'button',
        attrs: { text: 'Buy now', url: '/shop', style: 'outline', new_tab: '' },
        raw: '[button text="Buy now" url=\'/shop\' style=outline new_tab]',
      },
      { type: 'text', text: ' there' },
    ]);
    expect(parseShortcodes('© [year/] [site_name]').map((segment) => segment.type)).toEqual([
      'text',
      'shortcode',
      'text',
      'shortcode',
    ]);
  });

  it('treats escaped shortcodes, non-shortcode brackets and malformed input as text', () => {
    expect(parseShortcodes('Use [[year]] to show [year]')).toEqual([
      { type: 'text', text: 'Use [year] to show ' },
      { type: 'shortcode', name: 'year', attrs: {}, raw: '[year]' },
    ]);
    for (const text of [
      '[1] footnote',
      'a [B] c',
      '[button text="unterminated]',
      '[ year ]',
      'no brackets',
    ]) {
      expect(
        parseShortcodes(text).every((segment) => segment.type === 'text'),
        text,
      ).toBe(true);
    }
    // Long hostile input is handled in linear time.
    const hostile = `[button${' a='.repeat(5_000)}`;
    const started = Date.now();
    parseShortcodes(hostile);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('validates registered shortcodes and rejects unknown names, attributes and unsafe values', () => {
    const parse = (text: string) => {
      const token = parseShortcodes(text).find((segment) => segment.type === 'shortcode');
      if (token?.type !== 'shortcode') throw new Error('no shortcode');
      return validateShortcode(token);
    };
    expect(parse('[recent_posts count="5" category=news]')).toMatchObject({
      ok: true,
      value: { name: 'recent_posts', attrs: { count: 5, type: 'post', category: 'news' } },
    });
    expect(parse('[button text=Go url="/x" new_tab=yes]')).toMatchObject({
      ok: true,
      value: { attrs: { new_tab: true, style: 'primary' } },
    });
    expect(parse('[contact_form id=1]')).toEqual({
      ok: false,
      reason: 'Unknown shortcode "contact_form".',
    });
    expect(parse('[year format=long]')).toMatchObject({ ok: false });
    expect(parse('[button text=Go url="javascript:alert(1)"]')).toMatchObject({ ok: false });
    expect(parse('[recent_posts count=500]')).toMatchObject({ ok: false });
    expect(parse('[video youtube=abc]')).toMatchObject({ ok: false });
    expect(parse('[video]')).toMatchObject({ ok: false });
    expect(parse('[gallery ids="not-a-uuid"]')).toMatchObject({ ok: false });
    expect(parse(`[gallery ids="${MEDIA}, ${MEDIA.toUpperCase()}"]`)).toMatchObject({
      ok: true,
      value: { attrs: { ids: [MEDIA, MEDIA], columns: 3 } },
    });
  });

  it('keys occurrences by name and sorted attributes and collects each once', () => {
    expect(shortcodeKey({ name: 'recent_posts', attrs: { type: 'post', count: '3' } })).toBe(
      'recent_posts?count=3&type=post',
    );
    expect(
      collectShortcodes([
        '[recent_posts count=3 type=post] and [recent_posts type=post count=3]',
        '[nope]',
      ]).map((item) => item.key),
    ).toEqual(['recent_posts?count=3&type=post']);
  });
});

describe('builder documents', () => {
  it('creates valid widgets and sections with defaults', () => {
    const document = documentWith(
      createWidget('heading'),
      createWidget('button'),
      createWidget('video'),
    );
    const parsed = builderDocumentSchema.parse(document);
    expect(parsed.sections[0]?.children).toHaveLength(2);
    expect(parsed.sections[0]?.children[0]?.children.map((widget) => widget.widget)).toEqual([
      'heading',
      'button',
      'video',
    ]);
  });

  it('rejects hostile or malformed documents with field paths', () => {
    const issues = (value: unknown) => {
      const result = builderDocumentSchema.safeParse(value);
      return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    };
    const base = documentWith(createWidget('button'));
    const button = base.sections[0]!.children[0]!.children[0]!;
    const withProps = (props: Record<string, unknown>) =>
      JSON.parse(
        JSON.stringify({
          ...base,
          sections: [
            {
              ...base.sections[0],
              children: [
                {
                  ...base.sections[0]!.children[0],
                  children: [{ ...button, props: { ...button.props, ...props } }],
                },
                base.sections[0]!.children[1],
              ],
            },
          ],
        }),
      ) as unknown;
    expect(issues(withProps({ url: 'javascript:alert(1)' }))).toEqual([
      'sections.0.children.0.children.0.props.url',
    ]);
    expect(issues(withProps({ onclick: 'x' }))).toEqual(['sections.0.children.0.children.0.props']);
    const styled = structuredClone(base) as unknown as {
      sections: { styles: { desktop: Record<string, unknown> } }[];
    };
    styled.sections[0]!.styles.desktop.backgroundColor = 'red;}body{display:none';
    expect(issues(styled)).toEqual(['sections.0.styles.desktop.backgroundColor']);
    styled.sections[0]!.styles.desktop = { width: '100px' };
    expect(issues(styled)).toEqual(['sections.0.styles.desktop']);
    const duplicate = structuredClone(base);
    duplicate.sections[0]!.children[1]!.id = duplicate.sections[0]!.children[0]!.id;
    expect(issues(duplicate)).toEqual(['sections.0.children.1.id']);
    expect(issues({ ...base, schemaVersion: BUILDER_SCHEMA_VERSION + 1 })).toEqual([
      'schemaVersion',
    ]);
    expect(issues({ ...base, sections: [{ ...base.sections[0], children: [] }] })).toEqual([
      'sections.0.children',
    ]);
    const unknownWidget = structuredClone(base) as unknown as {
      sections: { children: { children: { widget: string }[] }[] }[];
    };
    unknownWidget.sections[0]!.children[0]!.children[0]!.widget = 'script';
    expect(issues(unknownWidget)).toEqual(['sections.0.children.0.children.0.widget']);
  });

  it('compiles validated styles into scoped CSS with container-query breakpoints', () => {
    const heading = createWidget('heading');
    heading.styles = {
      desktop: { fontSize: 48, textColor: '#112233' },
      mobile: { fontSize: 28, hidden: true },
    };
    const spacer = createWidget('spacer');
    const document = documentWith(heading, spacer);
    const section = document.sections[0]!;
    section.styles = {
      desktop: { paddingTop: 80, backgroundColor: '#ffffff' },
      tablet: { paddingTop: 40 },
    };
    section.children[1]!.width = { desktop: 50, tablet: 100 };
    const css = compileBuilderCss(builderDocumentSchema.parse(document));
    expect(css).toContain(`.nx-el-${heading.id}{color:#112233;font-size:48px}`);
    expect(css).toContain(
      `.nx-el-${section.id}{padding-block-start:80px;background-color:#ffffff}`,
    );
    expect(css).toContain(`.nx-el-${section.id}>.nx-b-row{gap:24px}`);
    expect(css).toContain(`.nx-el-${spacer.id}{height:48px}`);
    expect(css).toContain(
      `.nx-el-${section.children[0]!.id}{flex:0 0 calc(50% - 12.00px);max-width:calc(50% - 12.00px)}`,
    );
    expect(css).toContain(
      `@container nxb (max-width:1024px){.nx-el-${section.id}{padding-block-start:40px}.nx-el-${section.children[1]!.id}{flex:0 0 100%;max-width:100%}}`,
    );
    expect(css).toContain(`@container nxb (max-width:640px){`);
    expect(css).toContain(`.nx-el-${heading.id}{font-size:28px;display:none!important}`);
    // Only the child combinator uses ">"; no markup, quotes or escapes can appear.
    expect(css).not.toMatch(/[<"'\\]/);
  });

  it('extracts searchable text, media, shortcode texts and duplicates with fresh ids', () => {
    const image = createWidget('image');
    image.props = { ...image.props, mediaId: MEDIA, caption: 'A caption' };
    const shortcode = createWidget('shortcode');
    shortcode.props = { code: '[recent_posts count=2]' };
    const document = documentWith(createWidget('heading'), image, shortcode);
    expect(builderPlainText(document)).toContain('Heading');
    expect(builderPlainText(document)).toContain('A caption');
    expect(builderMediaIds(document)).toEqual([MEDIA]);
    expect(shortcodeTexts({ type: 'doc', content: [] }, document)).toEqual([
      '[recent_posts count=2]',
    ]);
    const copy = cloneWithNewIds(document.sections[0]!);
    expect(copy.id).not.toBe(document.sections[0]!.id);
    expect(copy.children[0]!.children[0]!.id).not.toBe(
      document.sections[0]!.children[0]!.children[0]!.id,
    );
    const converted = builderFromRichText({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old body' }] }],
    });
    expect(builderPlainText(builderDocumentSchema.parse(converted))).toBe('Old body');
  });
});
