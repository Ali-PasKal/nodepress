import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import type { S3Config } from '../../../config/app-config.js';
import { isValidStorageKey } from '../media-types.js';
import type { ByteRange, StorageDriver, StoredObject } from './storage-driver.js';

/** S3 or any S3-compatible object store (MinIO, R2, Spaces...). */
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3';
  private readonly client: S3Client;

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
    });
  }

  private check(key: string): string {
    if (!isValidStorageKey(key)) {
      throw new Error('Invalid storage key');
    }
    return key;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.check(key),
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async size(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: this.check(key) }),
      );
      return head.ContentLength ?? null;
    } catch (error) {
      if (error instanceof NotFound || error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  async read(key: string, range?: ByteRange): Promise<StoredObject | null> {
    const size = await this.size(key);
    if (size === null) return null;
    const object = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.check(key),
        ...(range ? { Range: `bytes=${String(range.start)}-${String(range.end)}` } : {}),
      }),
    );
    if (!(object.Body instanceof Readable)) {
      throw new Error('Unexpected S3 response body');
    }
    return { size, body: object.Body };
  }

  async readBuffer(key: string): Promise<Buffer | null> {
    const object = await this.read(key);
    if (!object) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }

  async delete(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    const result = await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.config.bucket,
        Delete: { Objects: keys.map((key) => ({ Key: this.check(key) })), Quiet: true },
      }),
    );
    if (result.Errors && result.Errors.length > 0) {
      throw new Error(`S3 refused to delete ${String(result.Errors.length)} object(s)`);
    }
  }
}
