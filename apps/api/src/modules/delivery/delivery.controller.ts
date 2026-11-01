import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  deliveryEmbedSchema,
  deliveryFeedSchema,
  deliveryPageQuerySchema,
  deliveryPageSchema,
  deliverySiteSchema,
  deliverySitemapSchema,
  type DeliveryEmbed,
  type DeliveryFeed,
  type DeliveryPage,
  type DeliverySite,
  type DeliverySitemap,
} from '@nexora/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Public } from '../security/decorators.js';
import { DeliveryService } from './delivery.service.js';

/**
 * Public, read-only content for the site runtime and other front ends. Only publicly visible content is
 * returned; preview links are the one exception and require an unguessable, expiring token.
 */
@ApiTags('delivery')
@Public()
@Controller({ path: 'delivery', version: '1' })
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get('site')
  @ApiOperation({ summary: 'Site identity, SEO defaults, theme settings and menus' })
  @ApiOkResponse({ standardSchema: deliverySiteSchema })
  site(): Promise<DeliverySite> {
    return this.delivery.site();
  }

  @Get('page')
  @ApiOperation({
    summary: 'Resolve a public path to a page (home, entry, archive, redirect or not found)',
  })
  @ApiOkResponse({ standardSchema: deliveryPageSchema })
  page(
    @Query(new ZodValidationPipe(deliveryPageQuerySchema))
    query: z.output<typeof deliveryPageQuerySchema>,
  ): Promise<DeliveryPage> {
    return this.delivery.page(query.path, query.page);
  }

  @Get('preview/:token')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: 'The entry named by a preview link, in its latest saved state' })
  @ApiOkResponse({ standardSchema: deliveryPageSchema })
  preview(@Param('token') token: string): Promise<DeliveryPage> {
    return this.delivery.preview(token);
  }

  @Get('preview/:token/embed/:widgetId')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: 'HTML of an embed widget on the entry named by a preview link' })
  @ApiOkResponse({ standardSchema: deliveryEmbedSchema })
  previewEmbed(
    @Param('token') token: string,
    @Param('widgetId') widgetId: string,
  ): Promise<DeliveryEmbed> {
    return this.delivery.previewEmbed(token, widgetId);
  }

  @Get('embed/:entryId/:widgetId')
  @ApiOperation({
    summary:
      'HTML of an embed widget on a public entry (the site serves it in a sandboxed document)',
  })
  @ApiOkResponse({ standardSchema: deliveryEmbedSchema })
  embed(
    @Param('entryId') entryId: string,
    @Param('widgetId') widgetId: string,
  ): Promise<DeliveryEmbed> {
    return this.delivery.embed(entryId, widgetId);
  }

  @Get('sitemap')
  @ApiOperation({ summary: 'Public URLs for sitemap.xml' })
  @ApiOkResponse({ standardSchema: deliverySitemapSchema })
  sitemap(): Promise<DeliverySitemap> {
    return this.delivery.sitemap();
  }

  @Get('feed')
  @ApiOperation({ summary: 'Latest posts for the RSS feed' })
  @ApiOkResponse({ standardSchema: deliveryFeedSchema })
  feed(): Promise<DeliveryFeed> {
    return this.delivery.feed();
  }
}
