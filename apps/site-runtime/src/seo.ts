import type { DeliveryEntry, DeliveryMedia, DeliverySite } from '@nexora/shared';
import { formatTitle, type ThemeView } from '@nexora/theme-sdk';
import type { HeadTag } from './html.js';

export interface SeoInput {
  readonly site: DeliverySite;
  readonly view: ThemeView;
  readonly preview: boolean;
  /** Absolute canonical URL from the Delivery API (null for "not found"). */
  readonly canonical: string | null;
}

export interface SeoOutput {
  readonly title: string;
  readonly tags: HeadTag[];
  /** Whether search engines are asked not to index the page (also sent as X-Robots-Tag). */
  readonly noindex: boolean;
}

/** Absolute URL for a site path or an already absolute URL (media may live on a CDN). */
export function absoluteUrl(site: DeliverySite, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${site.baseUrl}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

/** The best social image: a variant around 1200 px wide, else the original. */
function socialImage(site: DeliverySite, media: DeliveryMedia | null): HeadTag[] {
  if (!media?.mimeType.startsWith('image/')) return [];
  const variant =
    media.sources.find((source) => source.width >= 1200) ?? media.sources.at(-1) ?? null;
  const url = absoluteUrl(site, variant?.url ?? media.url);
  const width = variant?.width ?? media.width;
  const height = variant?.height ?? media.height;
  return [
    { tag: 'meta', property: 'og:image', content: url },
    ...(width !== null
      ? [{ tag: 'meta' as const, property: 'og:image:width', content: String(width) }]
      : []),
    ...(height !== null
      ? [{ tag: 'meta' as const, property: 'og:image:height', content: String(height) }]
      : []),
    ...(media.altText !== ''
      ? [{ tag: 'meta' as const, property: 'og:image:alt', content: media.altText }]
      : []),
  ];
}

function ogLocale(language: string): string {
  const [lang = 'en', ...rest] = language.split('-');
  const region = rest.find((part) => /^[A-Z]{2}$/.test(part));
  return region ? `${lang}_${region}` : lang;
}

function describe(entry: DeliveryEntry, site: DeliverySite): string {
  return entry.seo.description || entry.excerpt || entry.summary || site.seo.defaultDescription;
}

/** Titles, description, canonical URL, robots, Open Graph, Twitter and JSON-LD for a page. */
export function buildSeo({ site, view, preview, canonical }: SeoInput): SeoOutput {
  let title: string;
  let description = site.seo.defaultDescription;
  let entry: DeliveryEntry | null = null;
  const template = site.seo.titleTemplate;
  const siteTitle = site.tagline ? `${site.name} – ${site.tagline}` : site.name;

  switch (view.kind) {
    case 'home':
      entry = view.entry;
      if (entry) {
        title = entry.seo.title || siteTitle;
        description = describe(entry, site);
      } else {
        const page = view.listing?.page ?? 1;
        title = page > 1 ? formatTitle(template, `(${String(page)})`, site.name) : siteTitle;
        description = site.tagline || site.seo.defaultDescription;
      }
      break;
    case 'entry':
      entry = view.entry;
      title = formatTitle(template, entry.seo.title || entry.title, site.name);
      description = describe(entry, site);
      break;
    case 'archive': {
      const name =
        view.archive.type === 'term' ? view.archive.term.name : view.archive.contentType.pluralName;
      const pageNumber = view.listing.page;
      title = formatTitle(
        template,
        pageNumber > 1 ? `${name} (${String(pageNumber)})` : name,
        site.name,
      );
      if (view.archive.type === 'term' && view.archive.term.description !== '') {
        description = view.archive.term.description;
      }
      break;
    }
    case 'not_found':
      title = formatTitle(template, '404', site.name);
      break;
  }

  const noindex =
    preview || view.kind === 'not_found' || !site.seo.indexing || entry?.seo.noindex === true;
  const tags: HeadTag[] = [];
  if (description !== '') tags.push({ tag: 'meta', name: 'description', content: description });
  if (noindex)
    tags.push({ tag: 'meta', name: 'robots', content: preview ? 'noindex, nofollow' : 'noindex' });
  if (canonical && view.kind !== 'not_found' && !preview) {
    tags.push({ tag: 'link', rel: 'canonical', href: canonical });
  }
  tags.push({
    tag: 'link',
    rel: 'alternate',
    type: 'application/rss+xml',
    title: site.name,
    href: '/feed.xml',
  });

  if (view.kind !== 'not_found') {
    const isArticle = entry !== null && !entry.contentType.hierarchical && view.kind === 'entry';
    tags.push(
      { tag: 'meta', property: 'og:site_name', content: site.name },
      {
        tag: 'meta',
        property: 'og:title',
        content: entry ? (entry.seo.title !== '' ? entry.seo.title : entry.title) : title,
      },
      { tag: 'meta', property: 'og:type', content: isArticle ? 'article' : 'website' },
      { tag: 'meta', property: 'og:locale', content: ogLocale(site.language) },
    );
    if (canonical && !preview) tags.push({ tag: 'meta', property: 'og:url', content: canonical });
    if (description !== '')
      tags.push({ tag: 'meta', property: 'og:description', content: description });
    const image = socialImage(site, entry?.featuredMedia ?? site.seo.defaultImage);
    tags.push(...image);
    tags.push({
      tag: 'meta',
      name: 'twitter:card',
      content: image.length > 0 ? 'summary_large_image' : 'summary',
    });
    if (isArticle && entry) {
      tags.push(
        { tag: 'meta', property: 'article:published_time', content: entry.publishedAt },
        { tag: 'meta', property: 'article:modified_time', content: entry.updatedAt },
      );
    }
    tags.push({ tag: 'jsonld', data: structuredData(site, view, entry, canonical, isArticle) });
  }
  return { title, tags, noindex };
}

function structuredData(
  site: DeliverySite,
  view: ThemeView,
  entry: DeliveryEntry | null,
  canonical: string | null,
  isArticle: boolean,
): Record<string, unknown> {
  const home = absoluteUrl(site, '/');
  if (view.kind === 'home' && !entry) {
    return {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: site.name,
      url: home,
      ...(site.tagline ? { description: site.tagline } : {}),
      inLanguage: site.language,
    };
  }
  if (entry) {
    const image = entry.featuredMedia ? absoluteUrl(site, entry.featuredMedia.url) : undefined;
    return {
      '@context': 'https://schema.org',
      '@type': isArticle ? 'BlogPosting' : 'WebPage',
      ...(isArticle ? { headline: entry.title } : { name: entry.title }),
      url: canonical ?? entry.canonicalUrl,
      inLanguage: site.language,
      datePublished: entry.publishedAt,
      dateModified: entry.updatedAt,
      ...(isArticle ? { author: { '@type': 'Person', name: entry.author.displayName } } : {}),
      ...(image ? { image } : {}),
      isPartOf: { '@type': 'WebSite', name: site.name, url: home },
    };
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name:
      view.kind === 'archive'
        ? view.archive.type === 'term'
          ? view.archive.term.name
          : view.archive.contentType.pluralName
        : site.name,
    url: canonical ?? home,
    isPartOf: { '@type': 'WebSite', name: site.name, url: home },
  };
}
