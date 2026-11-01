import { Injectable } from '@nestjs/common';
import {
  buildThemeSettingsSchema,
  readingSettingsSchema,
  resolveThemeSettings,
  seoSettingsSchema,
  type GeneralSettings,
  type ReadingSettings,
  type SeoSettings,
  type SeoSettingsResponse,
  type ThemeManifest,
  type ThemeSettingsResponse,
  type ThemeSettingValues,
  type ThemesResponse,
  type updateGeneralSettingsSchema,
  type updateSeoSettingsSchema,
} from '@nexora/shared';
import type { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { MediaUrls } from '../media/media-urls.js';
import type { AuthContext } from '../security/auth-context.js';
import { SiteService } from '../sites/site.service.js';
import { existingImageIds, mediaPreviews } from './media-preview.js';
import { ThemeRegistry } from './theme-registry.js';

/** Everything the public site needs from the site row, parsed and defaulted. */
export interface SiteState {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly reading: ReadingSettings;
  readonly seo: SeoSettings;
  readonly theme: ThemeManifest;
  readonly themeSettings: ThemeSettingValues;
}

function invalid(path: string, message: string): ApiException {
  return new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
    { path, message },
  ]);
}

function objectOf(value: Prisma.JsonValue | undefined): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Each section falls back to its defaults on its own, so one unreadable section never breaks the site. */
function parseSection<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  return parsed.success ? parsed.data : schema.parse({});
}

/** Site-wide public settings: identity and reading, SEO, the active theme and its settings. */
@Injectable()
export class SiteSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sites: SiteService,
    private readonly themes: ThemeRegistry,
    private readonly audit: AuditService,
    private readonly mediaUrls: MediaUrls,
  ) {}

  async state(db: DbClient = this.prisma): Promise<SiteState> {
    const { id } = await this.sites.requireDefault(db);
    const row = await db.site.findUniqueOrThrow({
      where: { id },
      select: { name: true, baseUrl: true, settings: true, activeTheme: true, themeSettings: true },
    });
    const settings = objectOf(row.settings);
    const theme = this.themes.resolve(row.activeTheme);
    return {
      id,
      name: row.name,
      baseUrl: row.baseUrl,
      reading: parseSection(readingSettingsSchema, settings.reading),
      seo: parseSection(seoSettingsSchema, settings.seo),
      theme,
      themeSettings: resolveThemeSettings(theme, objectOf(row.themeSettings)[theme.key]),
    };
  }

  // ---------------------------------------------------------------------------- general

  async general(): Promise<GeneralSettings> {
    const state = await this.state();
    return { name: state.name, ...state.reading };
  }

  async updateGeneral(
    actor: AuthContext,
    input: z.output<typeof updateGeneralSettingsSchema>,
    meta: RequestMeta,
  ): Promise<GeneralSettings> {
    if (input.homepage.mode === 'page') {
      const page = await this.prisma.entry.findFirst({
        where: {
          id: input.homepage.pageId,
          siteId: actor.siteId,
          trashedAt: null,
          contentType: { routePrefix: '' },
        },
        select: { id: true },
      });
      if (!page) {
        throw invalid('homepage.pageId', 'Choose a page that is not in the trash.');
      }
    }
    const reading: ReadingSettings = {
      tagline: input.tagline,
      language: input.language,
      homepage: input.homepage,
      postsPerPage: input.postsPerPage,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE sites
           SET name = ${input.name},
               settings = jsonb_set(settings, '{reading}', ${JSON.stringify(reading)}::jsonb),
               updated_at = now()
         WHERE id = ${actor.siteId}::uuid`;
      await this.audit.record(tx, {
        action: 'settings.general_updated',
        actorUserId: actor.userId,
        targetType: 'site',
        targetId: actor.siteId,
        request: meta,
        metadata: { language: input.language, homepage: input.homepage.mode },
      });
    });
    return this.general();
  }

  // ---------------------------------------------------------------------------- SEO

  async seo(): Promise<SeoSettingsResponse> {
    const state = await this.state();
    const previews = await mediaPreviews(
      this.prisma,
      this.mediaUrls,
      state.id,
      state.seo.defaultImageId ? [state.seo.defaultImageId] : [],
    );
    return {
      ...state.seo,
      defaultImage: state.seo.defaultImageId
        ? (previews.get(state.seo.defaultImageId) ?? null)
        : null,
    };
  }

  async updateSeo(
    actor: AuthContext,
    input: z.output<typeof updateSeoSettingsSchema>,
    meta: RequestMeta,
  ): Promise<SeoSettingsResponse> {
    if (input.defaultImageId !== null) {
      const images = await existingImageIds(this.prisma, actor.siteId, [input.defaultImageId]);
      if (!images.has(input.defaultImageId)) {
        throw invalid('defaultImageId', 'Choose an image from the media library.');
      }
    }
    const seo: SeoSettings = { ...input };
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE sites
           SET settings = jsonb_set(settings, '{seo}', ${JSON.stringify(seo)}::jsonb),
               updated_at = now()
         WHERE id = ${actor.siteId}::uuid`;
      await this.audit.record(tx, {
        action: 'settings.seo_updated',
        actorUserId: actor.userId,
        targetType: 'site',
        targetId: actor.siteId,
        request: meta,
        metadata: { indexing: input.indexing },
      });
    });
    return this.seo();
  }

  // ---------------------------------------------------------------------------- themes

  async themesInfo(): Promise<ThemesResponse> {
    const state = await this.state();
    return { activeTheme: state.theme.key, themes: this.themes.list() };
  }

  async activateTheme(actor: AuthContext, key: string, meta: RequestMeta): Promise<ThemesResponse> {
    const theme = this.themes.require(key);
    await this.prisma.$transaction(async (tx) => {
      await tx.site.update({ where: { id: actor.siteId }, data: { activeTheme: theme.key } });
      await this.audit.record(tx, {
        action: 'appearance.theme_activated',
        actorUserId: actor.userId,
        targetType: 'site',
        targetId: actor.siteId,
        request: meta,
        metadata: { theme: theme.key },
      });
    });
    return this.themesInfo();
  }

  async themeSettings(key: string): Promise<ThemeSettingsResponse> {
    const theme = this.themes.require(key);
    const { id } = await this.sites.requireDefault();
    const row = await this.prisma.site.findUniqueOrThrow({
      where: { id },
      select: { themeSettings: true },
    });
    const values = resolveThemeSettings(theme, objectOf(row.themeSettings)[theme.key]);
    const mediaKeys = theme.settings.filter((setting) => setting.type === 'media');
    const ids = mediaKeys
      .map((setting) => values[setting.key])
      .filter((value): value is string => typeof value === 'string');
    const previews = await mediaPreviews(this.prisma, this.mediaUrls, id, ids);
    const media: ThemeSettingsResponse['media'] = {};
    for (const setting of mediaKeys) {
      const value = values[setting.key];
      const preview = typeof value === 'string' ? previews.get(value) : undefined;
      if (preview) media[setting.key] = preview;
    }
    return { theme: theme.key, values, media };
  }

  async updateThemeSettings(
    actor: AuthContext,
    key: string,
    input: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<ThemeSettingsResponse> {
    const theme = this.themes.require(key);
    const parsed = buildThemeSettingsSchema(theme).safeParse(input);
    if (!parsed.success) {
      throw new ApiException(
        422,
        'VALIDATION_FAILED',
        'The request contains invalid data.',
        parsed.error.issues.map((issue) => ({
          path: ['values', ...issue.path.map(String)].join('.'),
          message: issue.message,
        })),
      );
    }
    const values = parsed.data;
    const mediaIds = theme.settings
      .filter((setting) => setting.type === 'media')
      .map((setting) => values[setting.key])
      .filter((value): value is string => typeof value === 'string');
    const images = await existingImageIds(this.prisma, actor.siteId, mediaIds);
    for (const setting of theme.settings) {
      const value = values[setting.key];
      if (setting.type === 'media' && typeof value === 'string' && !images.has(value)) {
        throw invalid(`values.${setting.key}`, 'Choose an image from the media library.');
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE sites
           SET theme_settings = jsonb_set(theme_settings, ARRAY[${theme.key}]::text[], ${JSON.stringify(values)}::jsonb),
               updated_at = now()
         WHERE id = ${actor.siteId}::uuid`;
      await this.audit.record(tx, {
        action: 'appearance.theme_settings_updated',
        actorUserId: actor.userId,
        targetType: 'site',
        targetId: actor.siteId,
        request: meta,
        metadata: { theme: theme.key },
      });
    });
    return this.themeSettings(theme.key);
  }
}
