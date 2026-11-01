import sharp, { type Sharp } from 'sharp';

/** Decompression-bomb guard: images above this many pixels are refused. */
export const MAX_INPUT_PIXELS = 50_000_000;
export const VARIANT_WIDTHS = [320, 768, 1536] as const;

export interface ProcessedImage {
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
}

export class UnreadableImageError extends Error {
  override readonly name = 'UnreadableImageError';
}

function open(input: Buffer, animated = false): Sharp {
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated });
}

/**
 * Re-encodes a raster upload in its own format: applies the EXIF orientation and drops all metadata
 * (camera details, GPS position). Re-encoding also discards anything appended to or hidden in the file.
 */
export async function sanitizeImage(
  input: Buffer,
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif',
): Promise<ProcessedImage> {
  try {
    const pipeline = open(input).rotate();
    const encoded =
      mime === 'image/jpeg'
        ? pipeline.jpeg({ quality: 90, mozjpeg: true })
        : mime === 'image/png'
          ? pipeline.png({ compressionLevel: 9 })
          : mime === 'image/webp'
            ? pipeline.webp({ quality: 90 })
            : pipeline.avif({ quality: 70 });
    const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch (error) {
    throw new UnreadableImageError(error instanceof Error ? error.message : String(error));
  }
}

/** Dimensions without re-encoding (used for GIFs, which are stored as uploaded). */
export async function imageDimensions(input: Buffer): Promise<{ width: number; height: number }> {
  try {
    const metadata = await open(input, true).metadata();
    const height = metadata.pageHeight ?? metadata.height;
    if (!metadata.width || !height) throw new Error('Missing dimensions');
    return { width: metadata.width, height };
  } catch (error) {
    throw new UnreadableImageError(error instanceof Error ? error.message : String(error));
  }
}

/** WebP variants for every configured width smaller than the original. */
export async function resizeVariants(
  input: Buffer,
  originalWidth: number,
): Promise<{ width: number; image: ProcessedImage }[]> {
  const widths = VARIANT_WIDTHS.filter((width) => width < originalWidth);
  return Promise.all(
    widths.map(async (width) => {
      const { data, info } = await open(input)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      return { width, image: { buffer: data, width: info.width, height: info.height } };
    }),
  );
}
