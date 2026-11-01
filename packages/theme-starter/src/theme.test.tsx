import { readFileSync } from 'node:fs';
import { resolveThemeSettings, themeManifestSchema, type DeliverySite } from '@nexora/shared';
import type { ThemeRenderContext, ThemeView } from '@nexora/theme-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { manifest } from './manifest.js';
import { theme } from './render.js';

const site: DeliverySite = {
  name: 'Site',
  tagline: 'Tagline',
  baseUrl: 'https://example.test',
  language: 'en',
  direction: 'ltr',
  seo: { titleTemplate: '%title%', defaultDescription: '', defaultImage: null, indexing: true },
  theme: { key: 'starter', settings: resolveThemeSettings(manifest, {}), media: {} },
  menus: {
    primary: [{ label: 'About', url: '/about', openInNewTab: false, children: [] }],
    footer: [{ label: 'Privacy', url: '/privacy', openInNewTab: false, children: [] }],
  },
};

function render(view: ThemeView, overrides: Partial<ThemeRenderContext> = {}): string {
  return renderToStaticMarkup(
    theme.render({
      site,
      view,
      path: '/',
      preview: false,
      pageUrl: (page) => `/?page=${String(page)}`,
      ...overrides,
    }),
  );
}

describe('starter theme', () => {
  it('ships a valid manifest with defaults for every setting', () => {
    expect(themeManifestSchema.parse(manifest)).toEqual(manifest);
    expect(resolveThemeSettings(manifest, { accentColor: 'nope' }).accentColor).toBe('#1d4ed8');
  });

  it('maps settings to CSS variables and html attributes from fixed lists', () => {
    const settings = resolveThemeSettings(manifest, {
      accentColor: '#123abc',
      fontFamily: 'serif',
      contentWidth: 'wide',
      colorScheme: 'dark',
    });
    expect(theme.cssVariables(settings)).toEqual({
      '--nx-accent': '#123abc',
      '--nx-font': expect.stringContaining('Georgia') as string,
      '--nx-content-width': '62rem',
    });
    expect(theme.htmlAttributes(settings)).toEqual({ 'data-scheme': 'dark' });
  });

  it('renders the landmarks, menus and an empty listing', () => {
    const html = render({
      kind: 'home',
      entry: null,
      listing: { items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 },
    });
    expect(html).toContain('<a class="nx-skip-link" href="#content">Skip to content</a>');
    expect(html).toContain('<nav class="nx-primary-nav" aria-label="Main">');
    expect(html).toContain('<main id="content"');
    expect(html).toContain('<a href="/privacy">Privacy</a>');
    expect(html).toContain('Nothing has been published here yet.');
    expect(html).toContain('<p class="nx-tagline">Tagline</p>');
    expect(html).not.toContain('nx-pagination');
  });

  it('renders the not-found page and the preview notice', () => {
    expect(render({ kind: 'not_found' })).toContain('<h1>Page not found</h1>');
    expect(render({ kind: 'not_found' }, { preview: true })).toContain('role="status"');
  });

  it('hides the tagline when the setting is off and uses Persian labels for Persian sites', () => {
    const html = renderToStaticMarkup(
      theme.render({
        site: {
          ...site,
          language: 'fa-IR',
          direction: 'rtl',
          theme: { ...site.theme, settings: { ...site.theme.settings, showTagline: false } },
        },
        view: { kind: 'not_found' },
        path: '/x',
        preview: false,
        pageUrl: () => '/',
      }),
    );
    expect(html).not.toContain('nx-tagline');
    expect(html).toContain('صفحه پیدا نشد');
  });

  it('uses logical CSS properties only (right-to-left support)', () => {
    const css = readFileSync(theme.stylesheet, 'utf8');
    expect(css).not.toMatch(
      /(margin|padding|border)-(left|right)\b|\b(left|right):|text-align:\s*(left|right)/,
    );
  });
});
