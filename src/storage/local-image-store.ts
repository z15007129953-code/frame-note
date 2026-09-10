import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StorageError } from './errors.ts';
import { MAX_IMAGE_BYTES, snapshotValidatedImage, type ValidatedImage } from './image-validator.ts';

const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/;
const noFollowRead = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/**
 * Private server adapter; it provides no public URL or authorization decision.
 * The operating-system owner and ancestor directories must be trusted. Node's
 * path-based open API cannot make ancestor replacement races fully atomic.
 * Canonical identity checks detect root replacement; O_NOFOLLOW and fstat
 * protect the actual file descriptor, including against leaf symlinks.
 */

export class LocalImageStore {
  readonly #directory: string;
  readonly #canonical: string;
  readonly #device: number;
  readonly #inode: number;

  private constructor(directory: string, canonical: string, device: number, inode: number) {
    this.#directory = directory;
    this.#canonical = canonical;
    this.#device = device;
    this.#inode = inode;
  }

  static async open(absoluteDirectory: string): Promise<LocalImageStore> {
    try {
      if (typeof absoluteDirectory !== 'string' || !isAbsolute(absoluteDirectory)) throw new StorageError('storage-failed');
      const directory = resolve(absoluteDirectory);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const entry = await lstat(directory);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new StorageError('storage-failed');
      const canonical = await realpath(directory);
      const handle = await open(directory, noFollowRead | constants.O_DIRECTORY);
      try {
        const actual = await handle.stat();
        if (!actual.isDirectory() || actual.dev !== entry.dev || actual.ino !== entry.ino) throw new StorageError('storage-failed');
        await handle.chmod(0o700);
        const store = new LocalImageStore(directory, canonical, actual.dev, actual.ino);
        await store.#assertRoot();
        return store;
      } finally {
        await handle.close();
      }
    } catch {
      throw new StorageError('storage-failed');
    }
  }

  async put(image: ValidatedImage): Promise<string> {
    const bytes = snapshotValidatedImage(image);
    try {
      await this.#assertRoot();
      const key = `${randomUUID()}.${image.extension}`;
      // User uploads are runtime data, never build-time bundled resources.
      const handle = await open(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ this.#canonical, key), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        const actual = await handle.stat();
        if (!actual.isFile() || actual.nlink !== 1) throw new StorageError('storage-failed');
        await handle.chmod(0o600);
        await this.#assertRoot();
        await handle.writeFile(bytes);
        await handle.sync();
        await this.#assertRoot();
        return key;
      } finally {
        await handle.close();
      }
    } catch {
      // A failed write may leave a private orphan; no automatic deletion occurs.
      throw new StorageError('storage-failed');
    }
  }

  async read(key: string): Promise<Buffer> {
    if (typeof key !== 'string' || key !== key.trim() || !keyPattern.test(key)) throw new StorageError('invalid-key');
    try {
      await this.#assertRoot();
      let handle;
      try {
        handle = await open(join(this.#canonical, key), noFollowRead);
      } catch (error) {
        await this.#assertRoot();
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StorageError('not-found');
        throw error;
      }
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o777) !== 0o600 ||
            before.size <= 0 || before.size > MAX_IMAGE_BYTES) {
          throw new StorageError('storage-failed');
        }
        // A bounded descriptor read avoids allocating an unbounded buffer if a
        // file grows after fstat. The extra byte detects growth at the boundary.
        const bytes = Buffer.alloc(before.size + 1);
        let length = 0;
        while (length < bytes.length) {
          const result = await handle.read(bytes, length, bytes.length - length, length);
          if (result.bytesRead === 0) break;
          length += result.bytesRead;
        }
        const after = await handle.stat();
        if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
            after.ctimeMs !== before.ctimeMs || after.nlink !== 1) throw new StorageError('storage-failed');
        await this.#assertRoot();
        return bytes.subarray(0, length);
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof StorageError && error.code === 'not-found') throw error;
      throw new StorageError('storage-failed');
    }
  }

  async #assertRoot(): Promise<void> {
    const entry = await lstat(this.#directory);
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.dev !== this.#device || entry.ino !== this.#inode ||
        (entry.mode & 0o777) !== 0o700 || await realpath(this.#directory) !== this.#canonical) {
      throw new StorageError('storage-failed');
    }
  }
}
