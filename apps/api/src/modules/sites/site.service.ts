import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api-exception.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

export const DEFAULT_SITE_KEY = 'default';

export interface SiteRecord {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
}

/** Resolves the current site. Single-site today; a request-scoped resolver replaces this for multi-site. */
@Injectable()
export class SiteService {
  private defaultSiteId: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async findDefault(db: DbClient = this.prisma): Promise<SiteRecord | null> {
    const site = await db.site.findUnique({
      where: { key: DEFAULT_SITE_KEY },
      select: { id: true, name: true, baseUrl: true },
    });
    if (site) {
      this.defaultSiteId = site.id;
    }
    return site;
  }

  /** Id of the default site (immutable once created, so it is cached). */
  async getDefaultSiteId(): Promise<string | null> {
    if (this.defaultSiteId) {
      return this.defaultSiteId;
    }
    return (await this.findDefault())?.id ?? null;
  }

  async requireDefault(db: DbClient = this.prisma): Promise<SiteRecord> {
    const site = await this.findDefault(db);
    if (!site) {
      throw new ApiException(409, 'CONFLICT', 'This instance has not been set up yet.');
    }
    return site;
  }
}
