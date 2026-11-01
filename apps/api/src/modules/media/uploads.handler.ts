import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { contentTypeForKey, isValidStorageKey } from './media-types.js';
import { STORAGE_DRIVER, type ByteRange, type StorageDriver } from './storage/storage-driver.js';

/** Inline display is allowed for images, audio and video; anything else downloads. */
function disposition(contentType: string, key: string): string {
  const inline = /^(image|audio|video)\//.test(contentType);
  const name = key.slice(key.lastIndexOf('/') + 1);
  return `${inline ? 'inline' : 'attachment'}; filename="${name}"`;
}

/** Parses a single `bytes=a-b` range; returns null for no range and 'invalid' when unsatisfiable. */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (match[1] === '') {
    // Suffix range: the last N bytes.
    const suffix = Number(match[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

/**
 * Serves stored media at /uploads/<key> from any storage driver: strict key validation (no traversal),
 * the content type derived from the server-generated extension, `nosniff`, a sandboxing CSP, immutable
 * caching (keys contain a random component and never change), and single byte ranges for media seeking.
 */
@Injectable()
export class UploadsHandler {
  private readonly logger = new Logger(UploadsHandler.name);

  constructor(@Inject(STORAGE_DRIVER) private readonly storage: StorageDriver) {}

  middleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      this.serve(req, res).catch((err: unknown) => {
        if (res.headersSent) {
          this.logger.warn({ err }, 'Media stream failed mid-response');
          res.destroy();
          return;
        }
        next(err);
      });
    };
  }

  private notFound(res: Response): void {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'File not found.',
        requestId: String(res.getHeader('x-request-id') ?? ''),
      },
    });
  }

  private async serve(req: Request, res: Response): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      res.status(405).end();
      return;
    }
    let key: string;
    try {
      key = decodeURIComponent(req.path.replace(/^\/+/, ''));
    } catch {
      this.notFound(res);
      return;
    }
    const contentType = contentTypeForKey(key);
    if (!isValidStorageKey(key) || contentType === null) {
      this.notFound(res);
      return;
    }
    const size = await this.storage.size(key);
    if (size === null) {
      this.notFound(res);
      return;
    }
    const range = parseRange(req.headers.range, size);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', disposition(contentType, key));
    if (range === 'invalid') {
      res.setHeader('Content-Range', `bytes */${String(size)}`);
      res.status(416).end();
      return;
    }
    if (range) {
      res.status(206);
      res.setHeader(
        'Content-Range',
        `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`,
      );
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(size));
    }
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const object = await this.storage.read(key, range ?? undefined);
    if (!object) {
      this.notFound(res);
      return;
    }
    await pipeline(object.body, res);
  }
}
