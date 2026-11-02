import { Injectable } from '@nestjs/common';
import {
  pluginManifestSchema,
  PLUGIN_PERMISSIONS,
  resolvePluginSettings,
  type PluginManifest,
  type PluginPermission,
  type PluginSettingValues,
} from '@nexora/shared';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

/** An active plugin as the runtime needs it. */
export interface ActivePlugin {
  /** Database id. */
  readonly id: string;
  readonly siteId: string;
  /** Manifest id ("acme.reading-time"). */
  readonly key: string;
  readonly name: string;
  readonly version: string;
  readonly manifest: PluginManifest;
  readonly code: string;
  readonly settings: PluginSettingValues;
  readonly grantedPermissions: readonly PluginPermission[];
  readonly grantedHosts: readonly string[];
  /** Changes whenever the stored plugin changes (code, settings, grants): sandboxes are restarted on change. */
  readonly revision: string;
}

export type PluginRow = Prisma.PluginGetPayload<object>;

export function manifestOf(row: Pick<PluginRow, 'manifest'>): PluginManifest {
  // Stored manifests were validated on install; parsing again applies defaults of newer schema versions.
  return pluginManifestSchema.parse(row.manifest);
}

export function grantedPermissionsOf(
  row: Pick<PluginRow, 'grantedPermissions'>,
): PluginPermission[] {
  return row.grantedPermissions.filter((permission): permission is PluginPermission =>
    (PLUGIN_PERMISSIONS as readonly string[]).includes(permission),
  );
}

export function toActivePlugin(row: PluginRow): ActivePlugin {
  const manifest = manifestOf(row);
  return {
    id: row.id,
    siteId: row.siteId,
    key: row.key,
    name: row.name,
    version: row.version,
    manifest,
    code: row.code,
    settings: resolvePluginSettings(manifest.settings, row.settings),
    grantedPermissions: grantedPermissionsOf(row),
    grantedHosts: row.grantedHosts,
    revision: `${row.version}:${row.updatedAt.toISOString()}`,
  };
}

const CACHE_MS = 5_000;

/**
 * Active plugins per site, cached briefly. Lifecycle changes in this process invalidate the cache at once;
 * other API processes pick them up within a few seconds.
 */
@Injectable()
export class PluginRegistry {
  private readonly cache = new Map<string, { at: number; plugins: Promise<ActivePlugin[]> }>();

  constructor(private readonly prisma: PrismaService) {}

  active(siteId: string): Promise<ActivePlugin[]> {
    const cached = this.cache.get(siteId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.plugins;
    const plugins = this.prisma.plugin
      .findMany({ where: { siteId, status: 'active' }, orderBy: { key: 'asc' } })
      .then((rows) => rows.map(toActivePlugin));
    this.cache.set(siteId, { at: Date.now(), plugins });
    plugins.catch(() => {
      this.cache.delete(siteId);
    });
    return plugins;
  }

  invalidate(): void {
    this.cache.clear();
  }
}
