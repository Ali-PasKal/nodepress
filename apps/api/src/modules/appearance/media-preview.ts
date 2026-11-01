import type { DbClient } from '../../infrastructure/database/db-client.js';
import type { MediaUrls, StoredVariant } from '../media/media-urls.js';

export interface MediaPreview {
  id: string;
  url: string;
  thumbnailUrl: string;
  altText: string;
}

/** Small previews of images for settings screens, keyed by id (unknown ids are left out). */
export async function mediaPreviews(
  db: DbClient,
  urls: MediaUrls,
  siteId: string,
  ids: readonly string[],
): Promise<Map<string, MediaPreview>> {
  if (ids.length === 0) return new Map();
  const rows = await db.media.findMany({
    where: { siteId, id: { in: [...new Set(ids)] } },
    select: { id: true, storageKey: true, variants: true, altText: true },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        url: urls.url(row.storageKey),
        thumbnailUrl: urls.bestUrl(row.storageKey, row.variants as unknown as StoredVariant[], 320),
        altText: row.altText,
      },
    ]),
  );
}

/** Ids among `ids` that are images of the site. */
export async function existingImageIds(
  db: DbClient,
  siteId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.media.findMany({
    where: { siteId, id: { in: [...new Set(ids)] }, mimeType: { startsWith: 'image/' } },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}
