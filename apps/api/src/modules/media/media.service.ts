import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type {
  MediaDetail,
  MediaItem,
  MediaLimits,
  MediaListResponse,
  mediaListQuerySchema,
  updateMediaSchema,
} from '@nexora/shared';
import { fileTypeFromBuffer } from 'file-type';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api-exception.js';
import { RateLimitedException } from '../../common/errors/rate-limited.exception.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { defineJob, PermanentJobError } from '../jobs/job-definition.js';
import { JobQueue } from '../jobs/job-queue.service.js';
import { JobRegistry } from '../jobs/job-registry.service.js';
import type { AuthContext } from '../security/auth-context.js';
import { RATE_LIMITS, RateLimiter } from '../security/rate-limiter.service.js';
import {
  imageDimensions,
  resizeVariants,
  sanitizeImage,
  UnreadableImageError,
} from './image-processor.js';
import { MediaUrls, type StoredVariant } from './media-urls.js';
import {
  ACCEPTED_MEDIA,
  displayFilename,
  isAcceptedMime,
  kindOf,
  newStorageKey,
  variantKey,
} from './media-types.js';
import { STORAGE_DRIVER, type StorageDriver } from './storage/storage-driver.js';

export const ProcessImageJob = defineJob('media.process_image', z.object({ mediaId: z.uuid() }));
export const DeleteFilesJob = defineJob(
  'media.delete_files',
  z.object({ keys: z.array(z.string().max(500)).min(1).max(20) }),
);

export interface UploadedFile {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly size: number;
}

/** The given title, or the file name without its extension. */
function titleFor(requested: string | undefined, filename: string): string {
  const title = requested?.trim() ?? '';
  return (title === '' ? filename.replace(/\.[^.]*$/, '') : title).slice(0, 255);
}

const mediaInclude = {
  uploader: { select: { id: true, displayName: true } },
} satisfies Prisma.MediaInclude;
type MediaRow = Prisma.MediaGetPayload<{ include: typeof mediaInclude }>;

/**
 * Media library. Uploads are identified by content sniffing, raster images are re-encoded without
 * metadata, files get server-generated keys, and resized variants are produced by a background job.
 */
@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: JobQueue,
    private readonly registry: JobRegistry,
    private readonly limiter: RateLimiter,
    private readonly urls: MediaUrls,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.registry.register(ProcessImageJob, ({ mediaId }) => this.generateVariants(mediaId), {
      timeoutMs: 120_000,
    });
    this.registry.register(DeleteFilesJob, ({ keys }) => this.storage.delete(keys), {
      maxAttempts: 10,
    });
  }

  limits(): MediaLimits {
    return {
      maxUploadBytes: this.config.media.maxUploadBytes,
      acceptedTypes: Object.keys(ACCEPTED_MEDIA),
    };
  }

  async upload(
    auth: AuthContext,
    file: UploadedFile | undefined,
    fields: { title?: string | undefined; altText?: string | undefined },
    meta: RequestMeta,
  ): Promise<MediaDetail> {
    if (!file || file.size === 0) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
        { path: 'file', message: 'Choose a file to upload.' },
      ]);
    }
    const limit = await this.limiter.hit(
      'media-upload',
      auth.userId,
      RATE_LIMITS.mediaUploadPerUser,
    );
    if (!limit.allowed) {
      throw new RateLimitedException(limit.retryAfterSeconds);
    }

    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !isAcceptedMime(detected.mime)) {
      throw new ApiException(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'This file type is not supported. Upload JPEG, PNG, GIF, WebP or AVIF images, PDF documents, MP4 or WebM video, or MP3, OGG or WAV audio.',
      );
    }
    const mime = detected.mime;
    const info = ACCEPTED_MEDIA[mime];

    let stored = file.buffer;
    let width: number | null = null;
    let height: number | null = null;
    try {
      if (mime === 'image/gif') {
        ({ width, height } = await imageDimensions(file.buffer));
      } else if (info.raster) {
        const image = await sanitizeImage(
          file.buffer,
          mime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif',
        );
        stored = image.buffer;
        width = image.width;
        height = image.height;
      }
    } catch (error) {
      if (error instanceof UnreadableImageError) {
        throw new ApiException(422, 'VALIDATION_FAILED', 'The request contains invalid data.', [
          { path: 'file', message: 'The image could not be read. It may be damaged or too large.' },
        ]);
      }
      throw error;
    }

    const filename = displayFilename(file.originalname);
    const key = newStorageKey(filename, info.ext);
    await this.storage.put(key, stored, mime);
    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const media = await tx.media.create({
          data: {
            siteId: auth.siteId,
            uploaderId: auth.userId,
            storageKey: key,
            filename,
            mimeType: mime,
            sizeBytes: stored.length,
            width,
            height,
            title: titleFor(fields.title, filename),
            altText: (fields.altText ?? '').trim().slice(0, 500),
            checksum: new Uint8Array(createHash('sha256').update(stored).digest()),
          },
          select: { id: true },
        });
        if (info.raster && width !== null && width > 320) {
          await this.queue.enqueue(tx, ProcessImageJob, { mediaId: media.id });
        }
        await this.audit.record(tx, {
          action: 'media.uploaded',
          actorUserId: auth.userId,
          targetType: 'media',
          targetId: media.id,
          request: meta,
          metadata: { mimeType: mime, sizeBytes: stored.length },
        });
        return media.id;
      });
    } catch (error) {
      // The row was not written: do not leave an orphaned file behind.
      await this.storage.delete([key]).catch((err: unknown) => {
        this.logger.warn({ err, key }, 'Could not remove file after a failed upload');
      });
      throw error;
    }
    return this.get(auth, id);
  }

  async list(
    auth: AuthContext,
    query: z.output<typeof mediaListQuerySchema>,
  ): Promise<MediaListResponse> {
    const kindFilter: Prisma.MediaWhereInput | undefined =
      query.kind === undefined
        ? undefined
        : query.kind === 'document'
          ? { mimeType: 'application/pdf' }
          : { mimeType: { startsWith: `${query.kind}/` } };
    const where: Prisma.MediaWhereInput = {
      siteId: auth.siteId,
      ...(query.mine ? { uploaderId: auth.userId } : {}),
      ...(kindFilter ?? {}),
      ...(query.search
        ? {
            OR: [
              { filename: { contains: query.search, mode: 'insensitive' } },
              { title: { contains: query.search, mode: 'insensitive' } },
              { altText: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.media.count({ where }),
      this.prisma.media.findMany({
        where,
        include: mediaInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => this.toItem(row, auth)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(auth: AuthContext, id: string): Promise<MediaDetail> {
    const row = await this.load(auth, id);
    const [usage] = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM entries
       WHERE site_id = ${auth.siteId}::uuid
         AND (featured_media_id = ${id}::uuid OR body::text LIKE ${`%${id}%`} OR fields::text LIKE ${`%${id}%`})`;
    return { ...this.toItem(row, auth), usageCount: usage?.count ?? 0 };
  }

  async update(
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateMediaSchema>,
  ): Promise<MediaDetail> {
    const row = await this.load(auth, id);
    if (!this.canManage(auth, row)) {
      throw new ApiException(
        403,
        'FORBIDDEN',
        'You do not have permission to perform this action.',
      );
    }
    await this.prisma.media.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.altText !== undefined ? { altText: input.altText } : {}),
        ...(input.caption !== undefined ? { caption: input.caption } : {}),
      },
    });
    return this.get(auth, id);
  }

  /** Removes the record now (entries lose it as featured image) and the files through a durable job. */
  async delete(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const row = await this.load(auth, id);
    if (!this.canManage(auth, row)) {
      throw new ApiException(
        403,
        'FORBIDDEN',
        'You do not have permission to perform this action.',
      );
    }
    const keys = [row.storageKey, ...this.variantsOf(row).map((variant) => variant.key)];
    await this.prisma.$transaction(async (tx) => {
      await tx.media.delete({ where: { id } });
      await this.queue.enqueue(tx, DeleteFilesJob, { keys });
      await this.audit.record(tx, {
        action: 'media.deleted',
        actorUserId: auth.userId,
        targetType: 'media',
        targetId: id,
        request: meta,
        metadata: { filename: row.filename.slice(0, 200) },
      });
    });
  }

  /** Job handler: responsive WebP variants for a raster image. Idempotent (keys are overwritten). */
  private async generateVariants(mediaId: string): Promise<void> {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { storageKey: true, width: true },
    });
    if (!media) {
      return; // Deleted meanwhile.
    }
    if (media.width === null) {
      throw new PermanentJobError('Media has no dimensions');
    }
    const original = await this.storage.readBuffer(media.storageKey);
    if (!original) {
      throw new PermanentJobError('Original file is missing from storage');
    }
    const variants: StoredVariant[] = [];
    for (const { width, image } of await resizeVariants(original, media.width)) {
      const key = variantKey(media.storageKey, width);
      await this.storage.put(key, image.buffer, 'image/webp');
      variants.push({
        width: image.width,
        height: image.height,
        key,
        mimeType: 'image/webp',
        sizeBytes: image.buffer.length,
      });
    }
    const updated = await this.prisma.media.updateMany({
      where: { id: mediaId },
      data: { variants: variants as unknown as Prisma.InputJsonValue },
    });
    if (updated.count === 0) {
      // Deleted while we were resizing: clean up what we just wrote.
      await this.storage.delete(variants.map((variant) => variant.key));
    }
  }

  private async load(auth: AuthContext, id: string): Promise<MediaRow> {
    const row = await this.prisma.media.findFirst({
      where: { id, siteId: auth.siteId },
      include: mediaInclude,
    });
    if (!row) {
      throw new ApiException(404, 'NOT_FOUND', 'File not found.');
    }
    return row;
  }

  private canManage(auth: AuthContext, row: { uploaderId: string }): boolean {
    return row.uploaderId === auth.userId
      ? auth.capabilities.has('media.upload') || auth.capabilities.has('media.manage')
      : auth.capabilities.has('media.manage');
  }

  private variantsOf(row: { variants: Prisma.JsonValue }): StoredVariant[] {
    return Array.isArray(row.variants) ? (row.variants as unknown as StoredVariant[]) : [];
  }

  private toItem(row: MediaRow, auth: AuthContext): MediaItem {
    const variants = this.variantsOf(row);
    const kind = kindOf(row.mimeType);
    const manage = this.canManage(auth, row);
    return {
      id: row.id,
      url: this.urls.url(row.storageKey),
      thumbnailUrl: kind === 'image' ? this.urls.bestUrl(row.storageKey, variants, 320) : null,
      filename: row.filename,
      title: row.title,
      altText: row.altText,
      caption: row.caption,
      mimeType: row.mimeType,
      kind,
      sizeBytes: row.sizeBytes,
      width: row.width,
      height: row.height,
      variants: variants.map((variant) => ({
        width: variant.width,
        height: variant.height,
        url: this.urls.url(variant.key),
      })),
      uploader: row.uploader,
      createdAt: row.createdAt.toISOString(),
      permissions: { edit: manage, delete: manage },
    };
  }
}
