import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  authUserSchema,
  changePasswordSchema,
  sessionResponseSchema,
  sessionSummarySchema,
  updateProfileSchema,
  uuidSchema,
  type AuthUser,
  type SessionResponse,
  type SessionSummary,
} from '@nexora/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../common/http/request-meta.js';
import { ZodBody } from '../../common/openapi/zod-body.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import type { AuthContext } from '../security/auth-context.js';
import { Authenticated, CurrentAuth } from '../security/decorators.js';
import { clearSessionCookie, setSessionCookie } from '../security/session-cookie.js';
import { AccountService } from './account.service.js';

@ApiTags('account')
@Controller({ path: 'account', version: '1' })
@Authenticated()
export class AccountController {
  constructor(
    private readonly account: AccountService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Own profile' })
  @ApiOkResponse({ standardSchema: authUserSchema })
  profile(@CurrentAuth() auth: AuthContext): Promise<AuthUser> {
    return this.account.profile(auth);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update own display name' })
  @ZodBody(updateProfileSchema)
  @ApiOkResponse({ standardSchema: authUserSchema })
  updateProfile(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: z.output<typeof updateProfileSchema>,
    @Req() req: Request,
  ): Promise<AuthUser> {
    return this.account.updateProfile(auth, body.displayName, requestMeta(req));
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change own password; signs out other sessions and rotates this one' })
  @ZodBody(changePasswordSchema)
  @ApiOkResponse({ standardSchema: sessionResponseSchema })
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: z.output<typeof changePasswordSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const result = await this.account.changePassword(
      auth,
      body.currentPassword,
      body.newPassword,
      requestMeta(req),
    );
    setSessionCookie(res, this.config.session.cookieSecure, result.token, result.expiresAt);
    return result.response;
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Own active sessions' })
  @ApiOkResponse({ standardSchema: z.array(sessionSummarySchema) })
  sessions(@CurrentAuth() auth: AuthContext): Promise<SessionSummary[]> {
    return this.account.listSessions(auth);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke one of own sessions' })
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.account.revokeSession(auth, id, requestMeta(req));
    if (id === auth.sessionId) {
      clearSessionCookie(res, this.config.session.cookieSecure);
    }
  }

  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign out all other sessions' })
  async revokeOthers(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<{ revoked: number }> {
    return { revoked: await this.account.revokeOtherSessions(auth, requestMeta(req)) };
  }
}
