import { Module } from '@nestjs/common';
import { RedirectsController } from './redirects.controller.js';
import { RedirectsService } from './redirects.service.js';

@Module({
  controllers: [RedirectsController],
  providers: [RedirectsService],
  exports: [RedirectsService],
})
export class RedirectsModule {}
