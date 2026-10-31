import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { SessionResponseBuilder } from './session-response.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordResetService, SessionResponseBuilder],
  exports: [SessionResponseBuilder],
})
export class AuthModule {}
