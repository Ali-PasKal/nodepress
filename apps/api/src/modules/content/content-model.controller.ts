import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  contentModelResponseSchema,
  contentTypeSchema,
  createContentTypeSchema,
  createTaxonomySchema,
  taxonomySchema,
  updateContentTypeSchema,
  updateTaxonomySchema,
  uuidSchema,
  type ContentModelResponse,
  type ContentTypeInfo,
  type TaxonomyInfo,
} from '@nexora/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { requestMeta } from '../../common/http/request-meta.js';
import { ZodBody } from '../../common/openapi/zod-body.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { AuthContext } from '../security/auth-context.js';
import { CurrentAuth, RequireAnyCapability, RequireCapabilities } from '../security/decorators.js';
import { ContentModelService } from './content-model.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);

@ApiTags('content model')
@Controller({ version: '1' })
export class ContentModelController {
  constructor(private readonly model: ContentModelService) {}

  @Get('content-model')
  @RequireAnyCapability(
    'content.read',
    'content.create',
    'content.edit_others',
    'terms.manage',
    'content_types.manage',
  )
  @ApiOperation({ summary: 'Content types (with custom fields) and taxonomies' })
  @ApiOkResponse({ standardSchema: contentModelResponseSchema })
  get(): Promise<ContentModelResponse> {
    return this.model.model();
  }

  @Post('content-types')
  @RequireCapabilities('content_types.manage')
  @ApiOperation({ summary: 'Create a custom content type' })
  @ZodBody(createContentTypeSchema)
  @ApiOkResponse({ standardSchema: contentTypeSchema })
  createContentType(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createContentTypeSchema))
    body: z.output<typeof createContentTypeSchema>,
    @Req() req: Request,
  ): Promise<ContentTypeInfo> {
    return this.model.createContentType(auth, body, requestMeta(req));
  }

  @Patch('content-types/:id')
  @RequireCapabilities('content_types.manage')
  @ApiOperation({ summary: 'Update a content type (labels, features, fields, taxonomies)' })
  @ZodBody(updateContentTypeSchema)
  @ApiOkResponse({ standardSchema: contentTypeSchema })
  updateContentType(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateContentTypeSchema))
    body: z.output<typeof updateContentTypeSchema>,
    @Req() req: Request,
  ): Promise<ContentTypeInfo> {
    return this.model.updateContentType(auth, id, body, requestMeta(req));
  }

  @Delete('content-types/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireCapabilities('content_types.manage')
  @ApiOperation({ summary: 'Delete a custom content type that has no entries' })
  async deleteContentType(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.model.deleteContentType(auth, id, requestMeta(req));
  }

  @Post('taxonomies')
  @RequireCapabilities('content_types.manage')
  @ApiOperation({ summary: 'Create a custom taxonomy' })
  @ZodBody(createTaxonomySchema)
  @ApiOkResponse({ standardSchema: taxonomySchema })
  createTaxonomy(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createTaxonomySchema)) body: z.output<typeof createTaxonomySchema>,
    @Req() req: Request,
  ): Promise<TaxonomyInfo> {
    return this.model.createTaxonomy(auth, body, requestMeta(req));
  }

  @Patch('taxonomies/:id')
  @RequireCapabilities('content_types.manage')
  @ApiOperation({ summary: 'Update a taxonomy (labels and content types)' })
  @ZodBody(updateTaxonomySchema)
  @ApiOkResponse({ standardSchema: taxonomySchema })
  updateTaxonomy(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateTaxonomySchema)) body: z.output<typeof updateTaxonomySchema>,
    @Req() req: Request,
  ): Promise<TaxonomyInfo> {
    return this.model.updateTaxonomy(auth, id, body, requestMeta(req));
  }

  @Delete('taxonomies/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireCapabilities('content_types.manage')
  @ApiOperation({ summary: 'Delete a custom taxonomy and its terms' })
  async deleteTaxonomy(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.model.deleteTaxonomy(auth, id, requestMeta(req));
  }
}
