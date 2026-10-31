import {
  Body,
  Controller,
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
  createUserSchema,
  sessionSummarySchema,
  setUserPasswordSchema,
  updateUserSchema,
  userListQuerySchema,
  userListResponseSchema,
  userSummarySchema,
  uuidSchema,
  type CreateUserRequest,
  type SessionSummary,
  type UserListResponse,
  type UserSummary,
} from '@nexora/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../common/http/request-meta.js';
import { ZodBody } from '../../common/openapi/zod-body.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { AuthContext } from '../security/auth-context.js';
import { CurrentAuth, RequireCapabilities } from '../security/decorators.js';
import { UsersService } from './users.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);

@ApiTags('users')
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequireCapabilities('users.read')
  @ApiOperation({ summary: 'List users (search, filter, paginate)' })
  @ApiOkResponse({ standardSchema: userListResponseSchema })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(userListQuerySchema)) query: z.output<typeof userListQuerySchema>,
  ): Promise<UserListResponse> {
    return this.users.list(auth.siteId, query);
  }

  @Post()
  @RequireCapabilities('users.create')
  @ApiOperation({ summary: 'Create a user with an initial password and role' })
  @ZodBody(createUserSchema)
  @ApiOkResponse({ standardSchema: userSummarySchema })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserRequest,
    @Req() req: Request,
  ): Promise<UserSummary> {
    return this.users.create(auth, body, requestMeta(req));
  }

  @Get(':id')
  @RequireCapabilities('users.read')
  @ApiOperation({ summary: 'Get a user' })
  @ApiOkResponse({ standardSchema: userSummarySchema })
  get(@CurrentAuth() auth: AuthContext, @Param('id', idPipe) id: string): Promise<UserSummary> {
    return this.users.get(auth.siteId, id);
  }

  @Patch(':id')
  @RequireCapabilities('users.update')
  @ApiOperation({
    summary: 'Update display name, status or role (role changes also need users.assign_roles)',
  })
  @ZodBody(updateUserSchema)
  @ApiOkResponse({ standardSchema: userSummarySchema })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: z.output<typeof updateUserSchema>,
    @Req() req: Request,
  ): Promise<UserSummary> {
    return this.users.update(auth, id, body, requestMeta(req));
  }

  @Post(':id/password')
  @RequireCapabilities('users.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Set another user's password; signs them out everywhere" })
  @ZodBody(setUserPasswordSchema)
  async setPassword(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(setUserPasswordSchema))
    body: z.output<typeof setUserPasswordSchema>,
    @Req() req: Request,
  ): Promise<void> {
    await this.users.setPassword(auth, id, body.password, requestMeta(req));
  }

  @Get(':id/sessions')
  @RequireCapabilities('sessions.manage')
  @ApiOperation({ summary: "List a user's active sessions" })
  @ApiOkResponse({ standardSchema: z.array(sessionSummarySchema) })
  sessions(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
  ): Promise<SessionSummary[]> {
    return this.users.listSessions(auth, id);
  }

  @Post(':id/sessions/revoke-all')
  @RequireCapabilities('sessions.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign a user out of every session' })
  async revokeSessions(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<{ revoked: number }> {
    return { revoked: await this.users.revokeSessions(auth, id, requestMeta(req)) };
  }
}
