import { z } from 'zod';
import type postgres from 'postgres';
import type { Connection } from './connection.ts';
import type { Actor } from './demo-repository.ts';
import { assertActive, assertReviewIds, authorize, ReviewError } from './review-authorization.ts';

export type Message = { id: string; body: string; authorId: string; createdAt: string };
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

/** Authenticated actor IDs are scoped by persisted membership inside every transaction. */
export class CommentRepository {
  private readonly connection: Connection;
  constructor(connection: Connection) { this.connection = connection; }

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
        const messages = await tx<Message[]>`select id, body, author_id as "authorId", created_at as "createdAt" from comment_messages
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
    return { ...message!, createdAt: new Date(message!.createdAt).toISOString() };
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
