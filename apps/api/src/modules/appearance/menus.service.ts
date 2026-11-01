import { Injectable } from '@nestjs/common';
import {
  publicEntryPath,
  publicTermPath,
  type createMenuSchema,
  type DeliveryMenuItem,
  type MenuDetail,
  type MenuItemInfo,
  type MenusResponse,
  type saveMenuSchema,
  type ThemeManifest,
} from '@nexora/shared';
import type { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { filterVisibleAncestors } from '../delivery/public-content.js';
import type { AuthContext } from '../security/auth-context.js';
import { SiteSettingsService } from './site-settings.service.js';

const itemInclude = {
  entry: {
    select: {
      id: true,
      title: true,
      path: true,
      status: true,
      trashedAt: true,
      publishedAt: true,
      contentTypeId: true,
      contentType: { select: { routePrefix: true, isPublic: true } },
    },
  },
  term: {
    select: {
      id: true,
      name: true,
      slug: true,
      taxonomy: { select: { routePrefix: true, isPublic: true } },
    },
  },
} satisfies Prisma.MenuItemInclude;
type ItemRow = Prisma.MenuItemGetPayload<{ include: typeof itemInclude }>;

type Target = MenuItemInfo['target'];

function invalid(path: string, message: string): ApiException {
  return new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
    { path, message },
  ]);
}

/** Navigation menus and their assignment to the active theme's menu locations. */
@Injectable()
export class MenusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SiteSettingsService,
  ) {}

  async list(siteId: string): Promise<MenusResponse> {
    const [state, menus] = await Promise.all([
      this.settings.state(),
      this.prisma.menu.findMany({
        where: { siteId },
        include: { _count: { select: { items: true } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      menus: menus.map((menu) => ({
        id: menu.id,
        name: menu.name,
        location: menu.location,
        itemCount: menu._count.items,
        updatedAt: menu.updatedAt.toISOString(),
      })),
      locations: state.theme.menuLocations.map((location) => ({
        key: location.key,
        label: location.label,
        menuId: menus.find((menu) => menu.location === location.key)?.id ?? null,
      })),
    };
  }

  async get(siteId: string, id: string): Promise<MenuDetail> {
    const menu = await this.prisma.menu.findFirst({
      where: { id, siteId },
      include: { items: { include: itemInclude, orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
    });
    if (!menu) {
      throw new ApiException(404, 'NOT_FOUND', 'Menu not found.');
    }
    const state = await this.settings.state();
    const targets = await this.resolveTargets(
      this.prisma,
      siteId,
      menu.items,
      new Date(),
      homepageId(state.reading.homepage),
    );
    return {
      id: menu.id,
      name: menu.name,
      location: menu.location,
      itemCount: menu.items.length,
      updatedAt: menu.updatedAt.toISOString(),
      items: sortTree(menu.items).map((item) => ({
        id: item.id,
        parentId: item.parentId,
        label: item.label,
        kind: item.kind as MenuItemInfo['kind'],
        entryId: item.entryId,
        termId: item.termId,
        url: item.url,
        openInNewTab: item.openInNewTab,
        target: targets.get(item.id) ?? { title: '', url: null, state: 'missing' },
      })),
    };
  }

  async create(
    actor: AuthContext,
    input: z.output<typeof createMenuSchema>,
    meta: RequestMeta,
  ): Promise<MenuDetail> {
    const theme = (await this.settings.state()).theme;
    this.assertLocation(theme, input.location);
    const id = await this.prisma.$transaction(async (tx) => {
      if (input.location !== null) {
        await tx.menu.updateMany({
          where: { siteId: actor.siteId, location: input.location },
          data: { location: null },
        });
      }
      const menu = await tx.menu.create({
        data: { siteId: actor.siteId, name: input.name, location: input.location },
        select: { id: true },
      });
      await this.audit.record(tx, {
        action: 'menu.created',
        actorUserId: actor.userId,
        targetType: 'menu',
        targetId: menu.id,
        request: meta,
        metadata: { name: input.name },
      });
      return menu.id;
    });
    return this.get(actor.siteId, id);
  }

  async save(
    actor: AuthContext,
    id: string,
    input: z.output<typeof saveMenuSchema>,
    meta: RequestMeta,
  ): Promise<MenuDetail> {
    await this.require(actor.siteId, id);
    const theme = (await this.settings.state()).theme;
    this.assertLocation(theme, input.location);
    const entryIds = [
      ...new Set(input.items.flatMap((item) => (item.entryId ? [item.entryId] : []))),
    ];
    const termIds = [...new Set(input.items.flatMap((item) => (item.termId ? [item.termId] : [])))];
    const [entries, terms] = await Promise.all([
      this.prisma.entry.count({ where: { siteId: actor.siteId, id: { in: entryIds } } }),
      this.prisma.term.count({ where: { siteId: actor.siteId, id: { in: termIds } } }),
    ]);
    if (entries !== entryIds.length) {
      throw invalid('items', 'One or more linked entries no longer exist.');
    }
    if (terms !== termIds.length) {
      throw invalid('items', 'One or more linked terms no longer exist.');
    }
    await this.prisma.$transaction(async (tx) => {
      if (input.location !== null) {
        await tx.menu.updateMany({
          where: { siteId: actor.siteId, location: input.location, NOT: { id } },
          data: { location: null },
        });
      }
      await tx.menu.update({ where: { id }, data: { name: input.name, location: input.location } });
      await tx.menuItem.deleteMany({ where: { menuId: id } });
      const ids = new Map<string, string>();
      const positions = new Map<string | null, number>();
      for (const item of input.items) {
        const parentId = item.parentKey === null ? null : (ids.get(item.parentKey) ?? null);
        const position = positions.get(parentId) ?? 0;
        positions.set(parentId, position + 1);
        const created = await tx.menuItem.create({
          data: {
            menuId: id,
            parentId,
            position,
            label: item.label,
            kind: item.kind,
            entryId: item.entryId,
            termId: item.termId,
            url: item.url,
            openInNewTab: item.openInNewTab,
          },
          select: { id: true },
        });
        ids.set(item.key, created.id);
      }
      await this.audit.record(tx, {
        action: 'menu.updated',
        actorUserId: actor.userId,
        targetType: 'menu',
        targetId: id,
        request: meta,
        metadata: { name: input.name, items: input.items.length, location: input.location },
      });
    });
    return this.get(actor.siteId, id);
  }

  async delete(actor: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const menu = await this.require(actor.siteId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.menu.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'menu.deleted',
        actorUserId: actor.userId,
        targetType: 'menu',
        targetId: id,
        request: meta,
        metadata: { name: menu.name },
      });
    });
  }

  /**
   * Menus of the theme's locations as the public site shows them: items whose target is not publicly
   * visible are left out together with their sub-items.
   */
  async deliveryMenus(
    db: DbClient,
    siteId: string,
    theme: ThemeManifest,
    homepageEntryId: string | null,
    now: Date,
  ): Promise<Record<string, DeliveryMenuItem[]>> {
    const locations = theme.menuLocations.map((location) => location.key);
    const menus = await db.menu.findMany({
      where: { siteId, location: { in: locations } },
      include: { items: { include: itemInclude, orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
    });
    const allItems = menus.flatMap((menu) => menu.items);
    const targets = await this.resolveTargets(db, siteId, allItems, now, homepageEntryId);
    const result: Record<string, DeliveryMenuItem[]> = {};
    for (const menu of menus) {
      if (menu.location === null) continue;
      const children = new Map<string | null, ItemRow[]>();
      for (const item of menu.items) {
        const list = children.get(item.parentId) ?? [];
        list.push(item);
        children.set(item.parentId, list);
      }
      const build = (parentId: string | null, depth: number): DeliveryMenuItem[] =>
        depth > 10
          ? []
          : (children.get(parentId) ?? []).flatMap((item) => {
              const target = targets.get(item.id);
              if (target?.state !== 'available' || target.url === null) return [];
              return [
                {
                  label: item.label !== '' ? item.label : target.title,
                  url: target.url,
                  openInNewTab: item.openInNewTab,
                  children: build(item.id, depth + 1),
                },
              ];
            });
      result[menu.location] = build(null, 0);
    }
    return result;
  }

  private async resolveTargets(
    db: DbClient,
    siteId: string,
    items: readonly ItemRow[],
    now: Date,
    homepageEntryId: string | null,
  ): Promise<Map<string, Target>> {
    const entries = items.flatMap((item) => (item.entry ? [item.entry] : []));
    const candidates = entries.filter(
      (entry) =>
        entry.status === 'published' &&
        entry.trashedAt === null &&
        entry.publishedAt !== null &&
        entry.publishedAt <= now &&
        entry.contentType.isPublic,
    );
    const visible = new Set(
      (await filterVisibleAncestors(db, siteId, candidates, now)).map((entry) => entry.id),
    );
    const targets = new Map<string, Target>();
    for (const item of items) {
      if (item.kind === 'home') {
        targets.set(item.id, { title: 'Home', url: '/', state: 'available' });
      } else if (item.kind === 'url') {
        targets.set(item.id, { title: item.url ?? '', url: item.url, state: 'available' });
      } else if (item.entry) {
        const entry = item.entry;
        const url =
          entry.id === homepageEntryId
            ? '/'
            : entry.contentType.isPublic
              ? publicEntryPath(entry.contentType.routePrefix, entry.path)
              : null;
        targets.set(item.id, {
          title: entry.title,
          url,
          state: visible.has(entry.id) ? 'available' : 'unpublished',
        });
      } else if (item.term) {
        const { taxonomy } = item.term;
        targets.set(item.id, {
          title: item.term.name,
          url: taxonomy.isPublic ? publicTermPath(taxonomy.routePrefix, item.term.slug) : null,
          state: taxonomy.isPublic ? 'available' : 'unpublished',
        });
      } else {
        targets.set(item.id, { title: '', url: null, state: 'missing' });
      }
    }
    return targets;
  }

  private assertLocation(theme: ThemeManifest, location: string | null): void {
    if (location !== null && !theme.menuLocations.some((item) => item.key === location)) {
      throw invalid('location', 'The active theme has no such menu location.');
    }
  }

  private async require(siteId: string, id: string): Promise<{ id: string; name: string }> {
    const menu = await this.prisma.menu.findFirst({
      where: { id, siteId },
      select: { id: true, name: true },
    });
    if (!menu) {
      throw new ApiException(404, 'NOT_FOUND', 'Menu not found.');
    }
    return menu;
  }
}

function homepageId(homepage: { mode: 'posts' } | { mode: 'page'; pageId: string }): string | null {
  return homepage.mode === 'page' ? homepage.pageId : null;
}

/** Depth-first order (parents before children, siblings by position), as the editor displays them. */
function sortTree<T extends { id: string; parentId: string | null; position: number }>(
  items: readonly T[],
): T[] {
  const children = new Map<string | null, T[]>();
  for (const item of items) {
    const list = children.get(item.parentId) ?? [];
    list.push(item);
    children.set(item.parentId, list);
  }
  const result: T[] = [];
  const visit = (parentId: string | null, depth: number): void => {
    if (depth > 10) return;
    for (const item of (children.get(parentId) ?? []).sort((a, b) => a.position - b.position)) {
      result.push(item);
      visit(item.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}
