import { z } from 'zod';
import type postgres from 'postgres';
import type { Connection } from './connection.ts';
import type { projects, presentations, screens, versions } from './schema.ts';

export type ReviewErrorCode = 'invalid' | 'forbidden' | 'not-found';
export class ReviewError extends Error {
  readonly code: ReviewErrorCode;
  constructor(code: ReviewErrorCode) {
    super({ invalid: 'Invalid review data.', forbidden: 'Review access denied.', 'not-found': 'Review resource not found.' }[code]);
    this.name = 'ReviewError';
    this.code = code;
  }
}
type Transaction = postgres.TransactionSql;
type Project = typeof projects.$inferSelect;
type Presentation = typeof presentations.$inferSelect;
type Screen = typeof screens.$inferSelect;
type Version = typeof versions.$inferSelect;
const titleSchema = z.string().trim().min(1).max(160);
const idsSchema = z.array(z.uuid());
function ids(...values: unknown[]) {
  if (!idsSchema.safeParse(values).success) throw new ReviewError('invalid');
}
function title(value: unknown): string {
  const result = titleSchema.safeParse(value);
  if (!result.success) throw new ReviewError('invalid');
  return result.data;
}

/** Actor IDs must come from the authenticated server session; permissions always come from persisted rows. */
export class ReviewRepository {
  private readonly connection: Connection;
  constructor(connection: Connection) { this.connection = connection; }

  private async authorize(tx: Transaction, workspaceId: string, projectId: string, memberId: string, edit: boolean) {
    // All project operations use this lock order, including reads. Revocation updates
    // serialize against the locked persisted member and project-membership rows.
    const project = await tx`select id
      from projects where workspace_id = ${workspaceId} and id = ${projectId} for update`;
    if (!project.length) throw new ReviewError('not-found');
    const member = await tx`select id
      from members where workspace_id = ${workspaceId} and id = ${memberId} for update`;
    const membership = await tx`select role from project_members
      where workspace_id = ${workspaceId} and project_id = ${projectId} and member_id = ${memberId} for update`;
    if (!member.length || !membership.length) throw new ReviewError('forbidden');
    await this.assertActive(tx, workspaceId, projectId, memberId);
    if (edit && membership[0]!.role !== 'collaborator' && membership[0]!.role !== 'owner') throw new ReviewError('forbidden');
  }

  private async assertActive(tx: Transaction, workspaceId: string, projectId: string, memberId: string) {
    // Evaluate time in a separate statement after every authorization lock has
    // been acquired; transaction-start time can be stale after a lock wait.
    const active = await tx`select (p.expires_at is null or p.expires_at > clock_timestamp())
      and (m.expires_at is null or m.expires_at > clock_timestamp()) as active
      from projects p join members m on m.workspace_id = p.workspace_id
      where p.workspace_id = ${workspaceId} and p.id = ${projectId} and m.id = ${memberId}`;
    if (!active[0]?.active) throw new ReviewError('forbidden');
  }

  private async presentation(tx: Transaction, workspaceId: string, projectId: string, presentationId: string) {
    const rows = await tx`select id from presentations where workspace_id = ${workspaceId} and project_id = ${projectId} and id = ${presentationId}`;
    if (!rows.length) throw new ReviewError('not-found');
  }

  async createProject(workspaceId: string, memberId: string, inputTitle: string): Promise<Project> {
    ids(workspaceId, memberId);
    const cleanTitle = title(inputTitle);
    return this.connection.sql.begin(async tx => {
      const member = await tx`select id
        from members where workspace_id = ${workspaceId} and id = ${memberId} for update`;
      if (!member.length) throw new ReviewError('forbidden');
      const active = await tx`select (expires_at is null or expires_at > clock_timestamp()) as active
        from members where workspace_id = ${workspaceId} and id = ${memberId}`;
      if (!active[0]?.active) throw new ReviewError('forbidden');
      const rows = await tx<Project[]>`insert into projects (workspace_id, title) values (${workspaceId}, ${cleanTitle})
        returning id, workspace_id as "workspaceId", title, expires_at as "expiresAt", created_at as "createdAt"`;
      const project = rows[0]!;
      await tx`insert into project_members (workspace_id, project_id, member_id, role) values (${workspaceId}, ${project.id}, ${memberId}, 'owner')`;
      return project;
    });
  }

  async createPresentation(workspaceId: string, projectId: string, memberId: string, inputTitle: string): Promise<Presentation> {
    ids(workspaceId, projectId, memberId);
    const cleanTitle = title(inputTitle);
    return this.connection.sql.begin(async tx => {
      await this.authorize(tx, workspaceId, projectId, memberId, true);
      const rows = await tx<Presentation[]>`insert into presentations (workspace_id, project_id, title) values (${workspaceId}, ${projectId}, ${cleanTitle})
        returning id, workspace_id as "workspaceId", project_id as "projectId", title, created_at as "createdAt"`;
      return rows[0]!;
    });
  }

  async createScreen(workspaceId: string, projectId: string, presentationId: string, memberId: string, inputTitle: string): Promise<Screen> {
    ids(workspaceId, projectId, presentationId, memberId);
    const cleanTitle = title(inputTitle);
    return this.connection.sql.begin(async tx => {
      await this.authorize(tx, workspaceId, projectId, memberId, true);
      await this.presentation(tx, workspaceId, projectId, presentationId);
      const current = await tx`select count(*)::int as count, coalesce(max(position), -1)::int as last
        from screens where workspace_id = ${workspaceId} and project_id = ${projectId} and presentation_id = ${presentationId}`;
      if (current[0]!.count >= 100 || current[0]!.last >= 99) throw new ReviewError('invalid');
      const rows = await tx<Screen[]>`insert into screens (workspace_id, project_id, presentation_id, title, position)
        values (${workspaceId}, ${projectId}, ${presentationId}, ${cleanTitle}, ${current[0]!.last + 1})
        returning id, workspace_id as "workspaceId", project_id as "projectId", presentation_id as "presentationId", title, position, created_at as "createdAt"`;
      return rows[0]!;
    });
  }

  async reorderScreens(workspaceId: string, projectId: string, presentationId: string, memberId: string, orderedIds: string[]): Promise<void> {
    ids(workspaceId, projectId, presentationId, memberId);
    if (!idsSchema.safeParse(orderedIds).success || orderedIds.length > 100) throw new ReviewError('invalid');
    await this.connection.sql.begin(async tx => {
      await this.authorize(tx, workspaceId, projectId, memberId, true);
      await this.presentation(tx, workspaceId, projectId, presentationId);
      const rows = await tx`select id from screens where workspace_id = ${workspaceId} and project_id = ${projectId} and presentation_id = ${presentationId} for update`;
      await this.assertActive(tx, workspaceId, projectId, memberId);
      const existing = new Set(rows.map(row => row.id));
      if (orderedIds.length !== rows.length || new Set(orderedIds).size !== rows.length || orderedIds.some(id => !existing.has(id))) throw new ReviewError('invalid');
      for (const [position, id] of orderedIds.entries()) {
        await tx`update screens set position = ${position} where workspace_id = ${workspaceId} and project_id = ${projectId} and presentation_id = ${presentationId} and id = ${id}`;
      }
    });
  }

  async addVersion(workspaceId: string, projectId: string, screenId: string, memberId: string, assetId: string): Promise<Version> {
    ids(workspaceId, projectId, screenId, memberId, assetId);
    return this.connection.sql.begin(async tx => {
      await this.authorize(tx, workspaceId, projectId, memberId, true);
      const screen = await tx`select id from screens where workspace_id = ${workspaceId} and project_id = ${projectId} and id = ${screenId} for update`;
      if (!screen.length) throw new ReviewError('not-found');
      const asset = await tx`select status from assets where workspace_id = ${workspaceId} and project_id = ${projectId} and id = ${assetId} for share`;
      await this.assertActive(tx, workspaceId, projectId, memberId);
      if (!asset.length) throw new ReviewError('not-found');
      if (asset[0]!.status !== 'ready') throw new ReviewError('invalid');
      const previous = await tx<Version[]>`select id, workspace_id as "workspaceId", project_id as "projectId", screen_id as "screenId", asset_id as "assetId", number, created_at as "createdAt"
        from versions where workspace_id = ${workspaceId} and project_id = ${projectId} and screen_id = ${screenId} and asset_id = ${assetId}`;
      if (previous.length) return previous[0]!;
      const latest = await tx`select coalesce(max(number), 0)::int as number from versions where workspace_id = ${workspaceId} and project_id = ${projectId} and screen_id = ${screenId}`;
      if (latest[0]!.number >= 50) throw new ReviewError('invalid');
      const rows = await tx<Version[]>`insert into versions (workspace_id, project_id, screen_id, asset_id, number)
        values (${workspaceId}, ${projectId}, ${screenId}, ${assetId}, ${latest[0]!.number + 1})
        returning id, workspace_id as "workspaceId", project_id as "projectId", screen_id as "screenId", asset_id as "assetId", number, created_at as "createdAt"`;
      return rows[0]!;
    });
  }

  async listScreens(workspaceId: string, projectId: string, presentationId: string, memberId: string): Promise<Screen[]> {
    ids(workspaceId, projectId, presentationId, memberId);
    return this.connection.sql.begin(async tx => {
      await this.authorize(tx, workspaceId, projectId, memberId, false);
      await this.presentation(tx, workspaceId, projectId, presentationId);
      return await tx<Screen[]>`select id, workspace_id as "workspaceId", project_id as "projectId", presentation_id as "presentationId", title, position, created_at as "createdAt"
        from screens where workspace_id = ${workspaceId} and project_id = ${projectId} and presentation_id = ${presentationId} order by position, id`;
    });
  }
}
