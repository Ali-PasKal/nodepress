import { Injectable } from '@nestjs/common';
import {
  pluginContentQuerySchema,
  publicEntryPath,
  uuidSchema,
  type PluginContentItem,
} from '@nexora/shared';
import type { HostCallHandler } from '@nexora/plugin-runtime';
import { z } from 'zod';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { publicEntryWhere } from '../delivery/public-content.js';
import type { ActivePlugin } from './plugin-registry.js';
import { SafeFetch, SafeFetchError } from './safe-fetch.js';

/** Per-plugin storage quota. */
export const STORAGE_LIMITS = {
  maxKeys: 1_000,
  maxValueBytes: 16 * 1024,
  maxTotalBytes: 1024 * 1024,
};
/** Outbound requests per plugin per minute (per API process). */
const HTTP_PER_MINUTE = 60;

export class CapabilityError extends Error {
  override readonly name = 'CapabilityError';
}

const storageKey = z.string().min(1).max(200);
const fetchInit = z.strictObject({
  method: z.string().max(10).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CapabilityError(`Invalid ${what}.`);
  return result.data;
}

const contentSelect = {
  id: true,
  title: true,
  path: true,
  excerpt: true,
  publishedAt: true,
  createdAt: true,
  contentType: { select: { key: true, routePrefix: true } },
  terms: {
    select: { term: { select: { name: true, slug: true, taxonomy: { select: { key: true } } } } },
  },
} satisfies Prisma.EntrySelect;
type ContentRow = Prisma.EntryGetPayload<{ select: typeof contentSelect }>;

function toContentItem(row: ContentRow): PluginContentItem {
  return {
    id: row.id,
    type: row.contentType.key,
    title: row.title,
    url: publicEntryPath(row.contentType.routePrefix, row.path),
    excerpt: row.excerpt,
    publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
    terms: row.terms.map(({ term }) => ({
      taxonomy: term.taxonomy.key,
      slug: term.slug,
      name: term.name,
    })),
  };
}

/**
 * What the core does for a plugin when its sandboxed code calls `ctx.storage`, `ctx.content` or `ctx.http`.
 * Every call is checked against the permissions an administrator granted; arguments are validated; quotas and
 * rate limits apply. The plugin never gets a database handle, a socket or a credential.
 */
@Injectable()
export class PluginCapabilities {
  private readonly requests = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly safeFetch: SafeFetch,
  ) {}

  handler(plugin: ActivePlugin): HostCallHandler {
    return async (method, args) => {
      switch (method) {
        case 'storage.get':
          return this.storageGet(plugin, parse(storageKey, args[0], 'key'));
        case 'storage.set':
          return this.storageSet(plugin, parse(storageKey, args[0], 'key'), args[1]);
        case 'storage.delete':
          return this.storageDelete(plugin, parse(storageKey, args[0], 'key'));
        case 'content.list':
          this.require(plugin, 'content:read');
          return this.contentList(plugin, args[0]);
        case 'content.get':
          this.require(plugin, 'content:read');
          return this.contentGet(plugin, args[0]);
        case 'http.fetch':
          this.require(plugin, 'http:fetch');
          return this.httpFetch(plugin, args[0], args[1]);
        default:
          throw new CapabilityError(`Unknown method ${method}.`);
      }
    };
  }

  private require(plugin: ActivePlugin, permission: 'content:read' | 'http:fetch'): void {
    if (!plugin.grantedPermissions.includes(permission)) {
      throw new CapabilityError(`Permission denied: ${permission} was not granted.`);
    }
  }

  // ------------------------------------------------------------------------------ storage

  private async storageGet(plugin: ActivePlugin, key: string): Promise<unknown> {
    const row = await this.prisma.pluginStorage.findUnique({
      where: { pluginId_key: { pluginId: plugin.id, key } },
      select: { value: true },
    });
    return row?.value ?? null;
  }

  private async storageSet(plugin: ActivePlugin, key: string, value: unknown): Promise<null> {
    const json = JSON.stringify(value ?? null);
    const size = Buffer.byteLength(json);
    if (size > STORAGE_LIMITS.maxValueBytes) {
      throw new CapabilityError(
        `Values are limited to ${String(STORAGE_LIMITS.maxValueBytes / 1024)} KB.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.pluginStorage.findUnique({
        where: { pluginId_key: { pluginId: plugin.id, key } },
        select: { size: true },
      });
      const totals = await tx.pluginStorage.aggregate({
        where: { pluginId: plugin.id },
        _sum: { size: true },
        _count: true,
      });
      const keys = totals._count + (existing ? 0 : 1);
      const bytes = (totals._sum.size ?? 0) - (existing?.size ?? 0) + size;
      if (keys > STORAGE_LIMITS.maxKeys)
        throw new CapabilityError('The storage key limit is reached.');
      if (bytes > STORAGE_LIMITS.maxTotalBytes)
        throw new CapabilityError('The storage quota is full.');
      await tx.pluginStorage.upsert({
        where: { pluginId_key: { pluginId: plugin.id, key } },
        create: {
          pluginId: plugin.id,
          key,
          value: JSON.parse(json) as Prisma.InputJsonValue,
          size,
        },
        update: { value: JSON.parse(json) as Prisma.InputJsonValue, size },
      });
    });
    return null;
  }

  private async storageDelete(plugin: ActivePlugin, key: string): Promise<null> {
    await this.prisma.pluginStorage.deleteMany({ where: { pluginId: plugin.id, key } });
    return null;
  }

  // ------------------------------------------------------------------------------ content

  private async contentList(plugin: ActivePlugin, raw: unknown): Promise<PluginContentItem[]> {
    const query = parse(pluginContentQuerySchema, raw ?? {}, 'content query');
    const termFilters = (query.terms ?? []).flatMap((term) => {
      const [taxonomy, slug] = term.split(':', 2);
      return taxonomy && slug ? [{ term: { slug, taxonomy: { key: taxonomy } } }] : [];
    });
    const exclude = (query.exclude ?? []).filter((id) => uuidSchema.safeParse(id).success);
    const rows = await this.prisma.entry.findMany({
      where: {
        siteId: plugin.siteId,
        ...publicEntryWhere(new Date()),
        // Children of hierarchical types are left out (their ancestors would need checking too).
        OR: [{ parentId: null }, { contentType: { hierarchical: false } }],
        ...(query.type ? { contentType: { key: query.type, isPublic: true } } : {}),
        ...(termFilters.length > 0 ? { terms: { some: { OR: termFilters } } } : {}),
        ...(exclude.length > 0 ? { id: { notIn: exclude } } : {}),
      },
      select: contentSelect,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
    });
    return rows.map(toContentItem);
  }

  private async contentGet(plugin: ActivePlugin, raw: unknown): Promise<PluginContentItem | null> {
    const id = parse(uuidSchema, raw, 'id');
    const row = await this.prisma.entry.findFirst({
      where: {
        id,
        siteId: plugin.siteId,
        ...publicEntryWhere(new Date()),
        OR: [{ parentId: null }, { contentType: { hierarchical: false } }],
      },
      select: contentSelect,
    });
    return row ? toContentItem(row) : null;
  }

  // ------------------------------------------------------------------------------ http

  private async httpFetch(
    plugin: ActivePlugin,
    rawUrl: unknown,
    rawInit: unknown,
  ): Promise<unknown> {
    const url = parse(z.string().max(2_048), rawUrl, 'URL');
    const init = parse(fetchInit, rawInit ?? {}, 'request options');
    const now = Date.now();
    const recent = (this.requests.get(plugin.id) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= HTTP_PER_MINUTE) {
      throw new CapabilityError(`At most ${String(HTTP_PER_MINUTE)} requests per minute.`);
    }
    recent.push(now);
    this.requests.set(plugin.id, recent);
    try {
      return await this.safeFetch.fetch(
        {
          url,
          ...(init.method !== undefined ? { method: init.method } : {}),
          ...(init.headers !== undefined ? { headers: init.headers } : {}),
          ...(init.body !== undefined ? { body: init.body } : {}),
        },
        {
          allowedHosts: plugin.grantedHosts,
          userAgent: `NEXORA-Plugin/${plugin.key} (${plugin.version})`,
        },
      );
    } catch (error) {
      if (error instanceof SafeFetchError) throw new CapabilityError(error.message);
      throw error;
    }
  }
}
