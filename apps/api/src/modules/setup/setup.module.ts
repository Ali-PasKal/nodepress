import { Module } from '@nestjs/common';
import { SetupTokenService } from './setup-token.service.js';
import { SetupController } from './setup.controller.js';
import { SetupService } from './setup.service.js';

@Module({ controllers: [SetupController], providers: [SetupService, SetupTokenService] })
export class SetupModule {}
