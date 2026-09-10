import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat, chmod, writeFile, readFile, symlink, link, rename, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { validateImage } from './image-validator.ts';
import { StorageError } from './errors.ts';
import { LocalImageStore } from './local-image-store.ts';

const validKey = '3b721a50-77ad-4a7b-a2ee-82079439a894.png';
const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/;
const sample = async () => validateImage(await sharp({ create: { width: 16, height: 12, channels: 3, background: 'blue' } }).png().toBuffer(), 'image/png');

function code(expected: string) {
  return (error: unknown) => {
    assert.ok(error instanceof StorageError);
    assert.equal(error.code, expected);
    assert.equal(error.cause, undefined);
    assert.ok(['Invalid image.', 'Invalid image key.', 'Image not found.', 'Image storage failed.'].includes(error.message));
    return true;
  };
}

async function temporary(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'frame-note-storage-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('persists private files with server-generated unique keys and reopens them', async (t) => {
  const directory = join(await temporary(t), 'images');
  const store = await LocalImageStore.open(directory);
  const image = await sample();
  const first = await store.put(image);
  const second = await store.put(image);
  assert.match(first, keyPattern);
  assert.match(second, keyPattern);
  assert.notEqual(first, second);
  assert.deepEqual(await store.read(first), image.bytes);
  assert.deepEqual(await (await LocalImageStore.open(directory)).read(second), image.bytes);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(directory, first))).mode & 0o777, 0o600);
  assert.deepEqual(await readFile(join(directory, first)), image.bytes);
});

test('makes an existing directory private', async (t) => {
  const directory = join(await temporary(t), 'images');
  await mkdir(directory, { mode: 0o755 });
  await chmod(directory, 0o755);
  await LocalImageStore.open(directory);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
});

test('rejects a missing key without exposing its path', async (t) => {
  const store = await LocalImageStore.open(join(await temporary(t), 'images'));
  await assert.rejects(store.read(validKey), code('not-found'));
});

test('rejects traversal and malformed keys before filesystem access', async (t) => {
  const store = await LocalImageStore.open(join(await temporary(t), 'images'));
  for (const key of ['', '..', '../private.png', '/private.png', `nested/${validKey}`, `nested\\${validKey}`, validKey + '\0', validKey + '\n', validKey.toUpperCase(), validKey.replace('.png', '.svg'), '%2e%2e%2fsecret', null, undefined]) {
    await assert.rejects(store.read(key as string), code('invalid-key'));
  }
});

test('rejects relative, symbolic-link and regular-file roots', async (t) => {
  const parent = await temporary(t);
  const target = join(parent, 'target');
  await mkdir(target);
  const link = join(parent, 'link');
  await symlink(target, link);
  const file = join(parent, 'file');
  await writeFile(file, 'private');
  for (const root of ['relative/images', link, file]) await assert.rejects(LocalImageStore.open(root), code('storage-failed'));
});

test('rejects symbolic links, directories and oversized image files', async (t) => {
  const parent = await temporary(t);
  const directory = join(parent, 'images');
  const store = await LocalImageStore.open(directory);
  const target = join(directory, validKey);
  const secret = join(parent, 'secret');
  await writeFile(secret, 'must never be returned');
  await symlink(secret, target);
  await assert.rejects(store.read(validKey), code('storage-failed'));
  await rm(target);
  await mkdir(target);
  await assert.rejects(store.read(validKey), code('storage-failed'));
  await rm(target, { recursive: true });
  await writeFile(target, '', { mode: 0o600 });
  await truncate(target, 10 * 1024 * 1024 + 1);
  await assert.rejects(store.read(validKey), code('storage-failed'));
});

test('rejects root replacement for both reads and writes', async (t) => {
  const parent = await temporary(t);
  const directory = join(parent, 'images');
  const store = await LocalImageStore.open(directory);
  const image = await sample();
  const key = await store.put(image);
  await rename(directory, join(parent, 'old-images'));
  await mkdir(directory);
  await writeFile(join(directory, key), 'replacement bytes');
  await assert.rejects(store.read(key), code('storage-failed'));
  await assert.rejects(store.put(image), code('storage-failed'));
});

test('rejects unvalidated or mutated image bytes', async (t) => {
  const store = await LocalImageStore.open(join(await temporary(t), 'images'));
  const image = await sample();
  image.bytes.fill(0);
  await assert.rejects(store.put(image), code('invalid-image'));
  await assert.rejects(store.put({ ...image, bytes: Buffer.from('secret'), extension: '../outside' } as never), code('invalid-image'));
});

test('copies validated bytes synchronously before writing', async (t) => {
  const store = await LocalImageStore.open(join(await temporary(t), 'images'));
  const image = await sample();
  const expected = Buffer.from(image.bytes);
  const pending = store.put(image);
  image.bytes.fill(0);
  assert.deepEqual(await store.read(await pending), expected);
});

test('rejects root replaced by a symbolic link', async (t) => {
  const parent = await temporary(t);
  const directory = join(parent, 'images');
  const old = join(parent, 'old');
  const store = await LocalImageStore.open(directory);
  const image = await sample();
  const key = await store.put(image);
  await rename(directory, old);
  await symlink(old, directory);
  await assert.rejects(store.read(key), code('storage-failed'));
  await assert.rejects(store.put(image), code('storage-failed'));
});

test('rejects hard links to other private files', async (t) => {
  const parent = await temporary(t);
  const directory = join(parent, 'images');
  const store = await LocalImageStore.open(directory);
  const other = join(parent, 'private');
  await writeFile(other, 'private contents', { mode: 0o600 });
  await link(other, join(directory, validKey));
  await assert.rejects(store.read(validKey), code('storage-failed'));
});

test('refuses use after private directory permissions change', async (t) => {
  const directory = join(await temporary(t), 'images');
  const store = await LocalImageStore.open(directory);
  const image = await sample();
  const key = await store.put(image);
  await chmod(directory, 0o755);
  await assert.rejects(store.read(key), code('storage-failed'));
  await assert.rejects(store.put(image), code('storage-failed'));
});

test('refuses reading files whose private permissions were widened', async (t) => {
  const directory = join(await temporary(t), 'images');
  const store = await LocalImageStore.open(directory);
  const key = await store.put(await sample());
  await chmod(join(directory, key), 0o644);
  await assert.rejects(store.read(key), code('storage-failed'));
});
