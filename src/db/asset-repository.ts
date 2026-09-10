import type { Connection } from './connection.ts';
import type { assets } from './schema.ts';
import type { LocalImageStore } from '../storage/local-image-store.ts';
import { MAX_IMAGE_BYTES, validateImage } from '../storage/image-validator.ts';
import { StorageError } from '../storage/errors.ts';
import { assertActive, assertReviewIds, authorize, ReviewError } from './review-authorization.ts';

type Asset = typeof assets.$inferSelect;
type AssetRow = Omit<Asset, 'byteSize'> & { byteSize: string };
type ImageRead = { bytes: Buffer; mimeType: string; width: number; height: number };
const MAX_PROJECT_ASSETS = 500;
const MAX_PROJECT_BYTES = 100n * 1024n * 1024n;

/** Private local persistence. The caller owns the connection and authenticated actor IDs. */
export class AssetRepository {
  private readonly connection: Connection;
  private readonly store: LocalImageStore;
  constructor(connection: Connection, store: LocalImageStore) {
    this.connection = connection;
    this.store = store;
  }

  async upload(workspaceId: string, projectId: string, memberId: string, bytes: Buffer, mime: string): Promise<Asset> {
    assertReviewIds(workspaceId, projectId, memberId);
    // Snapshot bounded caller data before the first await; decode only after authorization.
    const source = Buffer.isBuffer(bytes) && bytes.length <= MAX_IMAGE_BYTES ? Buffer.from(bytes) : undefined;
    return this.connection.sql.begin(async tx => {
      await authorize(tx, workspaceId, projectId, memberId, true);
      if (!source) throw new StorageError('invalid-image');
      const image = await validateImage(source, mime);
      const totals = await tx`select count(*)::int as count, coalesce(sum(byte_size), 0)::text as bytes
        from assets where workspace_id = ${workspaceId} and project_id = ${projectId}`;
      if (totals[0]!.count >= MAX_PROJECT_ASSETS || BigInt(totals[0]!.bytes) + BigInt(image.byteSize) > MAX_PROJECT_BYTES) {
        throw new ReviewError('invalid');
      }
      await assertActive(tx, workspaceId, projectId, memberId);
      const key = await this.store.put(image);
      await assertActive(tx, workspaceId, projectId, memberId);
      // Retain private orphans on failure: an ambiguous commit must never delete a committed file.
      const rows = await tx<AssetRow[]>`insert into assets
        (workspace_id, project_id, storage_key, mime_type, byte_size, width, height, status)
        values (${workspaceId}, ${projectId}, ${key}, ${image.mimeType}, ${image.byteSize}, ${image.width}, ${image.height}, 'ready')
        returning id, workspace_id as "workspaceId", project_id as "projectId", storage_key as "storageKey",
          mime_type as "mimeType", byte_size::text as "byteSize", width, height, status, created_at as "createdAt"`;
      return { ...rows[0]!, byteSize: BigInt(rows[0]!.byteSize) };
    });
  }

  async read(workspaceId: string, projectId: string, memberId: string, assetId: string): Promise<ImageRead> {
    assertReviewIds(workspaceId, projectId, memberId, assetId);
    return this.connection.sql.begin(async tx => {
      await authorize(tx, workspaceId, projectId, memberId, false);
      const rows = await tx`select storage_key, mime_type, byte_size::text as byte_size, width, height
        from assets where workspace_id = ${workspaceId} and project_id = ${projectId} and id = ${assetId}
          and status = 'ready' for share`;
      await assertActive(tx, workspaceId, projectId, memberId);
      const asset = rows[0];
      if (!asset) throw new ReviewError('not-found');
      const bytes = await this.store.read(asset.storage_key);
      if (BigInt(bytes.length) !== BigInt(asset.byte_size)) throw new StorageError('storage-failed');
      await assertActive(tx, workspaceId, projectId, memberId);
      return { bytes, mimeType: asset.mime_type, width: asset.width, height: asset.height };
    });
  }
}
