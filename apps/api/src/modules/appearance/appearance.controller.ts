import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  activateThemeSchema,
  generalSettingsSchema,
  seoSettingsResponseSchema,
  THEME_KEY_PATTERN,
  themeSettingsResponseSchema,
  themesResponseSchema,
  updateGeneralSettingsSchema,
  updateSeoSettingsSchema,
  updateThemeSettingsSchema,
  type GeneralSettings,
  type SeoSettingsResponse,
  type ThemeSettingsResponse,
  type ThemesResponse,
} from '@nexora/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../common/http/request-meta.js';
import { ZodBody } from '../../common/openapi/zod-body.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { AuthContext } from '../security/auth-context.js';
import { CurrentAuth, RequireCapabilities } from '../security/decorators.js';
import { SiteSettingsService } from './site-settings.service.js';

const themeKeyPipe = new ZodValidationPipe(z.string().regex(THEME_KEY_PATTERN));

@ApiTags('appearance')
@Controller({ version: '1' })
export class AppearanceController {
  constructor(private readonly settings: SiteSettingsService) {}

  @Get('settings/general')
  @RequireCapabilities('appearance.manage')
  @ApiOperation({ summary: 'Site name, tagline, language, home page and posts per page' })
  @ApiOkResponse({ standardSchema: generalSettingsSchema })
  general(): Promise<GeneralSettings> {
    return this.settings.general();
  }

  @Put('settings/general')
  @RequireCapabilities('appearance.manage')
  @ApiOperation({ summary: 'Replace the general settings' })
  @ZodBody(updateGeneralSettingsSchema)
  @ApiOkResponse({ standardSchema: generalSettingsSchema })
  updateGeneral(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateGeneralSettingsSchema))
    body: z.output<typeof updateGeneralSettingsSchema>,
    @Req() req: Request,
  ): Promise<GeneralSettings> {
    return this.settings.updateGeneral(auth, body, requestMeta(req));
  }

  @Get('settings/seo')
  @RequireCapabilities('seo.manage')
  @ApiOperation({ summary: 'Site-wide SEO settings' })
  @ApiOkResponse({ standardSchema: seoSettingsResponseSchema })
  seo(): Promise<SeoSettingsResponse> {
    return this.settings.seo();
  }

  @Put('settings/seo')
  @RequireCapabilities('seo.manage')
  @ApiOperation({ summary: 'Replace the site-wide SEO settings' })
  @ZodBody(updateSeoSettingsSchema)
  @ApiOkResponse({ standardSchema: seoSettingsResponseSchema })
  updateSeo(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateSeoSettingsSchema))
    body: z.output<typeof updateSeoSettingsSchema>,
    @Req() req: Request,
  ): Promise<SeoSettingsResponse> {
    return this.settings.updateSeo(auth, body, requestMeta(req));
  }

  @Get('appearance/themes')
  @RequireCapabilities('appearance.manage')
  @ApiOperation({ summary: 'Installed themes and the active theme' })
  @ApiOkResponse({ standardSchema: themesResponseSchema })
  themes(): Promise<ThemesResponse> {
    return this.settings.themesInfo();
  }

  @Put('appearance/theme')
  @RequireCapabilities('appearance.manage')
  @ApiOperation({ summary: 'Activate a theme' })
  @ZodBody(activateThemeSchema)
  @ApiOkResponse({ standardSchema: themesResponseSchema })
  activate(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(activateThemeSchema)) body: z.output<typeof activateThemeSchema>,
    @Req() req: Request,
  ): Promise<ThemesResponse> {
    return this.settings.activateTheme(auth, body.theme, requestMeta(req));
  }

  @Get('appearance/themes/:key/settings')
  @RequireCapabilities('appearance.manage')
  @ApiOperation({ summary: "A theme's settings (stored values merged with the theme's defaults)" })
  @ApiOkResponse({ standardSchema: themeSettingsResponseSchema })
  themeSettings(@Param('key', themeKeyPipe) key: string): Promise<ThemeSettingsResponse> {
    return this.settings.themeSettings(key);
  }

  @Put('appearance/themes/:key/settings')
  @RequireCapabilities('appearance.manage')
  @ApiOperation({ summary: "Replace a theme's settings (validated against the theme's manifest)" })
  @ZodBody(updateThemeSettingsSchema)
  @ApiOkResponse({ standardSchema: themeSettingsResponseSchema })
  updateThemeSettings(
    @CurrentAuth() auth: AuthContext,
    @Param('key', themeKeyPipe) key: string,
    @Body(new ZodValidationPipe(updateThemeSettingsSchema))
    body: z.output<typeof updateThemeSettingsSchema>,
    @Req() req: Request,
  ): Promise<ThemeSettingsResponse> {
    return this.settings.updateThemeSettings(auth, key, body.values, requestMeta(req));
  }
}
