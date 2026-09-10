import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { validateImage } from './image-validator.ts';
import { StorageError } from './errors.ts';

const limit = 10 * 1024 * 1024;
const fixture = (format: 'png' | 'jpeg' | 'webp', width = 32, height = 20) =>
  sharp({ create: { width, height, channels: 3, background: '#e83162' } }).toFormat(format).toBuffer();

function invalid(error: unknown) {
  assert.ok(error instanceof StorageError);
  assert.equal(error.code, 'invalid-image');
  assert.equal(error.message, 'Invalid image.');
  assert.equal(error.cause, undefined);
  return true;
}

for (const [format, mimeType, extension] of [
  ['png', 'image/png', 'png'], ['jpeg', 'image/jpeg', 'jpg'], ['webp', 'image/webp', 'webp'],
] as const) {
  test(`fully decodes and normalizes ${format}`, async () => {
    const source = await fixture(format);
    const image = await validateImage(source, mimeType);
    assert.equal(image.mimeType, mimeType);
    assert.equal(image.extension, extension);
    assert.equal(image.width, 32);
    assert.equal(image.height, 20);
    assert.equal(image.byteSize, image.bytes.length);
    assert.ok(image.byteSize > 0 && image.byteSize <= limit);
    assert.notEqual(image.bytes, source);
    const { info } = await sharp(image.bytes).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 32);
    assert.equal(info.height, 20);
  });
  test(`rejects truncated ${format}`, async () => {
    const source = await fixture(format, 300, 200);
    await assert.rejects(validateImage(source.subarray(0, Math.floor(source.length * 0.8)), mimeType), invalid);
  });
}

test('auto-orients pixels and removes EXIF, XMP and ICC metadata', async () => {
  const source = await sharp({ create: { width: 40, height: 20, channels: 3, background: 'red' } })
    .jpeg().withMetadata({ orientation: 6 }).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">private</x:xmpmeta>').toBuffer();
  const original = await sharp(source).metadata();
  assert.equal(original.orientation, 6);
  assert.ok(original.exif && original.icc && original.xmp);
  const image = await validateImage(source, 'image/jpeg');
  assert.equal(image.width, 20);
  assert.equal(image.height, 40);
  const result = await sharp(image.bytes).metadata();
  assert.equal(result.orientation, undefined);
  assert.equal(result.exif, undefined);
  assert.equal(result.icc, undefined);
  assert.equal(result.xmp, undefined);
});

test('rejects empty, corrupt, oversized, non-buffer and mismatched uploads', async () => {
  const png = await fixture('png');
  for (const [bytes, mime] of [
    [Buffer.alloc(0), 'image/png'], [Buffer.from('private corrupt contents'), 'image/png'],
    [Buffer.alloc(limit + 1), 'image/png'], [new Uint8Array(png), 'image/png'],
    [png, 'image/jpeg'], [png, 'image/webp'], [png, 'image/jpg'], [png, 'IMAGE/PNG'],
    [png, 'image/png; charset=utf-8'], [png, 'application/octet-stream'],
  ] as const) await assert.rejects(validateImage(bytes as Buffer, mime), invalid);
});

test('rejects SVG and GIF regardless of declared image type', async () => {
  const gif = await sharp(await fixture('png')).gif().toBuffer();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  for (const bytes of [gif, svg]) {
    for (const mime of ['image/png', 'image/gif', 'image/svg+xml']) {
      await assert.rejects(validateImage(bytes, mime), invalid);
    }
  }
});

test('rejects animated WebP', async () => {
  const pixels = Buffer.concat([Buffer.alloc(20 * 20 * 3, 0), Buffer.alloc(20 * 20 * 3, 255)]);
  const source = await sharp(pixels, { raw: { width: 20, height: 40, channels: 3, pageHeight: 20 } })
    .webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(source, { animated: true }).metadata()).pages, 2);
  await assert.rejects(validateImage(source, 'image/webp'), invalid);
});

test('enforces both dimension and total pixel ceilings', async () => {
  for (const [width, height] of [[10001, 1], [1, 10001], [6400, 6400]]) {
    await assert.rejects(validateImage(await fixture('png', width, height), 'image/png'), invalid);
  }
});

test('accepts the dimension boundary', async () => {
  const image = await validateImage(await fixture('png', 10000, 1), 'image/png');
  assert.equal(image.width, 10000);
});

test('copies upload bytes before asynchronous decoding', async () => {
  const source = await fixture('png');
  const pending = validateImage(source, 'image/png');
  source.fill(0);
  assert.equal((await pending).width, 32);
});

test('rejects APNG animation control chunks even when decoder exposes one page', async () => {
  const source = await fixture('png');
  const chunk = Buffer.alloc(20);
  chunk.writeUInt32BE(8, 0);
  chunk.write('acTL', 4, 'ascii');
  chunk.writeUInt32BE(2, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 16)), 16);
  const animated = Buffer.concat([source.subarray(0, 33), chunk, source.subarray(33)]);
  await assert.rejects(validateImage(animated, 'image/png'), invalid);
});

test('rejects truncated PNG end marker even if all pixel data is present', async () => {
  const source = await fixture('png');
  await assert.rejects(validateImage(source.subarray(0, source.length - 12), 'image/png'), invalid);
});

test('rejects normalized output over 10 MiB even when uploaded input is smaller', async () => {
  const indexes = randomBytes(2400 * 2400);
  const pixels = Buffer.alloc(indexes.length * 3);
  for (let i = 0; i < indexes.length; i++) {
    pixels[i * 3] = indexes[i];
    pixels[i * 3 + 1] = (indexes[i] * 73) % 256;
    pixels[i * 3 + 2] = (indexes[i] * 151) % 256;
  }
  const source = await sharp(pixels, { raw: { width: 2400, height: 2400, channels: 3 } })
    .png({ palette: true, colours: 256, dither: 0, effort: 1 }).toBuffer();
  assert.ok(source.length < limit);
  assert.ok((await sharp(source).png().toBuffer()).length > limit);
  await assert.rejects(validateImage(source, 'image/png'), invalid);
});

test('rejects corrupted PNG chunk checksums', async () => {
  const source = await fixture('png');
  source[32] ^= 1;
  await assert.rejects(validateImage(source, 'image/png'), invalid);
});
