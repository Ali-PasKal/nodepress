import { Inject, Injectable } from '@nestjs/common';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { PrismaService } from './prisma.service.js';

export interface MigrationStatus {
  /** Migrations shipped with this build that are not applied to the database. */
  readonly pending: number;
  /** Migrations recorded as started but never finished (requires manual resolution). */
  readonly failed: number;
  readonly applied: number;
}

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

/** Prisma migration folders are named `<14-digit timestamp>_<name>`. */
const MIGRATION_DIR_PATTERN = /^\d{14}_[A-Za-z0-9_]+$/;

/**
 * Compares the migrations shipped with this build against Prisma's `_prisma_migrations` table, so
 * readiness fails when the code expects a schema the database does not have yet.
 */
@Injectable()
export class MigrationStatusService {
  private shippedMigrations: Promise<readonly string[]> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async getStatus(): Promise<MigrationStatus> {
    const shipped = await this.listShippedMigrations();
    const rows = await this.readAppliedMigrations();

    const applied = new Set(
      rows
        .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
        .map((row) => row.migration_name),
    );
    const failed = rows.filter(
      (row) => row.finished_at === null && row.rolled_back_at === null,
    ).length;
    const pending = shipped.filter((name) => !applied.has(name)).length;
    return { pending, failed, applied: applied.size };
  }

  /** Reads the migration directory once; its contents cannot change while the process runs. */
  listShippedMigrations(): Promise<readonly string[]> {
    this.shippedMigrations ??= this.scanMigrationsDirectory().catch((error: unknown) => {
      // Do not cache failures (e.g. a transiently unavailable volume); retry on the next check.
      this.shippedMigrations = null;
      throw error;
    });
    return this.shippedMigrations;
  }

  private async scanMigrationsDirectory(): Promise<readonly string[]> {
    const directory = this.config.database.migrationsDir;
    const entries = await readdir(directory, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !MIGRATION_DIR_PATTERN.test(entry.name)) {
        continue;
      }
      const sqlFile = await stat(join(directory, entry.name, 'migration.sql')).catch(() => null);
      if (sqlFile?.isFile()) {
        names.push(entry.name);
      }
    }
    return names.sort();
  }

  private async readAppliedMigrations(): Promise<MigrationRow[]> {
    // to_regclass respects search_path and returns NULL instead of raising when the table is absent
    // (e.g. a brand-new database where no migration has run yet).
    const [table] = await this.prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT to_regclass('_prisma_migrations') IS NOT NULL AS "exists"
    `;
    if (!table?.exists) {
      return [];
    }
    return this.prisma.$queryRaw<MigrationRow[]>`
      SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
    `;
  }
}
