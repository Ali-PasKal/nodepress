import { Module } from '@nestjs/common';
import { SystemStateRepository } from './system-state.repository.js';
import { SystemController } from './system.controller.js';
import { SystemService } from './system.service.js';

@Module({
  controllers: [SystemController],
  providers: [SystemService, SystemStateRepository],
})
export class SystemModule {}
