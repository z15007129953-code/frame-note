import { z } from 'zod';
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import type { Connection } from './connection.ts';
import type { Actor } from './demo-repository.ts';
import { assertActive, assertReviewIds, authorize, ReviewError } from './review-authorization.ts';

export type Message = { id: string; body: string; authorId: string | null; isGuest: boolean; createdAt: string };
export type Thread = { id: string; versionId: string; x: number; y: number; resolved: boolean; messages: Message[] };
type ThreadRow = Omit<Thread, 'messages'>;
type Transaction = postgres.TransactionSql;
const pinSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const bodySchema = z.string().trim().min(1).max(2000);
function body(value: unknown): string {
  const parsed = bodySchema.safeParse(value);
  if (!parsed.success) throw new ReviewError('invalid');
  return parsed.data;
}
function ids(actor: Actor, ...values: string[]): void {
  assertReviewIds(actor.workspaceId, actor.projectId, actor.memberId, ...values);
}
function active(tx: Transaction, actor: Actor) {
  return assertActive(tx, actor.workspaceId, actor.projectId, actor.memberId);
}
function guestIds(shareId: string, token: string, ...ids: string[]) {
  try { assertReviewIds(shareId, ...ids); } catch { throw new ReviewError('not-found'); }
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token, 'base64url').toString('base64url') !== token) throw new ReviewError('not-found');
}
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Authenticated actor IDs are scoped by persisted membership inside every transaction. */
export class CommentRepository {
  private readonly connection: Connection;
  constructor(connection: Connection) { this.connection = connection; }

  private async guest(tx: Transaction, shareId: string, token: string, versionId: string) {
    const digest = tokenHash(token);
    // Match owner/revoke lock order: project, member, membership, share, then version.
    const [locator] = await tx<{ workspaceId: string; projectId: string; memberId: string; presentationId: string }[]>`select workspace_id as "workspaceId", project_id as "projectId", issuer_id as "memberId", presentation_id as "presentationId" from shares where id = ${shareId} and token_hash = ${digest}`;
    if (!locator) throw new ReviewError('not-found');
    const project = await tx`select id from projects where workspace_id = ${locator.workspaceId} and id = ${locator.projectId} for update`;
    const member = await tx`select id from members where workspace_id = ${locator.workspaceId} and id = ${locator.memberId} for update`;
    const membership = await tx<{ role: string }[]>`select role from project_members where workspace_id = ${locator.workspaceId} and project_id = ${locator.projectId} and member_id = ${locator.memberId} for update`;
    if (!project.length || !member.length || !membership.length || membership[0]!.role !== 'owner') throw new ReviewError('not-found');
    await assertActive(tx, locator.workspaceId, locator.projectId, locator.memberId);
    const [share] = await tx<{ workspaceId: string; projectId: string; memberId: string; presentationId: string; allowComments: boolean; revoked: boolean; expiresAt: string; tokenHash: string }[]>`select workspace_id as "workspaceId", project_id as "projectId", issuer_id as "memberId", presentation_id as "presentationId", allow_comments as "allowComments", revoked, expires_at as "expiresAt", token_hash as "tokenHash" from shares where id = ${shareId} and token_hash = ${digest} and not revoked and expires_at > clock_timestamp() for update`;
    if (!share || share.tokenHash !== digest || share.workspaceId !== locator.workspaceId || share.projectId !== locator.projectId || share.memberId !== locator.memberId || share.presentationId !== locator.presentationId || !share.allowComments) throw new ReviewError('not-found');
    const version = await tx`select v.id from versions v join screens s on s.workspace_id = v.workspace_id and s.project_id = v.project_id and s.id = v.screen_id where v.workspace_id = ${locator.workspaceId} and v.project_id = ${locator.projectId} and v.id = ${versionId} and s.presentation_id = ${locator.presentationId} for update`;
    await assertActive(tx, locator.workspaceId, locator.projectId, locator.memberId);
    if (!version.length) throw new ReviewError('not-found');
    return locator;
  }
  private async guestStillLive(tx: Transaction, shareId: string, token: string, locator: { workspaceId: string; projectId: string; memberId: string; presentationId: string }): Promise<void> {
    const digest = tokenHash(token);
    const [share] = await tx`select id from shares where id = ${shareId} and token_hash = ${digest} and workspace_id = ${locator.workspaceId} and project_id = ${locator.projectId} and issuer_id = ${locator.memberId} and presentation_id = ${locator.presentationId} and allow_comments and not revoked and expires_at > clock_timestamp()`;
    await assertActive(tx, locator.workspaceId, locator.projectId, locator.memberId);
    if (!share) throw new ReviewError('not-found');
  }

  private async version(tx: Transaction, actor: Actor, versionId: string, edit: boolean) {
    await authorize(tx, actor.workspaceId, actor.projectId, actor.memberId, edit);
    const rows = await tx`select id from versions
      where workspace_id = ${actor.workspaceId} and project_id = ${actor.projectId} and id = ${versionId} for update`;
    await active(tx, actor);
    if (!rows.length) throw new ReviewError('not-found');
  }

  private async thread(tx: Transaction, actor: Actor, versionId: string, threadId: string) {
    const rows = await tx`select id from comment_threads where workspace_id = ${actor.workspaceId}
      and project_id = ${actor.projectId} and version_id = ${versionId} and id = ${threadId} for update`;
    await active(tx, actor);
    if (!rows.length) throw new ReviewError('not-found');
  }

  async list(actor: Actor, versionId: string): Promise<Thread[]> {
    ids(actor, versionId);
    return this.connection.sql.begin(async tx => {
      await this.version(tx, actor, versionId, false);
      const rows = await tx<ThreadRow[]>`select id, version_id as "versionId", x, y, resolved from comment_threads
        where workspace_id = ${actor.workspaceId} and project_id = ${actor.projectId} and version_id = ${versionId}
        order by created_at, id limit 100`;
      const result: Thread[] = [];
      for (const row of rows) {
        const messages = await tx<Message[]>`select id, body, author_id as "authorId", guest_share_id is not null as "isGuest", created_at as "createdAt" from comment_messages
          where workspace_id = ${actor.workspaceId} and project_id = ${actor.projectId} and version_id = ${versionId} and thread_id = ${row.id}
          order by created_at, id limit 100`;
        result.push({ ...row, messages: messages.map(message => ({ ...message, createdAt: new Date(message.createdAt).toISOString() })) });
      }
      await active(tx, actor);
      return result;
    });
  }

  async create(actor: Actor, versionId: string, pin: { x: number; y: number }, inputBody: string): Promise<Thread> {
    ids(actor, versionId);
    const parsed = pinSchema.safeParse(pin);
    if (!parsed.success) throw new ReviewError('invalid');
    const cleanBody = body(inputBody);
    return this.connection.sql.begin(async tx => {
      await this.version(tx, actor, versionId, true);
      const [quota] = await tx`select count(*)::int as count from comment_threads
        where workspace_id = ${actor.workspaceId} and project_id = ${actor.projectId} and version_id = ${versionId}`;
      if (quota!.count >= 100) throw new ReviewError('invalid');
      await active(tx, actor);
      const [thread] = await tx<ThreadRow[]>`insert into comment_threads (workspace_id, project_id, version_id, x, y)
        values (${actor.workspaceId}, ${actor.projectId}, ${versionId}, ${parsed.data.x}, ${parsed.data.y})
        returning id, version_id as "versionId", x, y, resolved`;
      await active(tx, actor);
      const message = await this.insertMessage(tx, actor, versionId, thread!.id, cleanBody);
      await active(tx, actor);
      return { ...thread!, messages: [message] };
    });
  }

  private async insertMessage(tx: Transaction, actor: Actor, versionId: string, threadId: string, cleanBody: string): Promise<Message> {
    const [message] = await tx<Message[]>`insert into comment_messages (workspace_id, project_id, version_id, thread_id, author_id, body)
      values (${actor.workspaceId}, ${actor.projectId}, ${versionId}, ${threadId}, ${actor.memberId}, ${cleanBody})
      returning id, body, author_id as "authorId", created_at as "createdAt"`;
    return { ...message!, isGuest: false, createdAt: new Date(message!.createdAt).toISOString() };
  }

  async listGuest(shareId: string, token: string, versionId: string): Promise<Thread[]> {
    guestIds(shareId, token, versionId);
    return this.connection.sql.begin(async tx => {
      const row = await this.guest(tx, shareId, token, versionId);
      const threads = await tx<ThreadRow[]>`select id, version_id as "versionId", x, y, resolved from comment_threads where workspace_id = ${row.workspaceId} and project_id = ${row.projectId} and version_id = ${versionId} order by created_at, id limit 100`;
      const result: Thread[] = [];
      for (const thread of threads) {
        const messages = await tx<Message[]>`select id, body, author_id as "authorId", guest_share_id is not null as "isGuest", created_at as "createdAt" from comment_messages where workspace_id = ${row.workspaceId} and project_id = ${row.projectId} and version_id = ${versionId} and thread_id = ${thread.id} order by created_at, id limit 100`;
        result.push({ ...thread, messages: messages.map(m => ({ ...m, createdAt: new Date(m.createdAt).toISOString() })) });
      }
      await this.guestStillLive(tx, shareId, token, row);
      return result;
    });
  }

  async createGuest(shareId: string, token: string, versionId: string, pin: { x: number; y: number }, inputBody: string): Promise<Thread> {
    guestIds(shareId, token, versionId);
    const parsed = pinSchema.safeParse(pin); if (!parsed.success) throw new ReviewError('invalid');
    const cleanBody = body(inputBody);
    return this.connection.sql.begin(async tx => {
      const row = await this.guest(tx, shareId, token, versionId);
      const [quota] = await tx`select count(*)::int as count from comment_threads where workspace_id = ${row.workspaceId} and project_id = ${row.projectId} and version_id = ${versionId}`;
      if (quota!.count >= 100) throw new ReviewError('invalid');
      const [thread] = await tx<ThreadRow[]>`insert into comment_threads (workspace_id, project_id, version_id, x, y) values (${row.workspaceId}, ${row.projectId}, ${versionId}, ${parsed.data.x}, ${parsed.data.y}) returning id, version_id as "versionId", x, y, resolved`;
      await assertActive(tx, row.workspaceId, row.projectId, row.memberId);
      const [message] = await tx<Message[]>`insert into comment_messages (workspace_id, project_id, version_id, thread_id, author_id, guest_share_id, body) values (${row.workspaceId}, ${row.projectId}, ${versionId}, ${thread!.id}, null, ${shareId}, ${cleanBody}) returning id, body, author_id as "authorId", true as "isGuest", created_at as "createdAt"`;
      await assertActive(tx, row.workspaceId, row.projectId, row.memberId);
      await this.guestStillLive(tx, shareId, token, row);
      return { ...thread!, messages: [{ ...message!, createdAt: new Date(message!.createdAt).toISOString() }] };
    });
  }

  async replyGuest(shareId: string, token: string, versionId: string, threadId: string, inputBody: string): Promise<void> {
    guestIds(shareId, token, versionId, threadId); const cleanBody = body(inputBody);
    await this.connection.sql.begin(async tx => {
      const row = await this.guest(tx, shareId, token, versionId);
      const thread = await tx`select id from comment_threads where workspace_id = ${row.workspaceId} and project_id = ${row.projectId} and version_id = ${versionId} and id = ${threadId} for update`;
      if (!thread.length) throw new ReviewError('not-found');
      const [quota] = await tx`select count(*)::int as count from comment_messages where workspace_id = ${row.workspaceId} and project_id = ${row.projectId} and version_id = ${versionId} and thread_id = ${threadId}`;
      if (quota!.count >= 100) throw new ReviewError('invalid');
      await tx`insert into comment_messages (workspace_id, project_id, version_id, thread_id, author_id, guest_share_id, body) values (${row.workspaceId}, ${row.projectId}, ${versionId}, ${threadId}, null, ${shareId}, ${cleanBody})`;
      await assertActive(tx, row.workspaceId, row.projectId, row.memberId);
      await this.guestStillLive(tx, shareId, token, row);
    });
  }

  async reply(actor: Actor, versionId: string, threadId: string, inputBody: string): Promise<void> {
    ids(actor, versionId, threadId);
    const cleanBody = body(inputBody);
    await this.connection.sql.begin(async tx => {
      await this.version(tx, actor, versionId, true);
      await this.thread(tx, actor, versionId, threadId);
      const [quota] = await tx`select count(*)::int as count from comment_messages where workspace_id = ${actor.workspaceId}
        and project_id = ${actor.projectId} and version_id = ${versionId} and thread_id = ${threadId}`;
      if (quota!.count >= 100) throw new ReviewError('invalid');
      await active(tx, actor);
      await this.insertMessage(tx, actor, versionId, threadId, cleanBody);
      await active(tx, actor);
    });
  }

  async setResolved(actor: Actor, versionId: string, threadId: string, resolved: boolean): Promise<void> {
    ids(actor, versionId, threadId);
    if (typeof resolved !== 'boolean') throw new ReviewError('invalid');
    await this.connection.sql.begin(async tx => {
      await this.version(tx, actor, versionId, true);
      await this.thread(tx, actor, versionId, threadId);
      await active(tx, actor);
      await tx`update comment_threads set resolved = ${resolved} where workspace_id = ${actor.workspaceId}
        and project_id = ${actor.projectId} and version_id = ${versionId} and id = ${threadId}`;
      await active(tx, actor);
    });
  }
}
