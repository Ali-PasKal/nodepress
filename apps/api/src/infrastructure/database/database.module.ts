import { Global, Module } from '@nestjs/common';
import { MigrationStatusService } from './migration-status.service.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService, MigrationStatusService],
  exports: [PrismaService, MigrationStatusService],
})
export class DatabaseModule {}
