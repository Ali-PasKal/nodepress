import { Injectable } from '@nestjs/common';
import {
  encodeSitePath,
  entrySeoSchema,
  fieldDefinitionsSchema,
  PREVIEW_TOKEN_PATTERN,
  publicArchivePath,
  publicEntryPath,
  publicTermPath,
  richTextDocumentSchema,
  richTextMediaIds,
  richTextToPlainText,
  textDirection,
  type DeliveryEntry,
  type DeliveryEntryCard,
  type DeliveryFeed,
  type DeliveryField,
  type DeliveryListing,
  type DeliveryMedia,
  type DeliveryPage,
  type DeliveryRoute,
  type DeliverySite,
  type DeliverySitemap,
  type FieldDefinition,
} from '@nexora/shared';
import { ApiException } from '../../common/errors/api-exception.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { MenusService } from '../appearance/menus.service.js';
import { SiteSettingsService, type SiteState } from '../appearance/site-settings.service.js';
import { MediaUrls, type StoredVariant } from '../media/media-urls.js';
import { sha256 } from '../security/crypto.js';
import { filterVisibleAncestors, publicEntryWhere } from './public-content.js';

const SITEMAP_LIMIT = 50_000;
const FEED_LIMIT = 20;
const SUMMARY_LENGTH = 200;

const mediaSelect = {
  id: true,
  storageKey: true,
  mimeType: true,
  width: true,
  height: true,
  altText: true,
  caption: true,
  variants: true,
} satisfies Prisma.MediaSelect;
type MediaRow = Prisma.MediaGetPayload<{ select: typeof mediaSelect }>;

const cardInclude = {
  author: { select: { displayName: true } },
  featuredMedia: { select: mediaSelect },
  terms: { select: { term: { select: { name: true, slug: true, taxonomyId: true } } } },
} satisfies Prisma.EntryInclude;
type CardRow = Prisma.EntryGetPayload<{ include: typeof cardInclude }>;

interface TypeInfo {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly pluralName: string;
  readonly hierarchical: boolean;
  readonly routePrefix: string;
  readonly isPublic: boolean;
  readonly fields: readonly FieldDefinition[];
}

interface TaxonomyInfo {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly pluralName: string;
  readonly routePrefix: string;
  readonly isPublic: boolean;
}

interface Context {
  readonly now: Date;
  readonly state: SiteState;
  readonly site: DeliverySite;
  readonly types: ReadonlyMap<string, TypeInfo>;
  readonly taxonomies: ReadonlyMap<string, TaxonomyInfo>;
  readonly homepageEntryId: string | null;
}

const NOT_FOUND: DeliveryRoute = { kind: 'not_found' };

/** Start of a text, cut at a word boundary. */
function summarize(text: string, length = SUMMARY_LENGTH): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= length) return flat;
  const cut = flat.slice(0, length);
  const space = cut.lastIndexOf(' ');
  return `${(space > length * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The public, read-only Delivery API. Every query goes through `publicEntryWhere` (and the ancestor
 * check for hierarchical entries), so drafts, pending, scheduled, trashed and non-public content are
 * never returned, except the single entry a valid preview token names.
 */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SiteSettingsService,
    private readonly menus: MenusService,
    private readonly mediaUrls: MediaUrls,
  ) {}

  async site(): Promise<DeliverySite> {
    return (await this.context()).site;
  }

  async page(path: string, page: number): Promise<DeliveryPage> {
    const context = await this.context();
    return { site: context.site, route: await this.resolve(context, path, page), preview: false };
  }

  /** The entry a valid, unexpired preview token names, in its latest saved state (any status). */
  async preview(token: string): Promise<DeliveryPage> {
    const notFound = (): ApiException =>
      new ApiException(404, 'NOT_FOUND', 'This preview link is invalid or has expired.');
    if (!PREVIEW_TOKEN_PATTERN.test(token)) throw notFound();
    const context = await this.context();
    const record = await this.prisma.previewToken.findUnique({
      where: { tokenHash: sha256(token) },
      select: {
        expiresAt: true,
        createdBy: { select: { status: true } },
        entry: { select: { id: true, siteId: true, trashedAt: true } },
      },
    });
    if (
      !record ||
      record.expiresAt <= context.now ||
      record.createdBy.status !== 'active' ||
      record.entry.siteId !== context.state.id ||
      record.entry.trashedAt !== null
    ) {
      throw notFound();
    }
    const row = await this.prisma.entry.findUniqueOrThrow({
      where: { id: record.entry.id },
      include: cardInclude,
    });
    const entry = await this.toEntry(context, row);
    return {
      site: context.site,
      route: { kind: 'entry', entry: { ...entry, seo: { ...entry.seo, noindex: true } } },
      preview: true,
    };
  }

  async sitemap(): Promise<DeliverySitemap> {
    const context = await this.context();
    const { state, now } = context;
    const rows = await this.prisma.entry.findMany({
      where: { siteId: state.id, ...publicEntryWhere(now) },
      select: {
        id: true,
        contentTypeId: true,
        path: true,
        seo: true,
        updatedAt: true,
        terms: { select: { termId: true } },
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      take: SITEMAP_LIMIT + 1,
    });
    const visible = await filterVisibleAncestors(this.prisma, state.id, rows, now);
    const urls: DeliverySitemap['urls'] = [];
    const latest = visible[0]?.updatedAt ?? null;
    urls.push({ path: '/', lastModified: latest?.toISOString() ?? null });
    const archiveDates = new Map<string, Date>();
    const termIds = new Set<string>();
    for (const row of visible) {
      const type = context.types.get(row.contentTypeId);
      if (!type || row.id === context.homepageEntryId) continue;
      if (!entrySeoSchema.safeParse(row.seo).data?.noindex) {
        urls.push({
          path: publicEntryPath(type.routePrefix, row.path),
          lastModified: row.updatedAt.toISOString(),
        });
      }
      if (!type.hierarchical && type.routePrefix !== '') {
        const current = archiveDates.get(type.routePrefix);
        if (!current || current < row.updatedAt) archiveDates.set(type.routePrefix, row.updatedAt);
      }
      for (const term of row.terms) termIds.add(term.termId);
    }
    for (const [prefix, date] of archiveDates) {
      urls.push({ path: publicArchivePath(prefix), lastModified: date.toISOString() });
    }
    const terms = await this.prisma.term.findMany({
      where: { siteId: state.id, id: { in: [...termIds] } },
      select: { slug: true, taxonomyId: true },
    });
    for (const term of terms) {
      const taxonomy = context.taxonomies.get(term.taxonomyId);
      if (taxonomy?.isPublic) {
        urls.push({ path: publicTermPath(taxonomy.routePrefix, term.slug), lastModified: null });
      }
    }
    return {
      baseUrl: state.baseUrl,
      indexing: state.seo.indexing,
      urls: urls.slice(0, SITEMAP_LIMIT),
      truncated: rows.length > SITEMAP_LIMIT || urls.length > SITEMAP_LIMIT,
    };
  }

  async feed(): Promise<DeliveryFeed> {
    const context = await this.context();
    const postType = [...context.types.values()].find((type) => type.key === 'post');
    const items =
      postType?.isPublic === true
        ? this.cards(
            context,
            await this.prisma.entry.findMany({
              where: {
                siteId: context.state.id,
                contentTypeId: postType.id,
                ...publicEntryWhere(context.now),
              },
              include: cardInclude,
              orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
              take: FEED_LIMIT,
            }),
          )
        : [];
    const { name, tagline, baseUrl, language } = context.site;
    return { site: { name, tagline, baseUrl, language }, items };
  }

  // ---------------------------------------------------------------------------- routing

  private async resolve(context: Context, rawPath: string, page: number): Promise<DeliveryRoute> {
    if (rawPath.length > 1 && rawPath.endsWith('/')) {
      const trimmed = rawPath.replace(/\/+$/, '') || '/';
      const query = page > 1 ? `?page=${String(page)}` : '';
      return { kind: 'redirect', location: encodeSitePath(trimmed) + query, statusCode: 301 };
    }
    if (rawPath === '/') {
      return this.home(context, page);
    }
    const segments = rawPath.slice(1).split('/');
    if (segments.some((segment) => segment === '')) {
      return NOT_FOUND;
    }
    const [first = '', ...rest] = segments;
    const types = [...context.types.values()];
    const type = types.find((item) => item.routePrefix !== '' && item.routePrefix === first);
    const taxonomy = [...context.taxonomies.values()].find((item) => item.routePrefix === first);

    let route: DeliveryRoute | null = null;
    if (type) {
      if (type.isPublic) {
        route =
          rest.length === 0
            ? type.hierarchical
              ? null
              : await this.typeArchive(context, type, page)
            : await this.entryRoute(context, type, rest.join('/'));
      }
    } else if (taxonomy) {
      if (taxonomy.isPublic && rest.length === 1 && rest[0] !== undefined) {
        route = await this.termArchive(context, taxonomy, rest[0], page);
      }
    } else {
      const root = types.find((item) => item.routePrefix === '');
      if (root?.isPublic) {
        route = await this.entryRoute(context, root, segments.join('/'));
      }
    }
    return route ?? (await this.redirectFor(context, rawPath)) ?? NOT_FOUND;
  }

  private async home(context: Context, page: number): Promise<DeliveryRoute> {
    const canonicalUrl = this.absolute(context, '/', page);
    if (context.homepageEntryId !== null) {
      const row = await this.visibleEntry(context, { id: context.homepageEntryId });
      if (row) {
        if (page > 1) return NOT_FOUND;
        return {
          kind: 'home',
          canonicalUrl,
          listing: null,
          entry: await this.toEntry(context, row),
        };
      }
      // The chosen page is not public (unpublished or trashed): fall back to the latest posts.
    }
    const postType = [...context.types.values()].find((type) => type.key === 'post');
    const listing =
      postType?.isPublic === true
        ? await this.listing(context, { contentTypeId: postType.id }, page)
        : {
            items: [],
            page,
            pageSize: context.state.reading.postsPerPage,
            total: 0,
            totalPages: 0,
          };
    if (page > Math.max(1, listing.totalPages)) return NOT_FOUND;
    return { kind: 'home', canonicalUrl, listing, entry: null };
  }

  private async typeArchive(
    context: Context,
    type: TypeInfo,
    page: number,
  ): Promise<DeliveryRoute | null> {
    const listing = await this.listing(context, { contentTypeId: type.id }, page);
    if (page > Math.max(1, listing.totalPages)) return null;
    return {
      kind: 'archive',
      canonicalUrl: this.absolute(context, publicArchivePath(type.routePrefix), page),
      archive: { type: 'content_type', contentType: this.typeRef(type) },
      listing,
    };
  }

  private async termArchive(
    context: Context,
    taxonomy: TaxonomyInfo,
    slug: string,
    page: number,
  ): Promise<DeliveryRoute | null> {
    const term = await this.prisma.term.findFirst({
      where: { siteId: context.state.id, taxonomyId: taxonomy.id, slug },
      select: { id: true, name: true, slug: true, description: true },
    });
    if (!term) return null;
    const listing = await this.listing(context, { terms: { some: { termId: term.id } } }, page);
    if (page > Math.max(1, listing.totalPages)) return null;
    return {
      kind: 'archive',
      canonicalUrl: this.absolute(context, publicTermPath(taxonomy.routePrefix, term.slug), page),
      archive: {
        type: 'term',
        taxonomy: { key: taxonomy.key, name: taxonomy.name, pluralName: taxonomy.pluralName },
        term: { name: term.name, slug: term.slug, description: term.description },
      },
      listing,
    };
  }

  private async entryRoute(
    context: Context,
    type: TypeInfo,
    path: string,
  ): Promise<DeliveryRoute | null> {
    const row = await this.visibleEntry(context, { contentTypeId: type.id, path });
    return row ? { kind: 'entry', entry: await this.toEntry(context, row) } : null;
  }

  private async redirectFor(context: Context, path: string): Promise<DeliveryRoute | null> {
    const redirect = await this.prisma.redirect.findUnique({
      where: { siteId_fromPath: { siteId: context.state.id, fromPath: path } },
      select: { toPath: true, statusCode: true },
    });
    if (!redirect) return null;
    return {
      kind: 'redirect',
      location: this.redirectLocation(redirect.toPath),
      statusCode: redirect.statusCode as 301 | 302 | 307 | 308,
    };
  }

  /** Site paths are stored decoded; the Location header needs them percent-encoded. */
  private redirectLocation(target: string): string {
    if (!target.startsWith('/')) {
      return new URL(target).href;
    }
    const index = target.search(/[?#]/);
    const path = index === -1 ? target : target.slice(0, index);
    const suffix = index === -1 ? '' : target.slice(index);
    const decoded = path
      .split('/')
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join('/');
    return encodeSitePath(decoded) + suffix;
  }

  // ---------------------------------------------------------------------------- queries

  /** A publicly visible entry (ancestors included) matching `where`, or null. */
  private async visibleEntry(
    context: Context,
    where: Prisma.EntryWhereInput,
  ): Promise<CardRow | null> {
    const row = await this.prisma.entry.findFirst({
      where: { ...where, siteId: context.state.id, ...publicEntryWhere(context.now) },
      include: cardInclude,
    });
    if (!row) return null;
    const visible = await filterVisibleAncestors(this.prisma, context.state.id, [row], context.now);
    return visible.length === 1 ? row : null;
  }

  /**
   * A page of publicly visible entries, newest first. Listings contain top-level entries only: entries
   * of non-hierarchical types always are, and for hierarchical types this avoids per-row ancestor checks.
   */
  private async listing(
    context: Context,
    filter: Prisma.EntryWhereInput,
    page: number,
  ): Promise<DeliveryListing> {
    const pageSize = context.state.reading.postsPerPage;
    const where: Prisma.EntryWhereInput = {
      AND: [filter, { siteId: context.state.id, parentId: null, ...publicEntryWhere(context.now) }],
    };
    const [total, rows] = await Promise.all([
      this.prisma.entry.count({ where }),
      this.prisma.entry.findMany({
        where,
        include: cardInclude,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: this.cards(context, rows),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ---------------------------------------------------------------------------- mapping

  private async context(): Promise<Context> {
    const now = new Date();
    const state = await this.settings.state();
    const [types, taxonomies] = await Promise.all([
      this.prisma.contentType.findMany({
        select: {
          id: true,
          key: true,
          name: true,
          pluralName: true,
          hierarchical: true,
          routePrefix: true,
          isPublic: true,
          fields: true,
        },
      }),
      this.prisma.taxonomy.findMany({
        select: {
          id: true,
          key: true,
          name: true,
          pluralName: true,
          routePrefix: true,
          isPublic: true,
        },
      }),
    ]);
    const homepageEntryId =
      state.reading.homepage.mode === 'page' ? state.reading.homepage.pageId : null;
    const mediaIds = [
      ...(state.seo.defaultImageId ? [state.seo.defaultImageId] : []),
      ...state.theme.settings
        .filter((setting) => setting.type === 'media')
        .map((setting) => state.themeSettings[setting.key])
        .filter((value): value is string => typeof value === 'string'),
    ];
    const [media, menus] = await Promise.all([
      this.mediaMap(state.id, mediaIds),
      this.menus.deliveryMenus(this.prisma, state.id, state.theme, homepageEntryId, now),
    ]);
    const themeMedia: Record<string, DeliveryMedia> = {};
    for (const setting of state.theme.settings) {
      const value = state.themeSettings[setting.key];
      const item = setting.type === 'media' && typeof value === 'string' ? media[value] : undefined;
      if (item) themeMedia[setting.key] = item;
    }
    const site: DeliverySite = {
      name: state.name,
      tagline: state.reading.tagline,
      baseUrl: state.baseUrl,
      language: state.reading.language,
      direction: textDirection(state.reading.language),
      seo: {
        titleTemplate: state.seo.titleTemplate,
        defaultDescription: state.seo.defaultDescription,
        defaultImage: state.seo.defaultImageId ? (media[state.seo.defaultImageId] ?? null) : null,
        indexing: state.seo.indexing,
      },
      theme: { key: state.theme.key, settings: state.themeSettings, media: themeMedia },
      menus,
    };
    return {
      now,
      state,
      site,
      types: new Map(
        types.map((type) => [
          type.id,
          { ...type, fields: fieldDefinitionsSchema.safeParse(type.fields).data ?? [] },
        ]),
      ),
      taxonomies: new Map(taxonomies.map((taxonomy) => [taxonomy.id, taxonomy])),
      homepageEntryId,
    };
  }

  private typeRef(type: TypeInfo) {
    return {
      key: type.key,
      name: type.name,
      pluralName: type.pluralName,
      hierarchical: type.hierarchical,
    };
  }

  private absolute(context: Context, path: string, page = 1): string {
    const query = page > 1 ? `?page=${String(page)}` : '';
    return `${context.state.baseUrl}${encodeSitePath(path)}${query}`;
  }

  private entryUrl(
    context: Context,
    row: { id: string; contentTypeId: string; path: string },
  ): string {
    if (row.id === context.homepageEntryId) return '/';
    const type = context.types.get(row.contentTypeId);
    return publicEntryPath(type?.routePrefix ?? '', row.path);
  }

  private toMedia(row: MediaRow): DeliveryMedia {
    const variants = (Array.isArray(row.variants)
      ? row.variants
      : []) as unknown as StoredVariant[];
    return {
      id: row.id,
      url: this.mediaUrls.url(row.storageKey),
      mimeType: row.mimeType,
      width: row.width,
      height: row.height,
      altText: row.altText,
      caption: row.caption,
      sources: [...variants]
        .sort((a, b) => a.width - b.width)
        .map((variant) => ({
          url: this.mediaUrls.url(variant.key),
          width: variant.width,
          height: variant.height,
        })),
    };
  }

  private async mediaMap(
    siteId: string,
    ids: readonly string[],
  ): Promise<Record<string, DeliveryMedia>> {
    if (ids.length === 0) return {};
    const rows = await this.prisma.media.findMany({
      where: { siteId, id: { in: [...new Set(ids)] } },
      select: mediaSelect,
    });
    return Object.fromEntries(rows.map((row) => [row.id, this.toMedia(row)]));
  }

  private termRefs(context: Context, row: CardRow): DeliveryEntryCard['terms'] {
    return row.terms.flatMap(({ term }) => {
      const taxonomy = context.taxonomies.get(term.taxonomyId);
      // Terms of non-public taxonomies are internal classification and are not delivered.
      if (!taxonomy?.isPublic) return [];
      return [
        {
          taxonomy: taxonomy.key,
          taxonomyName: taxonomy.name,
          name: term.name,
          slug: term.slug,
          url: publicTermPath(taxonomy.routePrefix, term.slug),
        },
      ];
    });
  }

  private card(context: Context, row: CardRow): DeliveryEntryCard {
    const type = context.types.get(row.contentTypeId);
    const body = richTextDocumentSchema.safeParse(row.body).data;
    return {
      id: row.id,
      type: type?.key ?? '',
      title: row.title,
      url: this.entryUrl(context, row),
      summary: row.excerpt !== '' ? row.excerpt : summarize(body ? richTextToPlainText(body) : ''),
      publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      author: { displayName: row.author.displayName },
      featuredMedia: row.featuredMedia ? this.toMedia(row.featuredMedia) : null,
      terms: this.termRefs(context, row),
    };
  }

  private cards(context: Context, rows: readonly CardRow[]): DeliveryEntryCard[] {
    return rows.map((row) => this.card(context, row));
  }

  private async toEntry(context: Context, row: CardRow): Promise<DeliveryEntry> {
    const type = context.types.get(row.contentTypeId);
    if (!type) throw new Error(`Unknown content type ${row.contentTypeId}`);
    const body = richTextDocumentSchema.safeParse(row.body).data ?? {
      type: 'doc' as const,
      content: [],
    };
    const values = (row.fields ?? {}) as Record<string, unknown>;
    const fields: DeliveryField[] = [];
    const mediaIds = [...richTextMediaIds(body)];
    for (const field of type.fields) {
      const value = values[field.key];
      if (!field.public || value === undefined || value === null || value === '') continue;
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
        continue;
      let display = String(value);
      if (field.type === 'select') {
        display = field.options.find((option) => option.value === value)?.label ?? display;
      } else if (field.type === 'media' && typeof value === 'string') {
        mediaIds.push(value);
      }
      fields.push({ key: field.key, label: field.label, type: field.type, value, display });
    }
    const card = this.card(context, row);
    return {
      ...card,
      contentType: this.typeRef(type),
      slug: row.slug,
      canonicalUrl: this.absolute(context, card.url),
      excerpt: row.excerpt,
      body,
      fields,
      media: await this.mediaMap(context.state.id, mediaIds),
      seo: entrySeoSchema.safeParse(row.seo).data ?? { title: '', description: '', noindex: false },
    };
  }
}
