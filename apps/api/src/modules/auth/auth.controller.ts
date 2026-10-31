import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  loginRequestSchema,
  messageResponseSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  sessionResponseSchema,
  type LoginRequest,
  type SessionResponse,
} from '@nexora/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requestMeta } from '../../common/http/request-meta.js';
import { ZodBody } from '../../common/openapi/zod-body.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import type { AuthContext } from '../security/auth-context.js';
import { Authenticated, CurrentAuth, Public } from '../security/decorators.js';
import {
  clearSessionCookie,
  readCookie,
  sessionCookieName,
  setSessionCookie,
} from '../security/session-cookie.js';
import { AuthService } from './auth.service.js';
import { PasswordResetService } from './password-reset.service.js';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password; sets the session cookie' })
  @ZodBody(loginRequestSchema)
  @ApiOkResponse({ standardSchema: sessionResponseSchema })
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const secure = this.config.session.cookieSecure;
    const presented = readCookie(req.headers.cookie, sessionCookieName(secure));
    const result = await this.auth.login(body, requestMeta(req), presented);
    setSessionCookie(res, secure, result.token, result.expiresAt);
    return result.response;
  }

  @Post('logout')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out: revokes the current session and clears the cookie' })
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(auth, requestMeta(req));
    clearSessionCookie(res, this.config.session.cookieSecure);
  }

  @Get('session')
  @Public()
  @ApiOperation({
    summary: 'Current session, capabilities and CSRF token (or authenticated: false)',
  })
  @ApiOkResponse({ standardSchema: sessionResponseSchema })
  session(@Req() req: Request): Promise<SessionResponse> | SessionResponse {
    return this.auth.currentSession(req.auth);
  }

  @Post('password-reset/request')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request a password reset email (same response whether or not the account exists)',
  })
  @ZodBody(passwordResetRequestSchema)
  @ApiOkResponse({ standardSchema: messageResponseSchema })
  async requestReset(
    @Body(new ZodValidationPipe(passwordResetRequestSchema))
    body: z.output<typeof passwordResetRequestSchema>,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.passwordReset.request(body.email, requestMeta(req));
    return { message: 'If an account exists for that email address, a reset link has been sent.' };
  }

  @Post('password-reset/confirm')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password with a reset token; signs out all sessions' })
  @ZodBody(passwordResetConfirmSchema)
  async confirmReset(
    @Body(new ZodValidationPipe(passwordResetConfirmSchema))
    body: z.output<typeof passwordResetConfirmSchema>,
    @Req() req: Request,
  ): Promise<void> {
    await this.passwordReset.confirm(body.token, body.password, requestMeta(req));
  }
}
