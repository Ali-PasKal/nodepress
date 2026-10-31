import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { siteSettingsSchema, updateSiteSettingsSchema, type SiteSettings } from '@nexora/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { requestMeta } from '../../common/http/request-meta.js';
import { ZodBody } from '../../common/openapi/zod-body.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../security/auth-context.js';
import { CurrentAuth, RequireCapabilities } from '../security/decorators.js';
import { SiteService } from '../sites/site.service.js';

@ApiTags('settings')
@Controller({ path: 'settings', version: '1' })
@RequireCapabilities('system.manage')
export class SettingsController {
  constructor(
    private readonly sites: SiteService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('site')
  @ApiOperation({ summary: 'Site name and public base URL' })
  @ApiOkResponse({ standardSchema: siteSettingsSchema })
  async get(): Promise<SiteSettings> {
    const site = await this.sites.requireDefault();
    return { name: site.name, baseUrl: site.baseUrl };
  }

  @Patch('site')
  @ApiOperation({ summary: 'Update site name and/or public base URL' })
  @ZodBody(updateSiteSettingsSchema)
  @ApiOkResponse({ standardSchema: siteSettingsSchema })
  async update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateSiteSettingsSchema))
    body: z.output<typeof updateSiteSettingsSchema>,
    @Req() req: Request,
  ): Promise<SiteSettings> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const site = await tx.site.update({
        where: { id: auth.siteId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl } : {}),
        },
        select: { name: true, baseUrl: true },
      });
      await this.audit.record(tx, {
        action: 'settings.site_updated',
        actorUserId: auth.userId,
        targetType: 'site',
        targetId: auth.siteId,
        request: requestMeta(req),
        metadata: {
          fields: Object.keys(body).filter((key) => body[key as keyof typeof body] !== undefined),
        },
      });
      return site;
    });
    return updated;
  }
}
