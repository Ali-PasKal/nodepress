import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  entry,
  fakeApi,
  HOSTILE,
  listing,
  media,
  site,
  type FakeApi,
  createTestApp,
} from './fixtures.js';

function jsonLd(html: string): unknown[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (match) => JSON.parse(match[1] ?? 'null') as unknown,
  );
}

describe('site runtime', () => {
  let api: FakeApi;
  let app: Express;

  beforeEach(async () => {
    api = fakeApi();
    app = await createTestApp(api);
  });

  it('renders the home page with strict security headers and revalidation caching', async () => {
    api.routes.set('/', {
      kind: 'home',
      canonicalUrl: 'https://example.test/',
      entry: null,
      listing: listing([entry()]),
    });
    const response = await request(app).get('/').expect(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    const csp = response.headers['content-security-policy']!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('script-src');
    expect(csp).toContain("frame-ancestors 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
    const etag = response.headers.etag!;
    expect(etag).toMatch(/^"/);

    const html = response.text;
    expect(html).toMatch(/^<!doctype html>\n<html lang="en" dir="ltr" data-scheme="auto">/);
    expect(html).toContain('<title>Example Site – Ideas &amp; notes</title>');
    expect(html).toContain('<link rel="canonical" href="https://example.test/">');
    expect(html).toContain('href="/feed.xml"');
    // No inline styles or executable scripts: only stylesheets from this origin and JSON-LD data.
    expect(html).not.toMatch(/<style|style="|<script(?! type="application\/ld\+json")/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(jsonLd(html)).toEqual([
      expect.objectContaining({
        '@type': 'WebSite',
        name: 'Example Site',
        url: 'https://example.test/',
      }),
    ]);
    // Same content → same ETag → 304.
    await request(app).get('/').set('If-None-Match', etag).expect(304);
  });

  it('escapes hostile content everywhere and drops unsafe links', async () => {
    api.routes.set('/blog/hello', { kind: 'entry', entry: entry() });
    const html = (await request(app).get('/blog/hello').expect(200)).text;
    expect(html).not.toContain(HOSTILE);
    expect(html).not.toContain('</script> Lovelace');
    expect(html).toContain('Hello &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://good.example/" rel="noopener noreferrer"');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    const [data] = jsonLd(html) as [Record<string, unknown>];
    expect(data).toMatchObject({
      '@type': 'BlogPosting',
      headline: `Hello ${HOSTILE}`,
      author: { '@type': 'Person', name: 'Ada </script> Lovelace' },
    });
    // The raw JSON-LD text never contains a closing tag sequence.
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(block).not.toContain('<');
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain(
      '<meta property="og:image" content="https://example.test/uploads/2026/11/photo-1536.webp">',
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<meta name="description" content="Summary text">');
    expect(html).toContain(
      'srcSet="/uploads/2026/11/photo-320.webp 320w, /uploads/2026/11/photo-1536.webp 1536w, /uploads/2026/11/photo.jpg 2000w"',
    );
    expect(html).toContain('<dt>Price</dt><dd>12</dd>');
    expect(html).toContain('href="/category/news"');
    expect(html).toContain('<a href="/blog">Blog</a>');
  });

  it('marks the current menu item and renders right-to-left sites in their language', async () => {
    api.site = site({ language: 'fa', direction: 'rtl', tagline: 'یادداشت‌ها' });
    api.routes.set('/blog', {
      kind: 'archive',
      canonicalUrl: 'https://example.test/blog',
      archive: {
        type: 'content_type',
        contentType: { key: 'post', name: 'Post', pluralName: 'نوشته‌ها', hierarchical: false },
      },
      listing: listing([entry({ title: 'سلام' })], 1, 3),
    });
    const html = (await request(app).get('/blog').expect(200)).text;
    expect(html).toContain('<html lang="fa" dir="rtl"');
    expect(html).toContain('<a href="/blog" aria-current="page">Blog</a>');
    expect(html).toContain('رفتن به محتوا');
    expect(html).toContain('<h1>نوشته‌ها</h1>');
    expect(html).toContain('href="/blog?page=2" rel="next"');
    expect(html).toContain('<meta property="og:locale" content="fa">');
    expect(html).toContain('<link rel="canonical" href="https://example.test/blog">');
  });

  it('follows redirects, answers 404 for unknown and malformed paths, and validates the page parameter', async () => {
    api.routes.set('/old', {
      kind: 'redirect',
      location: '/%D8%AA%D8%A7%D8%B2%D9%87',
      statusCode: 301,
    });
    const redirect = await request(app).get('/old').expect(301);
    expect(redirect.headers.location).toBe('/%D8%AA%D8%A7%D8%B2%D9%87');

    const missing = await request(app).get('/nothing-here').expect(404);
    expect(missing.text).toContain('<meta name="robots" content="noindex">');
    expect(missing.headers['x-robots-tag']).toBe('noindex');
    expect(missing.text).toContain('Page not found');
    expect(missing.text).not.toContain('rel="canonical"');

    await request(app).get('/%E0%A4%A').expect(400);
    for (const path of [
      '/admin/x',
      '/api/v1/anything',
      '/uploads/x.jpg',
      '/blog?page=abc',
      '/blog?page=0',
    ]) {
      await request(app).get(path).expect(404);
    }
    expect(api.calls.filter((call) => call.startsWith('page'))).toEqual([
      'page /old 1',
      'page /nothing-here 1',
    ]);

    // Non-Latin paths are decoded before they are looked up.
    api.routes.set('/درباره', { kind: 'entry', entry: entry({ title: 'درباره', url: '/درباره' }) });
    await request(app)
      .get(`/${encodeURIComponent('درباره')}`)
      .expect(200);
  });

  it('serves previews privately and refuses invalid preview links', async () => {
    const token = 'A'.repeat(43);
    api.previews.set(token, {
      site: api.site,
      route: {
        kind: 'entry',
        entry: entry({ title: 'Draft', seo: { title: '', description: '', noindex: true } }),
      },
      preview: true,
    });
    const response = await request(app).get(`/_preview/${token}`).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.text).toContain('Preview: this is how the latest saved version looks.');
    expect(response.text).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(response.text).not.toContain('rel="canonical"');
    expect(response.headers.etag).toBeDefined();

    const invalid = await request(app).get('/_preview/short').expect(404);
    expect(invalid.headers['cache-control']).toBe('no-store');
    expect(api.calls).toEqual([`preview ${token}`]);
    await request(app)
      .get(`/_preview/${'B'.repeat(43)}`)
      .expect(404);
  });

  it('answers 503 with a retry hint when the Delivery API is unavailable', async () => {
    api.down = true;
    const response = await request(app).get('/').expect(503);
    expect(response.headers['retry-after']).toBe('30');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).toContain('temporarily unavailable');
    await request(app).get('/robots.txt').expect(503);
  });

  it('tells visitors of a fresh installation where to finish the setup', async () => {
    api.notInstalled = true;
    const response = await request(app).get('/').expect(503);
    expect(response.text).toContain('This site is not set up yet');
    expect(response.text).toContain('Open /admin/ to finish the installation');
  });

  it('honours the search engine visibility switch and per-entry noindex', async () => {
    api.routes.set('/hidden', {
      kind: 'entry',
      entry: entry({ seo: { title: 'Custom', description: 'D', noindex: true } }),
    });
    const hidden = await request(app).get('/hidden').expect(200);
    expect(hidden.text).toContain('<meta name="robots" content="noindex">');
    expect(hidden.text).toContain('<title>Custom – Example Site</title>');
    expect(hidden.headers['x-robots-tag']).toBe('noindex');

    api.site = site({ seo: { ...site().seo, indexing: false } });
    api.routes.set('/blog/hello', { kind: 'entry', entry: entry() });
    expect((await request(app).get('/blog/hello').expect(200)).headers['x-robots-tag']).toBe(
      'noindex',
    );
    expect((await request(app).get('/robots.txt').expect(200)).text).toBe(
      'User-agent: *\nDisallow: /\n',
    );
    api.sitemap = { ...api.sitemap, indexing: false };
    await request(app).get('/sitemap.xml').expect(404);
  });

  it('builds robots.txt, sitemap.xml and the RSS feed with escaping', async () => {
    const robots = await request(app).get('/robots.txt').expect(200);
    expect(robots.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(robots.text).toContain('Sitemap: https://example.test/sitemap.xml');
    expect(robots.text).toContain('Disallow: /_preview/');

    api.sitemap = {
      baseUrl: 'https://example.test',
      indexing: true,
      truncated: false,
      urls: [
        { path: '/', lastModified: '2026-10-02T10:00:00.000Z' },
        { path: '/blog/a&b', lastModified: null },
        { path: '/درباره', lastModified: null },
      ],
    };
    const sitemap = await request(app).get('/sitemap.xml').expect(200);
    expect(sitemap.headers['content-type']).toBe('application/xml; charset=utf-8');
    expect(sitemap.text).toContain(
      '<url><loc>https://example.test/</loc><lastmod>2026-10-02T10:00:00.000Z</lastmod></url>',
    );
    expect(sitemap.text).toContain('<loc>https://example.test/blog/a%26b</loc>');
    expect(sitemap.text).toContain(
      `<loc>https://example.test/${encodeURIComponent('درباره')}</loc>`,
    );

    api.feed = {
      site: { name: 'Site & Co', tagline: '', baseUrl: 'https://example.test', language: 'en' },
      items: [{ ...entry(), summary: `Summary ${HOSTILE}\u0007` }],
    };
    const feed = await request(app).get('/feed.xml').expect(200);
    expect(feed.headers['content-type']).toBe('application/rss+xml; charset=utf-8');
    expect(feed.text).toContain('<title>Site &amp; Co</title>');
    expect(feed.text).toContain(
      '<title>Hello &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</title>',
    );
    expect(feed.text).toContain('<link>https://example.test/blog/hello</link>');
    expect(feed.text).toContain('<pubDate>Thu, 01 Oct 2026 10:00:00 GMT</pubDate>');
    expect(feed.text).not.toContain('\u0007');
    expect(feed.text).not.toContain(HOSTILE);
  });

  it('serves theme assets with immutable caching and rejects tampered variable stylesheets', async () => {
    api.routes.set('/', {
      kind: 'home',
      canonicalUrl: 'https://example.test/',
      entry: null,
      listing: listing([]),
    });
    const html = (await request(app).get('/').expect(200)).text;
    const hrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(
      (match) => match[1] ?? '',
    );
    expect(hrefs).toHaveLength(2);
    const [themeCss, varsCss] = hrefs as [string, string];
    expect(themeCss).toMatch(/^\/_assets\/starter\.[A-Za-z0-9_-]{16}\.css$/);
    const css = await request(app).get(themeCss).expect(200);
    expect(css.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(css.text).toContain('.nx-site-header');

    const vars = await request(app).get(varsCss).expect(200);
    expect(vars.text).toContain('--nx-accent:#b91c1c');
    expect(vars.text).toContain('--nx-content-width:46rem');

    const tampered = Buffer.from(
      ':root{--nx-accent:red;}body{background:url(https://evil.example)}\n',
    ).toString('base64url');
    await request(app).get(`/_assets/vars/${tampered}.css`).expect(404);
    const injected = Buffer.from(':root{--x:url(https://evil.example)}\n').toString('base64url');
    await request(app).get(`/_assets/vars/${injected}.css`).expect(404);
    await request(app).get('/_assets/unknown.css').expect(404);
    await request(app).get('/_health').expect(200, { status: 'ok' });
  });

  it('renders the static home page entry and the theme logo', async () => {
    api.site = site({
      theme: {
        ...site().theme,
        settings: { ...site().theme.settings, logo: media().id },
        media: { logo: media({ altText: '' }) },
      },
    });
    api.routes.set('/', {
      kind: 'home',
      canonicalUrl: 'https://example.test/',
      listing: null,
      entry: entry({
        title: 'Welcome',
        url: '/',
        contentType: { key: 'page', name: 'Page', pluralName: 'Pages', hierarchical: true },
      }),
    });
    const html = (await request(app).get('/').expect(200)).text;
    expect(html).toContain('<h1 class="nx-entry-title">Welcome</h1>');
    expect(html).toContain('alt="Example Site"');
    expect(html).toContain('<meta property="og:type" content="website">');
    expect(jsonLd(html)).toEqual([
      expect.objectContaining({ '@type': 'WebPage', name: 'Welcome' }),
    ]);
  });
});
