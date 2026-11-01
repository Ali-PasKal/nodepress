import { describe, expect, it } from 'vitest';
import {
  createContentTypeSchema,
  routePrefixSchema,
  updateContentTypeSchema,
  updateTermSchema,
} from './content-model.js';
import { encodeSitePath, publicEntryPath, publicTermPath } from './delivery.js';
import { saveMenuSchema } from './menus.js';
import { createRedirectSchema, isSafeRedirectTarget, redirectSourceSchema } from './redirects.js';
import { readingSettingsSchema, seoSettingsSchema, textDirection } from './settings.js';
import { buildThemeSettingsSchema, resolveThemeSettings, themeManifestSchema } from './themes.js';

describe('route prefixes and public paths', () => {
  it('accepts lower-case words and rejects reserved or malformed prefixes', () => {
    expect(routePrefixSchema.parse(' case-studies ')).toBe('case-studies');
    for (const bad of [
      'admin',
      'api',
      'uploads',
      '',
      'Blog',
      'a_b',
      '-a',
      'a-',
      'a--b',
      'a/b',
      'x'.repeat(65),
    ]) {
      expect(routePrefixSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('builds entry, term and encoded paths', () => {
    expect(publicEntryPath('blog', 'hello')).toBe('/blog/hello');
    expect(publicEntryPath('', 'about/team')).toBe('/about/team');
    expect(publicTermPath('tag', 'news')).toBe('/tag/news');
    expect(encodeSitePath('/درباره/a b')).toBe(`/${encodeURIComponent('درباره')}/a%20b`);
  });

  it('applies no defaults on partial updates', () => {
    expect(updateContentTypeSchema.parse({ name: 'X' })).toEqual({ name: 'X' });
    expect(updateTermSchema.parse({ name: 'X' })).toEqual({ name: 'X' });
    expect(
      createContentTypeSchema.parse({ key: 'thing', name: 'T', pluralName: 'Ts' }),
    ).toMatchObject({
      isPublic: true,
      fields: [],
    });
  });
});

describe('redirects', () => {
  it('normalises sources and refuses reserved or unsafe ones', () => {
    expect(redirectSourceSchema.parse('/old/')).toBe('/old');
    expect(redirectSourceSchema.parse('/%C3%BCber')).toBe('/über');
    expect(redirectSourceSchema.parse('/legacy.html')).toBe('/legacy.html');
    for (const bad of [
      '/',
      'old',
      '//x',
      '/a//b',
      '/a?b=1',
      '/a#b',
      '/a b',
      '/a\\b',
      '/admin',
      '/api/x',
      '/uploads/x',
      '/_assets/x',
      '/robots.txt',
      '/feed.xml',
    ]) {
      expect(redirectSourceSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('allows site paths and http(s) targets only', () => {
    for (const ok of ['/new', '/new?x=1#y', 'https://example.org/a', 'http://example.org']) {
      expect(isSafeRedirectTarget(ok), ok).toBe(true);
    }
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      '//evil.example',
      'ftp://x',
      'https://u:p@x',
      'relative',
      '/a b',
      '',
    ]) {
      expect(isSafeRedirectTarget(bad), bad).toBe(false);
    }
    expect(createRedirectSchema.safeParse({ fromPath: '/a', toPath: '/a' }).success).toBe(false);
    expect(createRedirectSchema.parse({ fromPath: '/a', toPath: '/b' }).statusCode).toBe(301);
  });
});

describe('site settings', () => {
  it('derives the text direction from the language tag', () => {
    expect(textDirection('fa')).toBe('rtl');
    expect(textDirection('fa-IR')).toBe('rtl');
    expect(textDirection('ar-EG')).toBe('rtl');
    expect(textDirection('he')).toBe('rtl');
    expect(textDirection('en')).toBe('ltr');
    expect(textDirection('az-Arab')).toBe('rtl');
    expect(textDirection('ku-Latn')).toBe('ltr');
  });

  it('fills defaults for stored settings', () => {
    expect(readingSettingsSchema.parse({})).toEqual({
      tagline: '',
      language: 'en',
      homepage: { mode: 'posts' },
      postsPerPage: 10,
    });
    expect(seoSettingsSchema.parse({})).toEqual({
      titleTemplate: '%title% – %site%',
      defaultDescription: '',
      defaultImageId: null,
      indexing: true,
    });
    expect(seoSettingsSchema.safeParse({ titleTemplate: 'No placeholder' }).success).toBe(false);
  });
});

describe('theme manifests and settings', () => {
  const manifest = themeManifestSchema.parse({
    key: 'demo',
    name: 'Demo',
    version: '1.0.0',
    settings: [
      { key: 'accent', type: 'color', label: 'Accent', default: '#112233' },
      {
        key: 'mode',
        type: 'select',
        label: 'Mode',
        options: [{ value: 'a', label: 'A' }],
        default: 'a',
      },
      { key: 'title', type: 'text', label: 'Title', maxLength: 10 },
      { key: 'image', type: 'media', label: 'Image' },
    ],
    menuLocations: [{ key: 'main', label: 'Main' }],
  });

  it('rejects inconsistent manifests', () => {
    expect(
      themeManifestSchema.safeParse({
        key: 'demo',
        name: 'Demo',
        version: '1.0.0',
        settings: [
          {
            key: 'mode',
            type: 'select',
            label: 'Mode',
            options: [{ value: 'a', label: 'A' }],
            default: 'b',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      themeManifestSchema.safeParse({
        key: 'demo',
        name: 'Demo',
        version: '1.0.0',
        settings: [
          { key: 'x', type: 'boolean', label: 'X', default: true },
          { key: 'x', type: 'boolean', label: 'X', default: true },
        ],
      }).success,
    ).toBe(false);
  });

  it('validates updates strictly and resolves stored values leniently', () => {
    const schema = buildThemeSettingsSchema(manifest);
    expect(schema.parse({ accent: '#AABBCC' })).toEqual({
      accent: '#aabbcc',
      mode: 'a',
      title: '',
      image: null,
    });
    expect(schema.safeParse({ extra: 1 }).success).toBe(false);
    expect(schema.safeParse({ title: 'x'.repeat(11) }).success).toBe(false);
    expect(schema.safeParse({ accent: 'blue' }).success).toBe(false);
    expect(
      resolveThemeSettings(manifest, { accent: 'blue', mode: 'gone', title: 'ok', other: 1 }),
    ).toEqual({
      accent: '#112233',
      mode: 'a',
      title: 'ok',
      image: null,
    });
    expect(resolveThemeSettings(manifest, 'garbage')).toEqual({
      accent: '#112233',
      mode: 'a',
      title: '',
      image: null,
    });
  });
});

describe('menus', () => {
  it('accepts an ordered tree and refuses forward references, cycles and deep nesting', () => {
    const ok = saveMenuSchema.parse({
      name: 'Main',
      location: 'primary',
      items: [
        { key: 'a', kind: 'home' },
        { key: 'b', parentKey: 'a', kind: 'url', url: '/x', label: 'X' },
      ],
    });
    expect(ok.items[1]).toMatchObject({ parentKey: 'a', openInNewTab: false, entryId: null });
    const cycle = saveMenuSchema.safeParse({
      name: 'Main',
      location: null,
      items: [
        { key: 'a', parentKey: 'b', kind: 'home' },
        { key: 'b', parentKey: 'a', kind: 'home' },
      ],
    });
    expect(cycle.success).toBe(false);
  });
});
