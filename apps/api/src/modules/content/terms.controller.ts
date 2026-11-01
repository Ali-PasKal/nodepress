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
  Query,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createTermSchema,
  termListQuerySchema,
  termListResponseSchema,
  termSchema,
  updateTermSchema,
  uuidSchema,
  type TermInfo,
  type TermListResponse,
} from '@nexora/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { requestMeta } from '../../common/http/request-meta.js';
import { ZodBody } from '../../common/openapi/zod-body.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { AuthContext } from '../security/auth-context.js';
import { CurrentAuth, RequireAnyCapability, RequireCapabilities } from '../security/decorators.js';
import { TermsService } from './terms.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);

@ApiTags('terms')
@Controller({ version: '1' })
export class TermsController {
  constructor(private readonly terms: TermsService) {}

  @Get('taxonomies/:id/terms')
  @RequireAnyCapability('content.read', 'content.create', 'content.edit_others', 'terms.manage')
  @ApiOperation({ summary: 'List the terms of a taxonomy' })
  @ApiOkResponse({ standardSchema: termListResponseSchema })
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) taxonomyId: string,
    @Query(new ZodValidationPipe(termListQuerySchema)) query: z.output<typeof termListQuerySchema>,
  ): Promise<TermListResponse> {
    return this.terms.list(auth.siteId, taxonomyId, query);
  }

  @Post('taxonomies/:id/terms')
  @RequireCapabilities('terms.manage')
  @ApiOperation({ summary: 'Create a term' })
  @ZodBody(createTermSchema)
  @ApiOkResponse({ standardSchema: termSchema })
  create(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) taxonomyId: string,
    @Body(new ZodValidationPipe(createTermSchema)) body: z.output<typeof createTermSchema>,
  ): Promise<TermInfo> {
    return this.terms.create(auth, taxonomyId, body);
  }

  @Patch('terms/:id')
  @RequireCapabilities('terms.manage')
  @ApiOperation({ summary: 'Update a term' })
  @ZodBody(updateTermSchema)
  @ApiOkResponse({ standardSchema: termSchema })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateTermSchema)) body: z.output<typeof updateTermSchema>,
  ): Promise<TermInfo> {
    return this.terms.update(auth, id, body);
  }

  @Delete('terms/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireCapabilities('terms.manage')
  @ApiOperation({ summary: 'Delete a term (children move up; entries lose the term)' })
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.terms.delete(auth, id, requestMeta(req));
  }
}
