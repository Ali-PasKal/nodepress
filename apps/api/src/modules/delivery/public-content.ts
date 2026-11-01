import type { DbClient } from '../../infrastructure/database/db-client.js';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * The one definition of "publicly visible" used by every public read: published, not in the trash,
 * publication time reached, and the content type is public. Hierarchical entries additionally need every
 * ancestor to be visible (see `filterVisibleAncestors`).
 */
export function publicEntryWhere(now: Date): Prisma.EntryWhereInput {
  return {
    status: 'published',
    trashedAt: null,
    publishedAt: { lte: now },
    contentType: { isPublic: true },
  };
}

/** Paths of the ancestors of an entry path ("a/b/c" → ["a", "a/b"]). Parents share the content type. */
export function ancestorPaths(path: string): string[] {
  const parts = path.split('/');
  const result: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    result.push(parts.slice(0, index).join('/'));
  }
  return result;
}

/** Keeps the entries whose ancestors are all publicly visible (one query for any number of entries). */
export async function filterVisibleAncestors<T extends { contentTypeId: string; path: string }>(
  db: DbClient,
  siteId: string,
  entries: readonly T[],
  now: Date,
): Promise<T[]> {
  const needed = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const path of ancestorPaths(entry.path)) {
      const set = needed.get(entry.contentTypeId) ?? new Set<string>();
      set.add(path);
      needed.set(entry.contentTypeId, set);
    }
  }
  if (needed.size === 0) return [...entries];
  const visible = await db.entry.findMany({
    where: {
      siteId,
      ...publicEntryWhere(now),
      OR: [...needed].map(([contentTypeId, paths]) => ({
        contentTypeId,
        path: { in: [...paths] },
      })),
    },
    select: { contentTypeId: true, path: true },
  });
  const keys = new Set(visible.map((row) => `${row.contentTypeId}:${row.path}`));
  return entries.filter((entry) =>
    ancestorPaths(entry.path).every((path) => keys.has(`${entry.contentTypeId}:${path}`)),
  );
}
