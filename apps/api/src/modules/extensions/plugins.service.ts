import { Injectable } from '@nestjs/common';
import { PluginPackageError, readPluginPackage, type PluginPackage } from '@nexora/plugin-runtime';
import {
  buildPluginSettingsSchema,
  comparePluginVersions,
  maskPluginSettings,
  resolvePluginSettings,
  type ActivatePluginInput,
  type BundledPlugin,
  type PluginDetail,
  type PluginLog,
  type PluginManifest,
  type PluginShortcodesResponse,
  type PluginsResponse,
  type PluginSummary,
} from '@nexora/shared';
import { ApiException } from '../../common/errors/api-exception.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../security/auth-context.js';
import { BundledPlugins } from './bundled-plugins.js';
import {
  grantedPermissionsOf,
  manifestOf,
  PluginRegistry,
  type PluginRow,
} from './plugin-registry.js';
import { PluginRuntimeService, PluginsDisabledError } from './plugin-runtime.service.js';

const NOT_FOUND = () => new ApiException(404, 'NOT_FOUND', 'Plugin not found.');

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

function coversAll(granted: readonly string[], requested: readonly string[]): boolean {
  return requested.every((item) => granted.includes(item));
}

/**
 * Plugin lifecycle: install (upload or bundled) → activate (an administrator grants the requested permissions;
 * the code is loaded in the sandbox and checked first) ⇄ deactivate → uninstall. Updates keep the plugin
 * active only when they ask for nothing new. Every change is audited.
 */
@Injectable()
export class PluginsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registry: PluginRegistry,
    private readonly runtime: PluginRuntimeService,
    private readonly bundled: BundledPlugins,
  ) {}

  // ------------------------------------------------------------------------------ queries

  async list(siteId: string): Promise<PluginsResponse> {
    const rows = await this.prisma.plugin.findMany({ where: { siteId }, orderBy: { name: 'asc' } });
    const installed = new Map(rows.map((row) => [row.key, row.version]));
    const bundled: BundledPlugin[] = [...this.bundled.all().values()].map(({ manifest }) => ({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      permissions: manifest.permissions,
      hosts: manifest.hosts,
      installedVersion: installed.get(manifest.id) ?? null,
    }));
    return { plugins: rows.map((row) => this.toSummary(row)), bundled };
  }

  async detail(siteId: string, key: string): Promise<PluginDetail> {
    const row = await this.load(siteId, key);
    const manifest = manifestOf(row);
    return {
      ...this.toSummary(row),
      readme: row.readme,
      settingDefinitions: manifest.settings,
      settings: maskPluginSettings(
        manifest.settings,
        resolvePluginSettings(manifest.settings, row.settings),
      ),
      shortcodeDefinitions: manifest.shortcodes,
    };
  }

  async logs(siteId: string, key: string): Promise<PluginLog[]> {
    const row = await this.load(siteId, key);
    const logs = await this.prisma.pluginLog.findMany({
      where: { pluginId: row.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return logs.map((log) => ({
      id: log.id,
      level: log.level === 'warn' || log.level === 'error' ? log.level : 'info',
      message: log.message,
      createdAt: log.createdAt.toISOString(),
    }));
  }

  /** Shortcodes of active plugins (for editors). */
  async shortcodes(siteId: string): Promise<PluginShortcodesResponse> {
    const plugins = await this.registry.active(siteId);
    return {
      items: plugins.flatMap((plugin) =>
        plugin.manifest.shortcodes.map((shortcode) => ({
          ...shortcode,
          pluginId: plugin.key,
          pluginName: plugin.name,
        })),
      ),
    };
  }

  // ------------------------------------------------------------------------------ install and update

  async installUpload(
    auth: AuthContext,
    file: { buffer: Buffer } | undefined,
    meta: RequestMeta,
  ): Promise<PluginDetail> {
    if (!file)
      throw new ApiException(400, 'BAD_REQUEST', 'Choose a plugin package (.zip) to upload.');
    let plugin: PluginPackage;
    try {
      plugin = readPluginPackage(file.buffer);
    } catch (error) {
      if (error instanceof PluginPackageError) {
        throw new ApiException(422, 'VALIDATION_FAILED', error.message, error.issues);
      }
      throw error;
    }
    return this.install(auth, plugin, 'upload', meta);
  }

  async installBundled(auth: AuthContext, key: string, meta: RequestMeta): Promise<PluginDetail> {
    const plugin = this.bundled.get(key);
    if (!plugin) throw NOT_FOUND();
    return this.install(auth, plugin, 'bundled', meta);
  }

  private async install(
    auth: AuthContext,
    plugin: PluginPackage,
    source: 'upload' | 'bundled',
    meta: RequestMeta,
  ): Promise<PluginDetail> {
    const { manifest } = plugin;
    const existing = await this.prisma.plugin.findUnique({
      where: { siteId_key: { siteId: auth.siteId, key: manifest.id } },
    });
    if (existing && comparePluginVersions(manifest.version, existing.version) < 0) {
      throw new ApiException(
        409,
        'CONFLICT',
        `Version ${existing.version} is installed; ${manifest.version} is older. Uninstall it first to downgrade.`,
      );
    }
    // An active plugin stays active through an update only if the update asks for nothing new and its code
    // loads; otherwise it is deactivated and waits for an administrator.
    let staysActive = false;
    if (existing?.status === 'active') {
      const coversGrants =
        coversAll(grantedPermissionsOf(existing), manifest.permissions) &&
        coversAll(existing.grantedHosts, manifest.hosts);
      if (coversGrants && this.runtime.enabled) {
        const conflict = await this.shortcodeConflict(auth.siteId, manifest, existing.id);
        const problem = conflict ?? (await this.runtime.check(manifest, plugin.code));
        if (problem) throw new ApiException(422, 'VALIDATION_FAILED', problem);
        staysActive = true;
      }
    }
    const data = {
      name: manifest.name,
      version: manifest.version,
      manifest: manifest as unknown as Prisma.InputJsonValue,
      code: plugin.code,
      readme: plugin.readme,
      source,
      hooks: [...manifest.hooks],
    };
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.plugin.update({
            where: { id: existing.id },
            data: {
              ...data,
              status: staysActive ? 'active' : existing.status === 'failed' ? 'failed' : 'inactive',
              ...(staysActive ? {} : { activatedAt: null }),
              // Settings removed from the manifest are dropped; the rest keep their values.
              settings: this.keepSettings(manifest, existing.settings),
            },
          })
        : await tx.plugin.create({
            data: { ...data, key: manifest.id, siteId: auth.siteId, installedById: auth.userId },
          });
      await this.audit.record(tx, {
        action: existing ? 'plugin.updated' : 'plugin.installed',
        actorUserId: auth.userId,
        targetType: 'plugin',
        targetId: saved.id,
        request: meta,
        metadata: {
          plugin: manifest.id,
          version: manifest.version,
          source,
          ...(existing ? { from: existing.version, staysActive } : {}),
        },
      });
      return saved;
    });
    this.runtime.stop(row.id);
    this.registry.invalidate();
    return this.detail(auth.siteId, manifest.id);
  }

  private keepSettings(manifest: PluginManifest, stored: Prisma.JsonValue): Prisma.InputJsonValue {
    const source =
      stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    const kept: Record<string, Prisma.InputJsonValue | null> = {};
    for (const setting of manifest.settings) {
      const value = (source as Record<string, Prisma.JsonValue>)[setting.key];
      if (value !== undefined) kept[setting.key] = value;
    }
    return kept;
  }

  // ------------------------------------------------------------------------------ activation

  async activate(
    auth: AuthContext,
    key: string,
    input: ActivatePluginInput,
    meta: RequestMeta,
  ): Promise<PluginDetail> {
    const row = await this.load(auth.siteId, key);
    if (row.status === 'active') {
      throw new ApiException(409, 'CONFLICT', 'The plugin is already active.');
    }
    const manifest = manifestOf(row);
    if (
      !sameSet(input.permissions, manifest.permissions) ||
      !sameSet(input.hosts, manifest.hosts)
    ) {
      throw new ApiException(
        409,
        'CONFLICT',
        'The plugin asks for different permissions now. Review them again before activating.',
      );
    }
    const conflict = await this.shortcodeConflict(auth.siteId, manifest, row.id);
    if (conflict) throw new ApiException(409, 'CONFLICT', conflict);
    let problem: string | null;
    try {
      problem = await this.runtime.check(manifest, row.code);
    } catch (error) {
      if (error instanceof PluginsDisabledError) {
        throw new ApiException(409, 'CONFLICT', error.message);
      }
      throw error;
    }
    if (problem) {
      await this.prisma.plugin.update({
        where: { id: row.id },
        data: { error: problem.slice(0, 1_000) },
      });
      throw new ApiException(422, 'VALIDATION_FAILED', problem);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.plugin.update({
        where: { id: row.id },
        data: {
          status: 'active',
          grantedPermissions: [...manifest.permissions],
          grantedHosts: [...manifest.hosts],
          error: null,
          activatedAt: new Date(),
        },
      });
      await this.audit.record(tx, {
        action: 'plugin.activated',
        actorUserId: auth.userId,
        targetType: 'plugin',
        targetId: row.id,
        request: meta,
        metadata: {
          plugin: key,
          version: row.version,
          permissions: [...manifest.permissions],
          hosts: [...manifest.hosts],
        },
      });
    });
    this.runtime.stop(row.id);
    this.registry.invalidate();
    return this.detail(auth.siteId, key);
  }

  async deactivate(auth: AuthContext, key: string, meta: RequestMeta): Promise<PluginDetail> {
    const row = await this.load(auth.siteId, key);
    if (row.status === 'inactive') {
      throw new ApiException(409, 'CONFLICT', 'The plugin is not active.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.plugin.update({
        where: { id: row.id },
        data: { status: 'inactive', activatedAt: null },
      });
      await this.audit.record(tx, {
        action: 'plugin.deactivated',
        actorUserId: auth.userId,
        targetType: 'plugin',
        targetId: row.id,
        request: meta,
        metadata: { plugin: key, version: row.version },
      });
    });
    this.runtime.stop(row.id);
    this.registry.invalidate();
    return this.detail(auth.siteId, key);
  }

  async updateSettings(
    auth: AuthContext,
    key: string,
    body: unknown,
    meta: RequestMeta,
  ): Promise<PluginDetail> {
    const row = await this.load(auth.siteId, key);
    const manifest = manifestOf(row);
    const parsed = buildPluginSettingsSchema(manifest.settings).safeParse(body);
    if (!parsed.success) {
      throw new ApiException(
        422,
        'VALIDATION_FAILED',
        'Some settings are invalid.',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    const current = resolvePluginSettings(manifest.settings, row.settings);
    const next = { ...current };
    for (const [name, value] of Object.entries(parsed.data)) {
      if (value !== undefined) next[name] = value;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.plugin.update({
        where: { id: row.id },
        data: { settings: next },
      });
      await this.audit.record(tx, {
        action: 'plugin.settings_updated',
        actorUserId: auth.userId,
        targetType: 'plugin',
        targetId: row.id,
        request: meta,
        // Keys only: values may be secrets.
        metadata: { plugin: key, settings: Object.keys(parsed.data).sort() },
      });
    });
    this.registry.invalidate();
    return this.detail(auth.siteId, key);
  }

  async uninstall(auth: AuthContext, key: string, meta: RequestMeta): Promise<void> {
    const row = await this.load(auth.siteId, key);
    if (row.status === 'active') {
      throw new ApiException(409, 'CONFLICT', 'Deactivate the plugin before uninstalling it.');
    }
    await this.prisma.$transaction(async (tx) => {
      // Storage and logs go with it (cascade).
      await tx.plugin.delete({ where: { id: row.id } });
      await this.audit.record(tx, {
        action: 'plugin.uninstalled',
        actorUserId: auth.userId,
        targetType: 'plugin',
        targetId: row.id,
        request: meta,
        metadata: { plugin: key, version: row.version },
      });
    });
    this.runtime.stop(row.id);
    this.registry.invalidate();
  }

  // ------------------------------------------------------------------------------ helpers

  private async load(siteId: string, key: string): Promise<PluginRow> {
    const row = await this.prisma.plugin.findUnique({ where: { siteId_key: { siteId, key } } });
    if (!row) throw NOT_FOUND();
    return row;
  }

  /** A shortcode name already offered by another active plugin. */
  private async shortcodeConflict(
    siteId: string,
    manifest: PluginManifest,
    ownId: string,
  ): Promise<string | null> {
    const others = (await this.registry.active(siteId)).filter((plugin) => plugin.id !== ownId);
    for (const shortcode of manifest.shortcodes) {
      const owner = others.find((plugin) =>
        plugin.manifest.shortcodes.some((other) => other.name === shortcode.name),
      );
      if (owner) {
        return `The shortcode [${shortcode.name}] is already provided by the active plugin "${owner.name}".`;
      }
    }
    return null;
  }

  private toSummary(row: PluginRow): PluginSummary {
    const manifest = manifestOf(row);
    const granted = grantedPermissionsOf(row);
    return {
      id: row.key,
      name: row.name,
      version: row.version,
      description: manifest.description,
      author: manifest.author,
      homepage: manifest.homepage ?? null,
      license: manifest.license ?? null,
      source: row.source === 'bundled' ? 'bundled' : 'upload',
      status: row.status === 'active' || row.status === 'failed' ? row.status : 'inactive',
      permissions: manifest.permissions,
      hosts: manifest.hosts,
      grantedPermissions: granted,
      grantedHosts: row.grantedHosts,
      needsApproval:
        !coversAll(granted, manifest.permissions) || !coversAll(row.grantedHosts, manifest.hosts),
      shortcodes: manifest.shortcodes.map((shortcode) => shortcode.name),
      hooks: manifest.hooks,
      hasSettings: manifest.settings.length > 0,
      error: row.error,
      installedAt: row.installedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      activatedAt: row.activatedAt?.toISOString() ?? null,
    };
  }
}
