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
  createRedirectSchema,
  redirectListQuerySchema,
  redirectListResponseSchema,
  redirectSchema,
  updateRedirectSchema,
  uuidSchema,
  type RedirectInfo,
  type RedirectListResponse,
} from '@nexora/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { requestMeta } from '../../common/http/request-meta.js';
import { ZodBody } from '../../common/openapi/zod-body.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { AuthContext } from '../security/auth-context.js';
import { CurrentAuth, RequireCapabilities } from '../security/decorators.js';
import { RedirectsService } from './redirects.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);

@ApiTags('redirects')
@Controller({ path: 'redirects', version: '1' })
@RequireCapabilities('seo.manage')
export class RedirectsController {
  constructor(private readonly redirects: RedirectsService) {}

  @Get()
  @ApiOperation({ summary: 'List redirects' })
  @ApiOkResponse({ standardSchema: redirectListResponseSchema })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(redirectListQuerySchema))
    query: z.output<typeof redirectListQuerySchema>,
  ): Promise<RedirectListResponse> {
    return this.redirects.list(auth.siteId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a manual redirect' })
  @ZodBody(createRedirectSchema)
  @ApiOkResponse({ standardSchema: redirectSchema })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createRedirectSchema)) body: z.output<typeof createRedirectSchema>,
    @Req() req: Request,
  ): Promise<RedirectInfo> {
    return this.redirects.create(auth, body, requestMeta(req));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a redirect (it becomes a manual redirect)' })
  @ZodBody(updateRedirectSchema)
  @ApiOkResponse({ standardSchema: redirectSchema })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateRedirectSchema)) body: z.output<typeof updateRedirectSchema>,
    @Req() req: Request,
  ): Promise<RedirectInfo> {
    return this.redirects.update(auth, id, body, requestMeta(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a redirect' })
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.redirects.delete(auth, id, requestMeta(req));
  }
}
