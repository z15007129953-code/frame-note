import { z } from 'zod';
import type { Connection } from './connection.ts';
import type { Actor } from './demo-repository.ts';
import { assertActive, assertReviewIds, authorize, ReviewError } from './review-authorization.ts';

export type WorkspaceVersion = { id: string; number: number; assetId: string; width: number; height: number };
export type WorkspaceScreen = { id: string; title: string; position: number; versions: WorkspaceVersion[] };
export type WorkspacePresentation = { id: string; title: string; screens: WorkspaceScreen[] };
export type WorkspaceSnapshot = { project: { id: string; title: string }; presentations: WorkspacePresentation[] };
const titleSchema = z.string().trim().min(1).max(160);

export class WorkspaceRepository {
  private readonly connection: Connection;
  constructor(connection: Connection) { this.connection = connection; }

  async snapshot(actor: Actor): Promise<WorkspaceSnapshot> {
    const { workspaceId, projectId, memberId } = actor;
    assertReviewIds(workspaceId, projectId, memberId);
    return this.connection.sql.begin(async tx => {
      await authorize(tx, workspaceId, projectId, memberId, false);
      const [project] = await tx<{ id: string; title: string }[]>`select id, title from projects where workspace_id = ${workspaceId} and id = ${projectId}`;
      const presentations = await tx<WorkspacePresentation[]>`select p.id, p.title,
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
        from presentations p where p.workspace_id = ${workspaceId} and p.project_id = ${projectId}
        order by p.created_at, p.id limit 100`;
      await assertActive(tx, workspaceId, projectId, memberId);
      return { project: project!, presentations: [...presentations] };
    });
  }

  async createPresentation(actor: Actor, inputTitle: string): Promise<WorkspacePresentation> {
    const { workspaceId, projectId, memberId } = actor;
    assertReviewIds(workspaceId, projectId, memberId);
    const parsed = titleSchema.safeParse(inputTitle);
    if (!parsed.success) throw new ReviewError('invalid');
    return this.connection.sql.begin(async tx => {
      await authorize(tx, workspaceId, projectId, memberId, true);
      const [count] = await tx`select count(*)::int as count from presentations where workspace_id = ${workspaceId} and project_id = ${projectId}`;
      if (count!.count >= 100) throw new ReviewError('invalid');
      await assertActive(tx, workspaceId, projectId, memberId);
      const [presentation] = await tx<{ id: string; title: string }[]>`insert into presentations (workspace_id, project_id, title)
        values (${workspaceId}, ${projectId}, ${parsed.data}) returning id, title`;
      return { ...presentation!, screens: [] };
    });
  }
}
