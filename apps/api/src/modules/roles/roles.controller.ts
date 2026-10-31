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
  createRoleSchema,
  roleListResponseSchema,
  roleSchema,
  updateRoleSchema,
  uuidSchema,
  type RoleInfo,
  type RoleListResponse,
} from '@nexora/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { requestMeta } from '../../common/http/request-meta.js';
import { ZodBody } from '../../common/openapi/zod-body.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { AuthContext } from '../security/auth-context.js';
import { CurrentAuth, RequireCapabilities } from '../security/decorators.js';
import { RolesService } from './roles.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);

@ApiTags('roles')
@Controller({ path: 'roles', version: '1' })
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequireCapabilities('roles.read')
  @ApiOperation({ summary: 'List roles and the capability registry' })
  @ApiOkResponse({ standardSchema: roleListResponseSchema })
  list(): Promise<RoleListResponse> {
    return this.roles.list();
  }

  @Post()
  @RequireCapabilities('roles.manage')
  @ApiOperation({ summary: 'Create a custom role' })
  @ZodBody(createRoleSchema)
  @ApiOkResponse({ standardSchema: roleSchema })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createRoleSchema)) body: z.output<typeof createRoleSchema>,
    @Req() req: Request,
  ): Promise<RoleInfo> {
    return this.roles.create(auth, body, requestMeta(req));
  }

  @Patch(':id')
  @RequireCapabilities('roles.manage')
  @ApiOperation({ summary: 'Update a role (built-in roles: capabilities and description only)' })
  @ZodBody(updateRoleSchema)
  @ApiOkResponse({ standardSchema: roleSchema })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: z.output<typeof updateRoleSchema>,
    @Req() req: Request,
  ): Promise<RoleInfo> {
    return this.roles.update(auth, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequireCapabilities('roles.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a custom role that no user holds' })
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.roles.delete(auth, id, requestMeta(req));
  }
}
