import { fileURLToPath } from 'node:url';
import {
  richTextToPlainText,
  type DeliveryEntry,
  type DeliveryEntryCard,
  type DeliveryListing,
  type DeliveryMenuItem,
  type DeliverySite,
  type ThemeSettingValues,
} from '@nexora/shared';
import {
  defineTheme,
  formatDate,
  isCurrentLink,
  linkAttributes,
  readingMinutes,
  ResponsiveImage,
  RichText,
  type ThemeRenderContext,
} from '@nexora/theme-sdk';
import type { ReactNode } from 'react';
import { manifest } from './manifest.js';
import { stringsFor, type ThemeStrings } from './strings.js';

const FONT_STACKS: Record<string, string> = {
  system:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Arabic", Tahoma, sans-serif',
  serif: '"Iowan Old Style", Georgia, "Noto Serif", "Noto Naskh Arabic", "Times New Roman", serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif',
};
const CONTENT_WIDTHS: Record<string, string> = { narrow: '40rem', normal: '46rem', wide: '62rem' };
const IMAGE_SIZES = '(min-width: 64rem) 62rem, 100vw';

function setting(settings: ThemeSettingValues, key: string, fallback: string): string {
  const value = settings[key];
  return typeof value === 'string' ? value : fallback;
}

// ---------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------

function MenuList({
  items,
  path,
  depth = 0,
}: {
  items: readonly DeliveryMenuItem[];
  path: string;
  depth?: number;
}) {
  return (
    <ul className={depth === 0 ? 'nx-menu' : 'nx-submenu'}>
      {items.map((item, index) => {
        const attributes = linkAttributes(item.url, item.openInNewTab);
        const current = isCurrentLink(item.url, path);
        return (
          <li
            key={`${String(index)}-${item.url}`}
            className={item.children.length > 0 ? 'nx-has-children' : undefined}
          >
            {attributes ? (
              <a {...attributes} aria-current={current ? 'page' : undefined}>
                {item.label}
              </a>
            ) : (
              <span>{item.label}</span>
            )}
            {item.children.length > 0 ? (
              <MenuList items={item.children} path={path} depth={depth + 1} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function EntryMeta({
  entry,
  site,
  t,
}: {
  entry: DeliveryEntryCard;
  site: DeliverySite;
  t: ThemeStrings;
}) {
  return (
    <p className="nx-meta">
      <time dateTime={entry.publishedAt}>{formatDate(entry.publishedAt, site.language)}</time>
      <span aria-hidden="true"> · </span>
      <span>
        {t.by} {entry.author.displayName}
      </span>
    </p>
  );
}

function Terms({ entry }: { entry: DeliveryEntryCard }) {
  if (entry.terms.length === 0) return null;
  return (
    <ul className="nx-terms">
      {entry.terms.map((term) => (
        <li key={`${term.taxonomy}:${term.slug}`}>
          {term.url ? <a href={term.url}>{term.name}</a> : <span>{term.name}</span>}
        </li>
      ))}
    </ul>
  );
}

function Card({
  entry,
  site,
  t,
}: {
  entry: DeliveryEntryCard;
  site: DeliverySite;
  t: ThemeStrings;
}) {
  return (
    <article className="nx-card">
      {entry.featuredMedia ? (
        <a href={entry.url} className="nx-card-image" tabIndex={-1} aria-hidden="true">
          <ResponsiveImage
            media={entry.featuredMedia}
            alt=""
            sizes="(min-width: 48rem) 16rem, 100vw"
          />
        </a>
      ) : null}
      <div className="nx-card-body">
        <h2 className="nx-card-title">
          <a href={entry.url}>{entry.title}</a>
        </h2>
        <EntryMeta entry={entry} site={site} t={t} />
        {entry.summary !== '' ? <p className="nx-summary">{entry.summary}</p> : null}
        <Terms entry={entry} />
      </div>
    </article>
  );
}

function Pagination({
  listing,
  context,
  t,
}: {
  listing: DeliveryListing;
  context: ThemeRenderContext;
  t: ThemeStrings;
}) {
  if (listing.totalPages <= 1) return null;
  return (
    <nav className="nx-pagination" aria-label={t.pagination}>
      {listing.page > 1 ? (
        <a href={context.pageUrl(listing.page - 1)} rel="prev">
          {t.previous}
        </a>
      ) : (
        <span />
      )}
      <span className="nx-page-count">{t.pageOf(listing.page, listing.totalPages)}</span>
      {listing.page < listing.totalPages ? (
        <a href={context.pageUrl(listing.page + 1)} rel="next">
          {t.next}
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}

function Listing({
  listing,
  context,
  t,
}: {
  listing: DeliveryListing;
  context: ThemeRenderContext;
  t: ThemeStrings;
}) {
  return (
    <>
      {listing.items.length === 0 ? (
        <p className="nx-empty">{t.noEntries}</p>
      ) : (
        <div className="nx-cards">
          {listing.items.map((entry) => (
            <Card key={entry.id} entry={entry} site={context.site} t={t} />
          ))}
        </div>
      )}
      <Pagination listing={listing} context={context} t={t} />
    </>
  );
}

function Fields({ entry, t }: { entry: DeliveryEntry; t: ThemeStrings }) {
  if (entry.fields.length === 0) return null;
  return (
    <section className="nx-fields" aria-label={t.details}>
      <dl>
        {entry.fields.map((field) => {
          let value: ReactNode = field.display;
          if (field.type === 'url' && typeof field.value === 'string') {
            const attributes = linkAttributes(field.value);
            value = attributes ? <a {...attributes}>{field.display}</a> : field.display;
          } else if (field.type === 'email' && typeof field.value === 'string') {
            value = <a href={`mailto:${field.value}`}>{field.display}</a>;
          } else if (field.type === 'media' && typeof field.value === 'string') {
            const media = entry.media[field.value];
            value = media ? (
              <ResponsiveImage media={media} sizes="(min-width: 48rem) 24rem, 100vw" />
            ) : null;
          } else if (field.type === 'boolean') {
            value = field.value === true ? '✓' : '✗';
          }
          return value === null ? null : (
            <div key={field.key} className="nx-field">
              <dt>{field.label}</dt>
              <dd>{value}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/** A single entry: articles (dated types) show their meta, pages (hierarchical types) do not. */
function EntryView({
  entry,
  site,
  t,
}: {
  entry: DeliveryEntry;
  site: DeliverySite;
  t: ThemeStrings;
}) {
  const dated = !entry.contentType.hierarchical;
  const minutes = readingMinutes(richTextToPlainText(entry.body));
  return (
    <article className={`nx-entry nx-entry-${entry.contentType.key}`}>
      <header className="nx-entry-header">
        <h1 className="nx-entry-title">{entry.title}</h1>
        {dated ? (
          <p className="nx-meta">
            <time dateTime={entry.publishedAt}>{formatDate(entry.publishedAt, site.language)}</time>
            <span aria-hidden="true"> · </span>
            <span>
              {t.by} {entry.author.displayName}
            </span>
            <span aria-hidden="true"> · </span>
            <span>{t.minutesRead(minutes)}</span>
          </p>
        ) : null}
      </header>
      {entry.featuredMedia ? (
        <figure className="nx-featured">
          <ResponsiveImage media={entry.featuredMedia} sizes={IMAGE_SIZES} priority />
          {entry.featuredMedia.caption !== '' ? (
            <figcaption>{entry.featuredMedia.caption}</figcaption>
          ) : null}
        </figure>
      ) : null}
      <RichText
        document={entry.body}
        media={entry.media}
        imageSizes={IMAGE_SIZES}
        className="nx-prose"
      />
      <Fields entry={entry} t={t} />
      {dated ? <Terms entry={entry} /> : null}
    </article>
  );
}

function NotFound({ t }: { t: ThemeStrings }) {
  return (
    <section className="nx-not-found">
      <h1>{t.notFoundTitle}</h1>
      <p>{t.notFoundText}</p>
      <p>
        <a href="/" className="nx-button">
          {t.backHome}
        </a>
      </p>
    </section>
  );
}

function Header({ context, t }: { context: ThemeRenderContext; t: ThemeStrings }) {
  const { site } = context;
  const logo = site.theme.media.logo;
  const showTagline = site.theme.settings.showTagline !== false && site.tagline !== '';
  const primary = site.menus.primary ?? [];
  return (
    <header className="nx-site-header">
      <div className="nx-container nx-header-inner">
        <div className="nx-brand">
          <a
            href="/"
            className="nx-site-title"
            rel="home"
            aria-current={context.path === '/' ? 'page' : undefined}
          >
            {logo ? (
              <ResponsiveImage
                media={logo}
                alt={site.name}
                sizes="12rem"
                className="nx-logo"
                priority
              />
            ) : (
              site.name
            )}
          </a>
          {showTagline ? <p className="nx-tagline">{site.tagline}</p> : null}
        </div>
        {primary.length > 0 ? (
          <nav className="nx-primary-nav" aria-label={t.mainNavigation}>
            <MenuList items={primary} path={context.path} />
          </nav>
        ) : null}
      </div>
    </header>
  );
}

function Footer({ context, t }: { context: ThemeRenderContext; t: ThemeStrings }) {
  const { site } = context;
  const footer = site.menus.footer ?? [];
  const text = setting(site.theme.settings, 'footerText', '');
  return (
    <footer className="nx-site-footer">
      <div className="nx-container">
        {footer.length > 0 ? (
          <nav aria-label={t.footerNavigation}>
            <MenuList items={footer} path={context.path} />
          </nav>
        ) : null}
        <p className="nx-footer-text">{text !== '' ? text : site.name}</p>
        <p className="nx-powered">{t.poweredBy}</p>
      </div>
    </footer>
  );
}

function Main({ context, t }: { context: ThemeRenderContext; t: ThemeStrings }) {
  const { view, site } = context;
  switch (view.kind) {
    case 'home':
      if (view.entry) return <EntryView entry={view.entry} site={site} t={t} />;
      return (
        <>
          <h1 className="nx-visually-hidden">{site.name}</h1>
          <h2 className="nx-section-title">{t.latestPosts}</h2>
          {view.listing ? <Listing listing={view.listing} context={context} t={t} /> : null}
        </>
      );
    case 'entry':
      return <EntryView entry={view.entry} site={site} t={t} />;
    case 'archive': {
      const heading =
        view.archive.type === 'term' ? view.archive.term.name : view.archive.contentType.pluralName;
      const description = view.archive.type === 'term' ? view.archive.term.description : '';
      return (
        <>
          <header className="nx-archive-header">
            {view.archive.type === 'term' ? (
              <p className="nx-eyebrow">{view.archive.taxonomy.name}</p>
            ) : null}
            <h1>{heading}</h1>
            {description !== '' ? <p className="nx-archive-description">{description}</p> : null}
          </header>
          <Listing listing={view.listing} context={context} t={t} />
        </>
      );
    }
    case 'not_found':
      return <NotFound t={t} />;
  }
}

function Page(context: ThemeRenderContext) {
  const t = stringsFor(context.site.language);
  return (
    <>
      <a className="nx-skip-link" href="#content">
        {t.skipToContent}
      </a>
      {context.preview ? (
        <div className="nx-preview-banner" role="status">
          {t.preview}
        </div>
      ) : null}
      <Header context={context} t={t} />
      <main id="content" className="nx-container nx-main" tabIndex={-1}>
        <Main context={context} t={t} />
      </main>
      <Footer context={context} t={t} />
    </>
  );
}

export const theme = defineTheme({
  manifest,
  stylesheet: fileURLToPath(new URL('../assets/theme.css', import.meta.url)),
  cssVariables(settings) {
    return {
      '--nx-accent': setting(settings, 'accentColor', '#1d4ed8'),
      '--nx-font':
        FONT_STACKS[setting(settings, 'fontFamily', 'system')] ??
        FONT_STACKS.system ??
        'sans-serif',
      '--nx-content-width': CONTENT_WIDTHS[setting(settings, 'contentWidth', 'normal')] ?? '46rem',
    };
  },
  htmlAttributes(settings) {
    return { 'data-scheme': setting(settings, 'colorScheme', 'auto') };
  },
  render(context) {
    return <Page {...context} />;
  },
});

export default theme;
