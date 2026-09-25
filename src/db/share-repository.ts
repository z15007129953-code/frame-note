import { createHash, randomBytes } from 'node:crypto';
import type postgres from 'postgres';
import type { Connection } from './connection.ts';
import type { Actor } from './demo-repository.ts';
import type { WorkspacePresentation } from './workspace-repository.ts';
import type { LocalImageStore } from '../storage/local-image-store.ts';
import { StorageError } from '../storage/errors.ts';
import { assertActive, assertReviewIds, authorize, ReviewError } from './review-authorization.ts';

type Transaction = postgres.TransactionSql;
export type ShareSummary = { id: string; expiresAt: string; revoked: boolean; allowComments: boolean };
export type CreatedShare = { id: string; token: string; expiresAt: string; allowComments: boolean };
type Locator = Actor & { presentationId: string };
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
function ownerIds(actor: Actor, id: string) { assertReviewIds(actor.workspaceId, actor.projectId, actor.memberId, id); }
function guestIds(shareId: string, token: string, ...assetIds: string[]) {
  try { assertReviewIds(shareId, ...assetIds); }
  catch { throw new ReviewError('not-found'); }
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)
    || Buffer.from(token, 'base64url').toString('base64url') !== token) throw new ReviewError('not-found');
}

/** Bearer access is scoped here, independently of authenticated member routes. */
export class ShareRepository {
  private readonly connection: Connection;
  private readonly store: LocalImageStore | (() => Promise<LocalImageStore>);
  constructor(connection: Connection, store: LocalImageStore | (() => Promise<LocalImageStore>)) { this.connection = connection; this.store = store; }

  private async owner(tx: Transaction, actor: Actor) {
    await authorize(tx, actor.workspaceId, actor.projectId, actor.memberId, false);
    const [membership] = await tx`select role from project_members where workspace_id = ${actor.workspaceId}
      and project_id = ${actor.projectId} and member_id = ${actor.memberId}`;
    if (membership?.role !== 'owner') throw new ReviewError('forbidden');
  }

  private async presentation(tx: Transaction, actor: Actor, presentationId: string) {
    const [row] = await tx`select id from presentations where workspace_id = ${actor.workspaceId}
      and project_id = ${actor.projectId} and id = ${presentationId} for update`;
    await assertActive(tx, actor.workspaceId, actor.projectId, actor.memberId);
    if (!row) throw new ReviewError('not-found');
  }

  async create(actor: Actor, presentationId: string, hours: 1 | 24, allowComments = false): Promise<CreatedShare> {
    ownerIds(actor, presentationId);
      if (hours !== 1 && hours !== 24 || typeof allowComments !== 'boolean') throw new ReviewError('invalid');
    return this.connection.sql.begin(async tx => {
      await this.owner(tx, actor);
      await this.presentation(tx, actor, presentationId);
      const [quota] = await tx`select count(*)::int as count from shares where workspace_id = ${actor.workspaceId}
        and project_id = ${actor.projectId} and presentation_id = ${presentationId}`;
      if (quota!.count >= 20) throw new ReviewError('invalid');
      const token = randomBytes(32).toString('base64url');
      const [share] = await tx<{ id: string; expiresAt: string }[]>`insert into shares
        (workspace_id, project_id, presentation_id, issuer_id, token_hash, expires_at, allow_comments)
        select p.workspace_id, p.id, ${presentationId}, m.id, ${hash(token)},
          least(clock_timestamp() + ${hours} * interval '1 hour', p.expires_at, m.expires_at), ${allowComments}
        from projects p join members m on m.workspace_id = p.workspace_id
        where p.workspace_id = ${actor.workspaceId} and p.id = ${actor.projectId} and m.id = ${actor.memberId}
        returning id, expires_at as "expiresAt"`;
      await assertActive(tx, actor.workspaceId, actor.projectId, actor.memberId);
      return { id: share!.id, token, expiresAt: new Date(share!.expiresAt).toISOString(), allowComments };
    });
  }

  async list(actor: Actor, presentationId: string): Promise<ShareSummary[]> {
    ownerIds(actor, presentationId);
    return this.connection.sql.begin(async tx => {
      await this.owner(tx, actor);
      await this.presentation(tx, actor, presentationId);
      const rows = await tx<{ id: string; expiresAt: string; revoked: boolean; allowComments: boolean }[]>`select id, expires_at as "expiresAt", revoked, allow_comments as "allowComments"
        from shares where workspace_id = ${actor.workspaceId} and project_id = ${actor.projectId}
        and presentation_id = ${presentationId} order by created_at, id limit 20`;
      await assertActive(tx, actor.workspaceId, actor.projectId, actor.memberId);
      return rows.map(row => ({ ...row, expiresAt: new Date(row.expiresAt).toISOString() }));
    });
  }

  async revoke(actor: Actor, shareId: string): Promise<void> {
    ownerIds(actor, shareId);
    await this.connection.sql.begin(async tx => {
      await this.owner(tx, actor);
      const [share] = await tx`select id from shares where workspace_id = ${actor.workspaceId}
        and project_id = ${actor.projectId} and id = ${shareId} for update`;
      await assertActive(tx, actor.workspaceId, actor.projectId, actor.memberId);
      if (!share) throw new ReviewError('not-found');
      await tx`update shares set revoked = true where id = ${shareId}`;
      await assertActive(tx, actor.workspaceId, actor.projectId, actor.memberId);
    });
  }

  private async live(tx: Transaction, locator: Locator, shareId: string, tokenHash: string): Promise<string> {
    await assertActive(tx, locator.workspaceId, locator.projectId, locator.memberId);
    const [share] = await tx<{ expiresAt: string }[]>`select expires_at as "expiresAt" from shares
      where id = ${shareId} and token_hash = ${tokenHash} and workspace_id = ${locator.workspaceId}
      and project_id = ${locator.projectId} and presentation_id = ${locator.presentationId} and issuer_id = ${locator.memberId}
      and not revoked and expires_at > clock_timestamp()`;
    if (!share) throw new ReviewError('not-found');
    return new Date(share.expiresAt).toISOString();
  }

  private async guest<T>(shareId: string, token: string, action: (tx: Transaction, locator: Locator, tokenHash: string) => Promise<T>): Promise<T> {
    const tokenHash = hash(token);
    try {
      const result = await this.connection.sql.begin(async tx => {
        // This initial read only locates locks. Every scope field and the hash are revalidated under those locks.
        const [locator] = await tx<Locator[]>`select workspace_id as "workspaceId", project_id as "projectId",
          issuer_id as "memberId", presentation_id as "presentationId" from shares where id = ${shareId} and token_hash = ${tokenHash}`;
        if (!locator) throw new ReviewError('not-found');
        await this.owner(tx, locator);
        await tx`select id from shares where id = ${shareId} for update`;
        await this.live(tx, locator, shareId, tokenHash);
        await this.presentation(tx, locator, locator.presentationId);
        return action(tx, locator, tokenHash);
      });
      // postgres models array transaction results specially; this callback returns the action's own value.
      return result as T;
    } catch (error) {
      if (error instanceof ReviewError || (error instanceof StorageError && error.code !== 'storage-failed')) throw new ReviewError('not-found');
      throw error;
    }
  }

  async snapshot(shareId: string, token: string): Promise<{ presentation: WorkspacePresentation; expiresAt: string; allowComments: boolean }> {
    guestIds(shareId, token);
    return this.guest(shareId, token, async (tx, locator, tokenHash) => {
      const { workspaceId, projectId, presentationId } = locator;
      const [presentation] = await tx<WorkspacePresentation[]>`select p.id, p.title,
        coalesce((select jsonb_agg(screen.data order by screen.position, screen.id) from (
          select s.id, s.position, jsonb_build_object('id', s.id, 'title', s.title, 'position', s.position, 'versions',
            coalesce((select jsonb_agg(version.data order by version.number, version.id) from (
              select v.id, v.number, jsonb_build_object('id', v.id, 'number', v.number, 'assetId', a.id, 'width', a.width, 'height', a.height) as data
              from versions v join assets a on a.workspace_id = v.workspace_id and a.project_id = v.project_id and a.id = v.asset_id
              where v.workspace_id = ${workspaceId} and v.project_id = ${projectId} and v.screen_id = s.id and a.status = 'ready'
              order by v.number, v.id limit 50
            ) version), '[]'::jsonb)) as data
          from screens s where s.workspace_id = ${workspaceId} and s.project_id = ${projectId} and s.presentation_id = p.id
          order by s.position, s.id limit 100
        ) screen), '[]'::jsonb) as screens
        from presentations p where p.workspace_id = ${workspaceId} and p.project_id = ${projectId} and p.id = ${presentationId}`;
      if (!presentation) throw new ReviewError('not-found');
      const [share] = await tx<{ allowComments: boolean }[]>`select allow_comments as "allowComments" from shares where id = ${shareId}`;
      return { presentation, expiresAt: await this.live(tx, locator, shareId, tokenHash), allowComments: !!share?.allowComments };
    });
  }

  async read(shareId: string, token: string, assetId: string): Promise<{ bytes: Buffer; mimeType: string; width: number; height: number }> {
    guestIds(shareId, token, assetId);
    return this.guest(shareId, token, async (tx, locator, tokenHash) => {
      const [asset] = await tx<{ storageKey: string; byteSize: string; mimeType: string; width: number; height: number }[]>`select
        a.storage_key as "storageKey", a.byte_size::text as "byteSize", a.mime_type as "mimeType", a.width, a.height from assets a
        where a.workspace_id = ${locator.workspaceId} and a.project_id = ${locator.projectId} and a.id = ${assetId} and a.status = 'ready'
        and exists(select 1 from versions v join screens s on s.workspace_id = v.workspace_id and s.project_id = v.project_id and s.id = v.screen_id
          where v.workspace_id = a.workspace_id and v.project_id = a.project_id and v.asset_id = a.id and s.presentation_id = ${locator.presentationId})
        for share of a`;
      await this.live(tx, locator, shareId, tokenHash);
      if (!asset) throw new ReviewError('not-found');
      const store = typeof this.store === 'function' ? await this.store() : this.store;
      const bytes = await store.read(asset.storageKey);
      await this.live(tx, locator, shareId, tokenHash);
      if (BigInt(bytes.length) !== BigInt(asset.byteSize)) throw new ReviewError('not-found');
      return { bytes, mimeType: asset.mimeType, width: asset.width, height: asset.height };
    });
  }
}
