import type {
  DeliveryEntry,
  DeliveryFeed,
  DeliveryMedia,
  DeliveryPage,
  DeliveryRoute,
  DeliverySite,
  DeliverySitemap,
} from '@nexora/shared';
import { pino } from 'pino';
import { createSiteApp } from '../src/app.js';
import { DeliveryUnavailableError, type DeliveryClient } from '../src/delivery-client.js';
import { ThemeSet } from '../src/themes.js';

export const HOSTILE = '<script>alert("x")</script>';

export function media(overrides: Partial<DeliveryMedia> = {}): DeliveryMedia {
  return {
    id: '0191a0b0-0000-7000-8000-000000000001',
    url: '/uploads/2026/11/photo.jpg',
    mimeType: 'image/jpeg',
    width: 2000,
    height: 1000,
    altText: 'A photo',
    caption: '',
    sources: [
      { url: '/uploads/2026/11/photo-320.webp', width: 320, height: 160 },
      { url: '/uploads/2026/11/photo-1536.webp', width: 1536, height: 768 },
    ],
    ...overrides,
  };
}

export function site(overrides: Partial<DeliverySite> = {}): DeliverySite {
  return {
    name: 'Example Site',
    tagline: 'Ideas & notes',
    baseUrl: 'https://example.test',
    language: 'en',
    direction: 'ltr',
    seo: {
      titleTemplate: '%title% – %site%',
      defaultDescription: 'Default description',
      defaultImage: null,
      indexing: true,
    },
    theme: {
      key: 'starter',
      settings: {
        accentColor: '#b91c1c',
        colorScheme: 'auto',
        fontFamily: 'system',
        contentWidth: 'normal',
        logo: null,
        showTagline: true,
        footerText: '',
      },
      media: {},
    },
    menus: {
      primary: [
        { label: 'Home', url: '/', openInNewTab: false, children: [] },
        {
          label: 'Blog',
          url: '/blog',
          openInNewTab: false,
          children: [
            { label: 'Evil', url: 'javascript:alert(1)', openInNewTab: false, children: [] },
          ],
        },
        { label: 'External', url: 'https://other.example', openInNewTab: true, children: [] },
      ],
    },
    ...overrides,
  };
}

export function entry(overrides: Partial<DeliveryEntry> = {}): DeliveryEntry {
  return {
    id: '0191a0b0-0000-7000-8000-0000000000aa',
    type: 'post',
    title: `Hello ${HOSTILE}`,
    url: '/blog/hello',
    summary: 'Summary text',
    publishedAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    author: { displayName: 'Ada </script> Lovelace' },
    featuredMedia: media(),
    terms: [
      {
        taxonomy: 'category',
        taxonomyName: 'Category',
        name: 'News',
        slug: 'news',
        url: '/category/news',
      },
    ],
    contentType: { key: 'post', name: 'Post', pluralName: 'Posts', hierarchical: false },
    slug: 'hello',
    canonicalUrl: 'https://example.test/blog/hello',
    excerpt: '',
    body: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: `Body ${HOSTILE}` }] },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'bad link',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
            {
              type: 'text',
              text: 'good link',
              marks: [{ type: 'link', attrs: { href: 'https://good.example/' } }],
            },
          ],
        },
        { type: 'image', attrs: { src: 'javascript:alert(1)', alt: 'x' } },
      ],
    },
    fields: [{ key: 'price', label: 'Price', type: 'number', value: 12, display: '12' }],
    media: {},
    seo: { title: '', description: '', noindex: false },
    ...overrides,
  };
}

export function listing(items: DeliveryEntry[], page = 1, totalPages = 1) {
  return { items, page, pageSize: 10, total: items.length, totalPages };
}

export interface FakeApi {
  routes: Map<string, DeliveryRoute>;
  site: DeliverySite;
  previews: Map<string, DeliveryPage>;
  sitemap: DeliverySitemap;
  feed: DeliveryFeed;
  down: boolean;
  calls: string[];
}

export function fakeApi(): FakeApi {
  return {
    routes: new Map(),
    site: site(),
    previews: new Map(),
    sitemap: { baseUrl: 'https://example.test', indexing: true, urls: [], truncated: false },
    feed: {
      site: { name: 'Example Site', tagline: '', baseUrl: 'https://example.test', language: 'en' },
      items: [],
    },
    down: false,
    calls: [],
  };
}

export function fakeClient(api: FakeApi): DeliveryClient {
  const guard = (call: string) => {
    api.calls.push(call);
    if (api.down) throw new DeliveryUnavailableError('down');
  };
  return {
    page(path, page) {
      guard(`page ${path} ${String(page)}`);
      return Promise.resolve({
        site: api.site,
        route: api.routes.get(`${path}?${String(page)}`) ??
          api.routes.get(path) ?? { kind: 'not_found' },
        preview: false,
      });
    },
    preview(token) {
      guard(`preview ${token}`);
      return Promise.resolve(api.previews.get(token) ?? null);
    },
    site() {
      guard('site');
      return Promise.resolve(api.site);
    },
    sitemap() {
      guard('sitemap');
      return Promise.resolve(api.sitemap);
    },
    feed() {
      guard('feed');
      return Promise.resolve(api.feed);
    },
  };
}

export async function createTestApp(api: FakeApi) {
  const themes = await ThemeSet.load();
  return createSiteApp({ client: fakeClient(api), themes, logger: pino({ level: 'silent' }) });
}
