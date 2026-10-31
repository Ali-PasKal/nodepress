import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

export interface InstallationRecord {
  readonly installedAt: Date | null;
}

/** Data access for the singleton `system_state` row. The only module allowed to touch that table. */
@Injectable()
export class SystemStateRepository {
  private static readonly SINGLETON_ID = 1;

  constructor(private readonly prisma: PrismaService) {}

  async findInstallation(): Promise<InstallationRecord | null> {
    return this.prisma.systemState.findUnique({
      where: { id: SystemStateRepository.SINGLETON_ID },
      select: { installedAt: true },
    });
  }
}
