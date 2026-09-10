import { z } from 'zod';
import type postgres from 'postgres';

export type ReviewErrorCode = 'invalid' | 'forbidden' | 'not-found';
export class ReviewError extends Error {
  readonly code: ReviewErrorCode;
  constructor(code: ReviewErrorCode) {
    super({ invalid: 'Invalid review data.', forbidden: 'Review access denied.', 'not-found': 'Review resource not found.' }[code]);
    this.name = 'ReviewError';
    this.code = code;
  }
}

const idsSchema = z.array(z.uuid());
export function assertReviewIds(...values: unknown[]): void {
  if (!idsSchema.safeParse(values).success) throw new ReviewError('invalid');
}

export async function assertActive(tx: postgres.TransactionSql, workspaceId: string, projectId: string, memberId: string): Promise<void> {
  // A separate statement evaluates wall time after any lock or file I/O wait.
  const active = await tx`select (p.expires_at is null or p.expires_at > clock_timestamp())
    and (m.expires_at is null or m.expires_at > clock_timestamp()) as active
    from projects p join members m on m.workspace_id = p.workspace_id
    where p.workspace_id = ${workspaceId} and p.id = ${projectId} and m.id = ${memberId}`;
  if (!active[0]?.active) throw new ReviewError('forbidden');
}

/** Actor IDs are authenticated server facts; persisted membership determines permission. */
export async function authorize(tx: postgres.TransactionSql, workspaceId: string, projectId: string, memberId: string, edit: boolean): Promise<void> {
  // All project operations lock project, member, then membership in this order.
  const project = await tx`select id
    from projects where workspace_id = ${workspaceId} and id = ${projectId} for update`;
  if (!project.length) throw new ReviewError('not-found');
  const member = await tx`select id
    from members where workspace_id = ${workspaceId} and id = ${memberId} for update`;
  const membership = await tx`select role from project_members
    where workspace_id = ${workspaceId} and project_id = ${projectId} and member_id = ${memberId} for update`;
  if (!member.length || !membership.length) throw new ReviewError('forbidden');
  await assertActive(tx, workspaceId, projectId, memberId);
  if (edit && membership[0]!.role !== 'collaborator' && membership[0]!.role !== 'owner') throw new ReviewError('forbidden');
}
