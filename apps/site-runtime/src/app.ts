import type { DeliveryPage, DeliveryRoute } from '@nexora/shared';
import { encodeSitePath, PREVIEW_TOKEN_PATTERN } from '@nexora/shared';
import type { ThemeRenderContext, ThemeView } from '@nexora/theme-sdk';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeliveryUnavailableError, type DeliveryClient } from './delivery-client.js';
import { escapeHtml, renderDocument } from './html.js';
import { buildSeo } from './seo.js';
import type { ThemeSet } from './themes.js';
import { robotsTxt, rssXml, sitemapXml } from './xml.js';

export interface SiteAppOptions {
  readonly client: DeliveryClient;
  readonly themes: ThemeSet;
  readonly logger: Logger;
}

const MAX_PATH_LENGTH = 2_000;
/** First segments the application owns; they never reach the site in a proxied deployment. */
const RESERVED = new Set(['admin', 'api', 'uploads']);
const REVALIDATE = 'public, max-age=0, must-revalidate';
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Content Security Policy for public pages: no scripts can run (structured data uses non-executable
 * JSON-LD blocks), styles only from this origin (theme variables are a stylesheet, not inline), images
 * from this origin, data URIs or https (media may be on a CDN), and the page cannot be framed elsewhere.
 */
const CSP = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'none'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    fontSrc: ["'self'"],
    baseUri: ["'none'"],
    formAction: ["'self'"],
    frameAncestors: ["'self'"],
    manifestSrc: ["'self'"],
  },
};

/** Decodes a raw request path segment by segment; null when it is malformed. */
export function decodePath(raw: string): string | null {
  try {
    return raw
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  } catch {
    return null;
  }
}

/** `?page=N` for listings: 1 when absent, null when present but invalid. */
function pageParameter(value: unknown): number | null {
  if (value === undefined) return 1;
  if (typeof value !== 'string' || !/^[1-9]\d{0,4}$/.test(value)) return null;
  return Number(value);
}

function toView(route: Exclude<DeliveryRoute, { kind: 'redirect' }>): ThemeView {
  switch (route.kind) {
    case 'home':
      return { kind: 'home', listing: route.listing, entry: route.entry };
    case 'entry':
      return { kind: 'entry', entry: route.entry };
    case 'archive':
      return { kind: 'archive', archive: route.archive, listing: route.listing };
    case 'not_found':
      return { kind: 'not_found' };
  }
}

function canonicalOf(route: Exclude<DeliveryRoute, { kind: 'redirect' }>): string | null {
  switch (route.kind) {
    case 'home':
      return route.entry ? route.entry.canonicalUrl : route.canonicalUrl;
    case 'entry':
      return route.entry.canonicalUrl;
    case 'archive':
      return route.canonicalUrl;
    case 'not_found':
      return null;
  }
}

/** Minimal built-in page for errors where no theme can render (API unreachable, invalid preview). */
function plainPage(title: string, message: string): string {
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n<title>${escapeHtml(title)}</title>\n</head>\n<body>\n<main>\n<h1>${escapeHtml(title)}</h1>\n<p>${escapeHtml(message)}</p>\n</main>\n</body>\n</html>\n`;
}

export function createSiteApp({ client, themes, logger }: SiteAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', 'strong');
  app.set('trust proxy', false);
  app.use(
    helmet({
      contentSecurityPolicy: CSP,
      // HSTS belongs to the TLS-terminating proxy, which knows whether the site is served over HTTPS.
      strictTransportSecurity: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const path = req.path.startsWith('/_preview/') ? '/_preview/[redacted]' : req.path;
      logger.info(
        {
          method: req.method,
          path,
          status: res.statusCode,
          ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
        },
        'request',
      );
    });
    next();
  });

  app.get('/_health', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok' });
  });

  app.get('/_assets/vars/:file', (req, res) => {
    const match = /^([A-Za-z0-9_-]+)\.css$/.exec(req.params.file);
    const asset = match?.[1] ? themes.variablesAsset(match[1]) : undefined;
    if (!asset) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.set('Cache-Control', IMMUTABLE).type(asset.contentType).send(asset.body);
  });

  app.get('/_assets/:file', (req, res) => {
    const asset = themes.asset(req.params.file);
    if (!asset) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.set('Cache-Control', IMMUTABLE).type(asset.contentType).send(asset.body);
  });

  app.get('/robots.txt', async (_req, res) => {
    const site = await client.site();
    res.set('Cache-Control', REVALIDATE).type('text/plain').send(robotsTxt(site));
  });

  app.get('/sitemap.xml', async (_req, res) => {
    const sitemap = await client.sitemap();
    if (!sitemap.indexing) {
      res.status(404).set('Cache-Control', REVALIDATE).type('text/plain').send('Not found');
      return;
    }
    res.set('Cache-Control', REVALIDATE).type('application/xml').send(sitemapXml(sitemap));
  });

  app.get('/feed.xml', async (_req, res) => {
    const feed = await client.feed();
    res.set('Cache-Control', REVALIDATE).type('application/rss+xml').send(rssXml(feed));
  });

  app.get('/favicon.ico', (_req, res) => {
    res
      .status(404)
      .set('Cache-Control', 'public, max-age=3600')
      .type('text/plain')
      .send('Not found');
  });

  app.get('/_preview/:token', async (req, res) => {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    const token = req.params.token;
    const page = PREVIEW_TOKEN_PATTERN.test(token) ? await client.preview(token) : null;
    if (!page) {
      res
        .status(404)
        .type('html')
        .send(plainPage('Preview unavailable', 'This preview link is invalid or has expired.'));
      return;
    }
    const path = page.route.kind === 'entry' ? page.route.entry.url : '/';
    sendPage(res, page, path, 200);
  });

  app.get('/{*path}', async (req, res) => {
    const decoded = decodePath(req.path);
    const page = pageParameter(req.query.page);
    const first = decoded?.split('/')[1] ?? '';
    if (
      decoded === null ||
      page === null ||
      decoded.length > MAX_PATH_LENGTH ||
      RESERVED.has(first)
    ) {
      const site = await client.site();
      sendPage(res, { site, route: { kind: 'not_found' }, preview: false }, decoded ?? '/', 404);
      return;
    }
    const result = await client.page(decoded, page);
    if (result.route.kind === 'redirect') {
      res.set('Cache-Control', REVALIDATE).redirect(result.route.statusCode, result.route.location);
      return;
    }
    sendPage(res, result, decoded, result.route.kind === 'not_found' ? 404 : 200);
  });

  function sendPage(res: Response, page: DeliveryPage, path: string, status: number): void {
    const route = page.route;
    if (route.kind === 'redirect') throw new Error('Redirects are not rendered.');
    const theme = themes.resolve(page.site.theme.key);
    const settings = themes.settingsFor(theme, page.site.theme.settings);
    const site = { ...page.site, theme: { ...page.site.theme, settings } };
    const view = toView(route);
    const context: ThemeRenderContext = {
      site,
      view,
      path,
      preview: page.preview,
      pageUrl: (target) => `${encodeSitePath(path)}${target > 1 ? `?page=${String(target)}` : ''}`,
    };
    const seo = buildSeo({ site, view, preview: page.preview, canonical: canonicalOf(route) });
    const html = renderDocument({
      language: site.language,
      direction: site.direction,
      htmlAttributes: theme.module.htmlAttributes(settings),
      title: seo.title,
      head: seo.tags,
      stylesheets: [theme.stylesheetHref, themes.variablesHref(theme, settings)],
      body: renderToStaticMarkup(theme.module.render(context)),
    });
    if (seo.noindex && !page.preview) res.set('X-Robots-Tag', 'noindex');
    if (!page.preview) res.set('Cache-Control', REVALIDATE);
    res.status(status).type('html').send(html);
  }

  // Errors: the Delivery API being down is a 503 with a retry hint; anything else is a 500.
  // Express recognises error handlers by their four parameters, so `_next` must stay.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    res.set('Cache-Control', 'no-store');
    if (error instanceof DeliveryUnavailableError) {
      logger.warn({ err: error, path: req.path }, 'Delivery API unavailable');
      res
        .status(503)
        .set('Retry-After', '30')
        .type('html')
        .send(
          plainPage(
            'Temporarily unavailable',
            'The site is temporarily unavailable. Please try again shortly.',
          ),
        );
      return;
    }
    const status = (error as { status?: unknown } | null)?.status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      // Client errors raised by Express itself, such as a malformed percent-encoded path.
      res
        .status(status)
        .type('html')
        .send(plainPage('Bad request', 'The address of this page is not valid.'));
      return;
    }
    logger.error({ err: error, path: req.path }, 'Rendering failed');
    res
      .status(500)
      .type('html')
      .send(
        plainPage(
          'Something went wrong',
          'The page could not be displayed. Please try again later.',
        ),
      );
  });

  return app;
}
