import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { StorageError } from './errors.ts';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 10_000;
const MAX_PIXELS = 40_000_000;
const formats = {
  png: { mimeType: 'image/png', extension: 'png' },
  jpeg: { mimeType: 'image/jpeg', extension: 'jpg' },
  webp: { mimeType: 'image/webp', extension: 'webp' },
} as const;
const validated = new WeakMap<ValidatedImage, string>();
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export type ValidatedImage = Readonly<{
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  byteSize: number;
  extension: 'png' | 'jpg' | 'webp';
}>;

export async function validateImage(bytes: Buffer, declaredMime: string): Promise<ValidatedImage> {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES ||
        !Object.values(formats).some((format) => format.mimeType === declaredMime)) {
      throw new StorageError('invalid-image');
    }
    const source = Buffer.from(bytes);
    if (declaredMime === 'image/png') validatePngContainer(source);
    const decoder = sharp(source, { failOn: 'warning', limitInputPixels: MAX_PIXELS, animated: true });
    const metadata = await decoder.metadata();
    if (!metadata.format || !(metadata.format in formats)) throw new StorageError('invalid-image');
    const format = formats[metadata.format as keyof typeof formats];
    if (format.mimeType !== declaredMime || (metadata.pages ?? 1) !== 1 ||
        !withinDimensions(metadata.width, metadata.height)) throw new StorageError('invalid-image');

    // Re-encoding forces complete pixel decoding. Sharp strips metadata by default.
    const { data, info } = await decoder.autoOrient().toFormat(metadata.format as keyof typeof formats)
      .toBuffer({ resolveWithObject: true });
    if (data.length === 0 || data.length > MAX_IMAGE_BYTES || !withinDimensions(info.width, info.height)) {
      throw new StorageError('invalid-image');
    }
    const image: ValidatedImage = Object.freeze({
      bytes: data, ...format, width: info.width, height: info.height, byteSize: data.length,
    });
    validated.set(image, digest(data));
    return image;
  } catch {
    throw new StorageError('invalid-image');
  }
}

function validatePngContainer(bytes: Buffer): void {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new StorageError('invalid-image');
  }
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new StorageError('invalid-image');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4) ||
        type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw new StorageError('invalid-image');
    if (type === 'IEND') {
      if (length !== 0 || end !== bytes.length) throw new StorageError('invalid-image');
      return;
    }
    offset = end;
  }
  throw new StorageError('invalid-image');
}

function withinDimensions(width: number | undefined, height: number | undefined): boolean {
  return typeof width === 'number' && typeof height === 'number' &&
    Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 &&
    width <= MAX_DIMENSION && height <= MAX_DIMENSION && width * height <= MAX_PIXELS;
}

/** Internal adapter boundary: reject fabricated objects and copy mutable bytes before any await. */
export function snapshotValidatedImage(image: ValidatedImage): Buffer {
  const expected = validated.get(image);
  if (!expected || !Buffer.isBuffer(image.bytes) || image.bytes.length > MAX_IMAGE_BYTES) {
    throw new StorageError('invalid-image');
  }
  const bytes = Buffer.from(image.bytes);
  if (digest(bytes) !== expected) throw new StorageError('invalid-image');
  return bytes;
}
