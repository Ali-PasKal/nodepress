import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessGuard } from './access.guard.js';
import { AuthorizationService } from './authorization.service.js';
import { PasswordHasher } from './password-hasher.service.js';
import { RateLimiter } from './rate-limiter.service.js';
import { SessionService } from './session.service.js';

@Global()
@Module({
  providers: [
    AuthorizationService,
    PasswordHasher,
    RateLimiter,
    SessionService,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [AuthorizationService, PasswordHasher, RateLimiter, SessionService],
})
export class SecurityModule {}
