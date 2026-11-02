import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  PluginProcess,
  SandboxUnavailableError,
  type HostCallHandler,
  type InvocationOutcome,
  type LogLine,
} from '@nexora/plugin-runtime';
import type { PluginManifest } from '@nexora/shared';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PluginCapabilities } from './plugin-capabilities.js';
import { PluginRegistry, type ActivePlugin } from './plugin-registry.js';

/** Crashes (or watchdog kills) within the window after which a plugin is marked as failed. */
const CRASH_LIMIT = 3;
const CRASH_WINDOW_MS = 10 * 60_000;
/** Log lines kept per plugin. */
const LOG_RETENTION = 200;
/** Sandboxes unused for this long are stopped (they start again on demand). */
const IDLE_MS = 10 * 60_000;

export interface RuntimeInvocation {
  readonly kind: 'shortcode' | 'hook';
  readonly name: string;
  readonly input: unknown;
  readonly timeoutMs: number;
}

interface Sandbox {
  readonly process: PluginProcess;
  readonly revision: string;
  lastUsed: number;
}

export class PluginsDisabledError extends Error {
  override readonly name = 'PluginsDisabledError';
  constructor() {
    super('Plugins are disabled on this server (PLUGINS_ENABLED=false).');
  }
}

/**
 * Owns the sandbox processes of active plugins in this API process: one per plugin, started on first use,
 * replaced when the plugin changes, stopped when idle or deactivated. Plugin code never runs anywhere else.
 */
@Injectable()
export class PluginRuntimeService implements OnModuleDestroy {
  private readonly logger = new Logger(PluginRuntimeService.name);
  private readonly sandboxes = new Map<string, Sandbox>();
  private readonly crashes = new Map<string, number[]>();
  private readonly idleTimer: NodeJS.Timeout;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly capabilities: PluginCapabilities,
    private readonly registry: PluginRegistry,
  ) {
    this.idleTimer = setInterval(() => {
      this.stopIdle();
    }, 60_000);
    this.idleTimer.unref();
  }

  get enabled(): boolean {
    return this.config.plugins.enabled;
  }

  /** Runs a shortcode or hook handler of an active plugin in its sandbox. */
  async invoke(plugin: ActivePlugin, invocation: RuntimeInvocation): Promise<InvocationOutcome> {
    if (!this.enabled) throw new PluginsDisabledError();
    const sandbox = this.sandboxFor(plugin);
    sandbox.lastUsed = Date.now();
    let outcome: InvocationOutcome;
    try {
      outcome = await sandbox.process.invoke(
        { ...invocation, settings: plugin.settings },
        this.capabilities.handler(plugin),
      );
    } catch (error) {
      if (error instanceof SandboxUnavailableError) {
        outcome = {
          result: { ok: false, error: { code: 'plugin_error', message: error.message } },
          logs: [],
        };
      } else {
        throw error;
      }
    }
    const lines: LogLine[] = [...outcome.logs];
    if (!outcome.result.ok) {
      lines.push({
        level: 'error',
        message: `${invocation.kind} "${invocation.name}" failed: ${outcome.result.error.message}`,
      });
    }
    void this.log(plugin.id, lines);
    return outcome;
  }

  /**
   * Loads candidate code in a throwaway sandbox and lists the handlers it exports; used before activation
   * and updates. Host calls are refused (there is nothing to call during loading).
   */
  async describe(
    code: string,
  ): Promise<{ ok: true; shortcodes: string[]; hooks: string[] } | { ok: false; message: string }> {
    if (!this.enabled) throw new PluginsDisabledError();
    const sandbox = new PluginProcess({
      code,
      limits: { memoryBytes: this.config.plugins.memoryBytes },
    });
    const refuse: HostCallHandler = () => Promise.reject(new Error('Not available while loading.'));
    try {
      const outcome = await sandbox.invoke(
        { kind: 'describe', name: '', input: null, settings: {}, timeoutMs: 2_000 },
        refuse,
      );
      if (!outcome.result.ok) return { ok: false, message: outcome.result.error.message };
      const value = outcome.result.value as { shortcodes?: unknown; hooks?: unknown } | null;
      const names = (list: unknown) =>
        Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
      return { ok: true, shortcodes: names(value?.shortcodes), hooks: names(value?.hooks) };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    } finally {
      sandbox.stop();
    }
  }

  /** Problems with candidate code: declared shortcodes and hooks it does not implement. */
  async check(manifest: PluginManifest, code: string): Promise<string | null> {
    const described = await this.describe(code);
    if (!described.ok) return `The plugin could not be loaded: ${described.message}`;
    const missing = [
      ...manifest.shortcodes
        .map((shortcode) => shortcode.name)
        .filter((name) => !described.shortcodes.includes(name))
        .map((name) => `shortcode "${name}"`),
      ...manifest.hooks
        .filter((hook) => !described.hooks.includes(hook))
        .map((hook) => `hook "${hook}"`),
    ];
    return missing.length > 0
      ? `The plugin declares handlers its code does not export: ${missing.join(', ')}.`
      : null;
  }

  /** Stops a plugin's sandbox (deactivation, uninstall, update). */
  stop(pluginId: string): void {
    const sandbox = this.sandboxes.get(pluginId);
    this.sandboxes.delete(pluginId);
    sandbox?.process.stop();
  }

  onModuleDestroy(): void {
    clearInterval(this.idleTimer);
    for (const id of [...this.sandboxes.keys()]) this.stop(id);
  }

  private sandboxFor(plugin: ActivePlugin): Sandbox {
    const existing = this.sandboxes.get(plugin.id);
    if (existing?.revision === plugin.revision) return existing;
    if (existing) this.stop(plugin.id);
    const sandbox: Sandbox = {
      revision: plugin.revision,
      lastUsed: Date.now(),
      process: new PluginProcess({
        code: plugin.code,
        limits: { memoryBytes: this.config.plugins.memoryBytes },
        onExit: (reason) => {
          void this.recordCrash(plugin, reason);
        },
      }),
    };
    this.sandboxes.set(plugin.id, sandbox);
    return sandbox;
  }

  private stopIdle(): void {
    const now = Date.now();
    for (const [id, sandbox] of this.sandboxes) {
      if (now - sandbox.lastUsed > IDLE_MS) this.stop(id);
    }
  }

  private async recordCrash(plugin: ActivePlugin, reason: string): Promise<void> {
    const now = Date.now();
    const recent = (this.crashes.get(plugin.id) ?? []).filter((at) => now - at < CRASH_WINDOW_MS);
    recent.push(now);
    this.crashes.set(plugin.id, recent);
    this.logger.warn({ plugin: plugin.key, reason }, 'Plugin sandbox exited');
    await this.log(plugin.id, [{ level: 'error', message: `The sandbox stopped: ${reason}` }]);
    if (recent.length < CRASH_LIMIT) return;
    this.crashes.delete(plugin.id);
    this.stop(plugin.id);
    const message = `Stopped after ${String(CRASH_LIMIT)} crashes in ${String(CRASH_WINDOW_MS / 60_000)} minutes. Last: ${reason}`;
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.plugin.updateMany({
          where: { id: plugin.id, status: 'active' },
          data: { status: 'failed', error: message.slice(0, 1_000) },
        });
        if (updated.count === 1) {
          await this.audit.record(tx, {
            action: 'plugin.failed',
            targetType: 'plugin',
            targetId: plugin.id,
            metadata: { plugin: plugin.key, version: plugin.version },
          });
        }
      });
      this.registry.invalidate();
    } catch (error) {
      this.logger.error({ err: error, plugin: plugin.key }, 'Could not mark the plugin as failed');
    }
  }

  async log(pluginId: string, lines: readonly LogLine[]): Promise<void> {
    if (lines.length === 0) return;
    try {
      await this.prisma.pluginLog.createMany({
        data: lines.map((line) => ({
          pluginId,
          level: line.level,
          message: line.message.slice(0, 1_000),
        })),
      });
      await this.prisma.$executeRaw`
        DELETE FROM plugin_logs
         WHERE plugin_id = ${pluginId}::uuid
           AND id NOT IN (SELECT id FROM plugin_logs WHERE plugin_id = ${pluginId}::uuid
                          ORDER BY created_at DESC, id DESC LIMIT ${LOG_RETENTION}::integer)`;
    } catch (error) {
      // The plugin may have been uninstalled meanwhile; logs are best effort.
      this.logger.debug({ err: error, pluginId }, 'Plugin log lines were not written');
    }
  }
}
