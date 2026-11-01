import {
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiException } from '../../common/errors/api-exception.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { SiteService } from '../sites/site.service.js';
import type { AuthContext } from './auth-context.js';
import { AuthorizationService } from './authorization.service.js';
import { hasValidCsrfToken, isTrustedOrigin, isUnsafeMethod } from './csrf.js';
import { ACCESS_POLICY, type AccessPolicy } from './decorators.js';
import { readCookie, sessionCookieName } from './session-cookie.js';
import { SessionService } from './session.service.js';

/**
 * Global guard; secure by default:
 *   1. unsafe methods from untrusted origins are rejected (CSRF, even before authentication);
 *   2. the session cookie, if any, is resolved into `req.auth`;
 *   3. routes without an access policy are refused (fail closed);
 *   4. protected routes require a session, a valid CSRF token for unsafe methods, and every declared
 *      capability.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger(AccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly authorization: AuthorizationService,
    private readonly sites: SiteService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(ACCESS_POLICY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const unsafe = isUnsafeMethod(request.method);

    if (unsafe && !isTrustedOrigin(request, this.config.http.corsAllowedOrigins)) {
      throw new ApiException(403, 'CSRF_FAILED', 'Cross-site requests are not allowed.');
    }

    const auth = await this.resolveAuth(request);
    if (policy?.kind === 'public') {
      return true;
    }
    if (policy === undefined) {
      this.logger.error(
        { path: request.path, method: request.method },
        'Route has no access policy (@Public/@Authenticated/@RequireCapabilities); refusing',
      );
      throw new ApiException(
        403,
        'FORBIDDEN',
        'You do not have permission to perform this action.',
      );
    }
    if (!auth) {
      throw new ApiException(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    }
    if (unsafe && !hasValidCsrfToken(request, auth.sessionToken)) {
      throw new ApiException(
        403,
        'CSRF_FAILED',
        'The request could not be verified. Reload the page and try again.',
      );
    }
    const holdsAll = policy.capabilities.every((capability) => auth.capabilities.has(capability));
    const holdsAny =
      policy.anyOf === undefined ||
      policy.anyOf.some((capability) => auth.capabilities.has(capability));
    if (!holdsAll || !holdsAny) {
      throw new ApiException(
        403,
        'FORBIDDEN',
        'You do not have permission to perform this action.',
      );
    }
    return true;
  }

  private async resolveAuth(request: Request): Promise<AuthContext | null> {
    const token = readCookie(
      request.headers.cookie,
      sessionCookieName(this.config.session.cookieSecure),
    );
    if (!token) {
      return null;
    }
    const session = await this.sessions.authenticate(token);
    if (!session) {
      return null;
    }
    const siteId = await this.sites.getDefaultSiteId();
    if (!siteId) {
      return null;
    }
    const access = await this.authorization.effectiveAccess(session.userId, siteId);
    const auth: AuthContext = {
      userId: session.userId,
      sessionId: session.id,
      sessionToken: token,
      sessionExpiresAt: session.expiresAt,
      siteId,
      role: access.role,
      capabilities: access.capabilities,
    };
    request.auth = auth;
    return auth;
  }
}
