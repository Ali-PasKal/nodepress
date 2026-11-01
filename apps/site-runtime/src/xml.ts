import {
  encodeSitePath,
  type DeliveryFeed,
  type DeliverySite,
  type DeliverySitemap,
} from '@nexora/shared';

// Characters XML 1.0 does not allow at all, even escaped.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;

export function escapeXml(value: string): string {
  return value.replace(INVALID_XML, '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

function absolute(baseUrl: string, path: string): string {
  return /^https?:\/\//i.test(path) ? path : `${baseUrl}${encodeSitePath(path)}`;
}

export function robotsTxt(site: Pick<DeliverySite, 'baseUrl' | 'seo'>): string {
  if (!site.seo.indexing) {
    return 'User-agent: *\nDisallow: /\n';
  }
  return [
    'User-agent: *',
    'Disallow: /_preview/',
    'Disallow: /api/',
    '',
    `Sitemap: ${site.baseUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml(sitemap: DeliverySitemap): string {
  const urls = sitemap.urls.map((url) => {
    const lastmod = url.lastModified ? `<lastmod>${escapeXml(url.lastModified)}</lastmod>` : '';
    return `<url><loc>${escapeXml(absolute(sitemap.baseUrl, url.path))}</loc>${lastmod}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function rssXml(feed: DeliveryFeed): string {
  const { site } = feed;
  const home = `${site.baseUrl}/`;
  const items = feed.items.map((item) => {
    const link = absolute(site.baseUrl, item.url);
    return [
      '<item>',
      `<title>${escapeXml(item.title)}</title>`,
      `<link>${escapeXml(link)}</link>`,
      `<guid isPermaLink="true">${escapeXml(link)}</guid>`,
      `<pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>`,
      `<dc:creator>${escapeXml(item.author.displayName)}</dc:creator>`,
      ...item.terms.map((term) => `<category>${escapeXml(term.name)}</category>`),
      item.summary !== '' ? `<description>${escapeXml(item.summary)}</description>` : '',
      '</item>',
    ]
      .filter(Boolean)
      .join('');
  });
  const updated = feed.items[0]?.publishedAt ?? null;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '<channel>',
    `<title>${escapeXml(site.name)}</title>`,
    `<link>${escapeXml(home)}</link>`,
    `<description>${escapeXml(site.tagline || site.name)}</description>`,
    `<language>${escapeXml(site.language)}</language>`,
    `<atom:link href="${escapeXml(`${site.baseUrl}/feed.xml`)}" rel="self" type="application/rss+xml"/>`,
    updated ? `<lastBuildDate>${new Date(updated).toUTCString()}</lastBuildDate>` : '',
    ...items,
    '</channel>',
    '</rss>',
    '',
  ]
    .filter((line, index, all) => line !== '' || index === all.length - 1)
    .join('\n');
}
