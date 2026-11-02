import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { pluginEntryEventSchema, publicEntryPath, type PluginEntryEvent } from '@nexora/shared';
import { z } from 'zod';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { defineJob, PermanentJobError } from '../jobs/job-definition.js';
import { JobQueue } from '../jobs/job-queue.service.js';
import { JobRegistry } from '../jobs/job-registry.service.js';
import { toActivePlugin } from './plugin-registry.js';
import { PluginRuntimeService } from './plugin-runtime.service.js';

export const PluginEventJob = defineJob(
  'plugins.event',
  z.object({ pluginId: z.uuid(), event: pluginEntryEventSchema }),
);

/** Public facts about an entry whose publication state changed. */
export interface EntryEventSource {
  readonly id: string;
  readonly siteId: string;
  readonly title: string;
  readonly path: string;
  readonly excerpt: string;
  readonly publishedAt: Date | null;
  readonly type: { readonly key: string; readonly routePrefix: string; readonly isPublic: boolean };
}

const HOOK_TIMEOUT_MS = 10_000;

/**
 * Delivers `entry.published` / `entry.unpublished` to subscribed plugins through the job queue. Events are
 * enqueued in the transaction of the change (so they exist if and only if the change commits) and run later
 * in the worker, at least once, with retries — publishing never waits for, or fails because of, a plugin.
 */
@Injectable()
export class PluginEventsService implements OnModuleInit {
  private readonly logger = new Logger(PluginEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
    private readonly registry: JobRegistry,
    private readonly runtime: PluginRuntimeService,
  ) {}

  onModuleInit(): void {
    this.registry.register(PluginEventJob, (payload) => this.deliver(payload), {
      maxAttempts: 3,
      timeoutMs: HOOK_TIMEOUT_MS + 5_000,
    });
  }

  /** Call inside the transaction that changes an entry's status (or trashes/restores it). */
  async statusChanged(
    db: DbClient,
    entry: EntryEventSource,
    wasPublic: boolean,
    isPublic: boolean,
  ): Promise<void> {
    if (wasPublic === isPublic || !entry.type.isPublic || !this.runtime.enabled) return;
    const event: PluginEntryEvent = {
      event: isPublic ? 'entry.published' : 'entry.unpublished',
      entry: {
        id: entry.id,
        type: entry.type.key,
        title: entry.title,
        url: publicEntryPath(entry.type.routePrefix, entry.path),
        excerpt: entry.excerpt.slice(0, 1_000),
        publishedAt: entry.publishedAt?.toISOString() ?? null,
      },
      occurredAt: new Date().toISOString(),
    };
    const subscribers = await db.plugin.findMany({
      where: { siteId: entry.siteId, status: 'active', hooks: { has: event.event } },
      select: { id: true },
    });
    for (const subscriber of subscribers) {
      await this.queue.enqueue(db, PluginEventJob, { pluginId: subscriber.id, event });
    }
  }

  private async deliver(payload: z.output<typeof PluginEventJob.schema>): Promise<void> {
    if (!this.runtime.enabled) return;
    const row = await this.prisma.plugin.findUnique({ where: { id: payload.pluginId } });
    // Deactivated or uninstalled since: the event is dropped.
    if (row?.status !== 'active') return;
    const plugin = toActivePlugin(row);
    if (!plugin.manifest.hooks.includes(payload.event.event)) return;
    const outcome = await this.runtime.invoke(plugin, {
      kind: 'hook',
      name: payload.event.event,
      input: payload.event,
      timeoutMs: HOOK_TIMEOUT_MS,
    });
    if (!outcome.result.ok) {
      const { code, message } = outcome.result.error;
      this.logger.warn(
        { plugin: plugin.key, event: payload.event.event, code },
        'Plugin hook failed',
      );
      // A plugin that throws or times out may succeed later (e.g. a remote service was down): retry.
      if (code === 'invalid_result') throw new PermanentJobError(message);
      throw new Error(`${plugin.key}: ${message}`);
    }
  }
}
