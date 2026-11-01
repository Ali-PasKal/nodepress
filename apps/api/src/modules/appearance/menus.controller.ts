import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createMenuSchema,
  menuDetailSchema,
  menusResponseSchema,
  saveMenuSchema,
  uuidSchema,
  type MenuDetail,
  type MenusResponse,
} from '@nexora/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { requestMeta } from '../../common/http/request-meta.js';
import { ZodBody } from '../../common/openapi/zod-body.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { AuthContext } from '../security/auth-context.js';
import { CurrentAuth, RequireCapabilities } from '../security/decorators.js';
import { MenusService } from './menus.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);

@ApiTags('menus')
@Controller({ path: 'menus', version: '1' })
@RequireCapabilities('appearance.manage')
export class MenusController {
  constructor(private readonly menus: MenusService) {}

  @Get()
  @ApiOperation({ summary: "Menus and the active theme's menu locations" })
  @ApiOkResponse({ standardSchema: menusResponseSchema })
  list(@CurrentAuth() auth: AuthContext): Promise<MenusResponse> {
    return this.menus.list(auth.siteId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a menu' })
  @ZodBody(createMenuSchema)
  @ApiOkResponse({ standardSchema: menuDetailSchema })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createMenuSchema)) body: z.output<typeof createMenuSchema>,
    @Req() req: Request,
  ): Promise<MenuDetail> {
    return this.menus.create(auth, body, requestMeta(req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'A menu with its items and what they link to' })
  @ApiOkResponse({ standardSchema: menuDetailSchema })
  get(@CurrentAuth() auth: AuthContext, @Param('id', idPipe) id: string): Promise<MenuDetail> {
    return this.menus.get(auth.siteId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: "Replace a menu's name, location and items" })
  @ZodBody(saveMenuSchema)
  @ApiOkResponse({ standardSchema: menuDetailSchema })
  save(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(saveMenuSchema)) body: z.output<typeof saveMenuSchema>,
    @Req() req: Request,
  ): Promise<MenuDetail> {
    return this.menus.save(auth, id, body, requestMeta(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a menu' })
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.menus.delete(auth, id, requestMeta(req));
  }
}
