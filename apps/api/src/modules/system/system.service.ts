import { Injectable } from '@nestjs/common';
import type { SystemStatusResponse } from '@nexora/shared';
import { SystemStateRepository } from './system-state.repository.js';

@Injectable()
export class SystemService {
  constructor(private readonly repository: SystemStateRepository) {}

  /** An instance is installed once the setup wizard has recorded `installed_at`. */
  async getStatus(): Promise<SystemStatusResponse> {
    const record = await this.repository.findInstallation();
    return { installed: (record?.installedAt ?? null) !== null };
  }
}
