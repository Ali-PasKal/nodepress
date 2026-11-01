import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { isValidStorageKey } from '../media-types.js';
import type { ByteRange, StorageDriver, StoredObject } from './storage-driver.js';

/** Files on a local (or mounted) disk under MEDIA_LOCAL_DIR. */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Resolves a key inside the root, refusing anything that could escape it. */
  private path(key: string): string {
    if (!isValidStorageKey(key)) {
      throw new Error('Invalid storage key');
    }
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) {
      throw new Error('Storage key escapes the storage root');
    }
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true, mode: 0o750 });
    // Write then rename, so readers never observe a partially written file.
    const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temp, body, { mode: 0o640 });
    await rename(temp, target);
  }

  async size(key: string): Promise<number | null> {
    try {
      const info = await stat(this.path(key));
      return info.isFile() ? info.size : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async read(key: string, range?: ByteRange): Promise<StoredObject | null> {
    const size = await this.size(key);
    if (size === null) return null;
    return {
      size,
      body: createReadStream(this.path(key), range ? { start: range.start, end: range.end } : {}),
    };
  }

  async readBuffer(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(keys: readonly string[]): Promise<void> {
    await Promise.all(keys.map((key) => rm(this.path(key), { force: true })));
    // Remove the (now possibly empty) per-upload directory; ignore failures (e.g. not empty).
    await Promise.all(
      [...new Set(keys.map((key) => dirname(this.path(key))))].map((dir) =>
        rm(dir, { recursive: false }).catch(() => undefined),
      ),
    );
  }
}
