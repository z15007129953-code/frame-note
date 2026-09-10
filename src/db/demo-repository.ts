import { createHash, randomBytes } from 'node:crypto';
import type { Connection } from './connection.ts';
import { ReviewError } from './review-authorization.ts';

export type Actor = { workspaceId: string; projectId: string; memberId: string };
export type DemoSession = { token: string; actor: Actor; expiresAt: Date };

function tokenHash(token: unknown): string | null {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)
    || Buffer.from(token, 'base64url').toString('base64url') !== token) return null;
  return createHash('sha256').update(token).digest('hex');
}

export class DemoRepository {
  private readonly connection: Connection;
  constructor(connection: Connection) { this.connection = connection; }

  async create(): Promise<DemoSession> {
    const token = randomBytes(32).toString('base64url');
    return this.connection.sql.begin(async tx => {
      // Serialize the global quota check and every session insertion together.
      await tx`select pg_advisory_xact_lock(1734823901, 2)`;
      const [count] = await tx`select count(*)::int as count from demo_sessions`;
      if (count!.count >= 1000) throw new ReviewError('invalid');
      const [expiry] = await tx<{ expiresAt: string }[]>`select date_trunc('milliseconds', clock_timestamp()) + interval '24 hours' as "expiresAt"`;
      const expiresAt = new Date(expiry!.expiresAt);
      const expiryTimestamp = expiresAt.toISOString();
      const [workspace] = await tx<{ id: string }[]>`insert into workspaces (title) values ('Demo workspace') returning id`;
      const workspaceId = workspace!.id;
      const [member] = await tx<{ id: string }[]>`insert into members (workspace_id, expires_at) values (${workspaceId}, ${expiryTimestamp}) returning id`;
      const [project] = await tx<{ id: string }[]>`insert into projects (workspace_id, title, expires_at)
        values (${workspaceId}, 'Untitled project', ${expiryTimestamp}) returning id`;
      const actor = { workspaceId, memberId: member!.id, projectId: project!.id };
      await tx`insert into project_members (workspace_id, project_id, member_id, role)
        values (${workspaceId}, ${actor.projectId}, ${actor.memberId}, 'owner')`;
      await tx`insert into demo_sessions (token_hash, workspace_id, project_id, member_id, expires_at)
        values (${tokenHash(token)!}, ${workspaceId}, ${actor.projectId}, ${actor.memberId}, ${expiryTimestamp})`;
      return { token, actor, expiresAt };
    });
  }

  async resolve(token: string): Promise<Actor | null> {
    const hash = tokenHash(token);
    if (!hash) return null;
    const [actor] = await this.connection.sql<Actor[]>`select s.workspace_id as "workspaceId", s.project_id as "projectId", s.member_id as "memberId"
      from demo_sessions s
      join projects p on p.workspace_id = s.workspace_id and p.id = s.project_id
      join members m on m.workspace_id = s.workspace_id and m.id = s.member_id
      join project_members pm on pm.workspace_id = s.workspace_id and pm.project_id = s.project_id and pm.member_id = s.member_id
      where s.token_hash = ${hash} and s.expires_at > clock_timestamp()
        and (p.expires_at is null or p.expires_at > clock_timestamp())
        and (m.expires_at is null or m.expires_at > clock_timestamp())`;
    return actor ?? null;
  }

  async revoke(token: string): Promise<void> {
    const hash = tokenHash(token);
    if (hash) await this.connection.sql`delete from demo_sessions where token_hash = ${hash}`;
  }
}
