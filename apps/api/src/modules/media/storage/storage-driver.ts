import type { Readable } from 'node:stream';

export interface StoredObject {
  readonly body: Readable;
  /** Total size of the object in bytes. */
  readonly size: number;
}

export interface ByteRange {
  readonly start: number;
  /** Inclusive. */
  readonly end: number;
}

/** Where media files live. Keys are always server-generated and validated (see media-types.ts). */
export interface StorageDriver {
  readonly name: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** null when the object does not exist. */
  size(key: string): Promise<number | null>;
  read(key: string, range?: ByteRange): Promise<StoredObject | null>;
  readBuffer(key: string): Promise<Buffer | null>;
  /** Missing objects are ignored. */
  delete(keys: readonly string[]): Promise<void>;
}

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');
