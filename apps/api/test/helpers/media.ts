import sharp from 'sharp';
import { crc32 } from 'node:zlib';
import type { SignedIn } from './identity.js';

/** A JPEG with EXIF orientation 6 (rotate 90°) and GPS coordinates, like a phone photo. */
export async function phonePhoto(width = 2000, height = 1000): Promise<Buffer> {
  return (
    sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } })
      .jpeg()
      .withExif({
        IFD0: { Make: 'TestCam', Model: 'Phone 1' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '52/1 31/1 0/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: '13/1 24/1 0/1',
        },
      })
      // sharp manages the orientation tag separately from the other EXIF fields.
      .withMetadata({ orientation: 6 })
      .toBuffer()
  );
}

export function pngImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 120, b: 200, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** A tiny PNG whose header claims 20000×20000 pixels (a decompression-bomb shape). */
export function pixelBombPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(20_000, 0);
  header.writeUInt32BE(20_000, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(0, 9); // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

export function upload(
  user: SignedIn,
  file: Buffer,
  filename: string,
  options: { contentType?: string; fields?: Record<string, string>; csrf?: boolean } = {},
) {
  let req = user.agent.post('/api/v1/media');
  if (options.csrf !== false) req = req.set('X-CSRF-Token', user.csrf);
  for (const [key, value] of Object.entries(options.fields ?? {})) req = req.field(key, value);
  return req.attach('file', file, {
    filename,
    contentType: options.contentType ?? 'application/octet-stream',
  });
}
