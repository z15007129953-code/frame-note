export type Capability = 'view' | 'comment' | 'edit' | 'manage';
export type Role = 'viewer' | 'collaborator' | 'owner';

export type Project = { id: string; workspaceId: string; expiresAt: number | null };
export type Actor = {
  id: string;
  workspaceId: string;
  projectId: string;
  role: Role;
  expiresAt: number | null;
};
export type Share = {
  projectId: string;
  presentationId: string;
  mode: 'public' | 'token';
  tokenVerified: boolean;
  allowComments: boolean;
  expiresAt: number | null;
  revoked: boolean;
};
export type AccessInput = {
  capability: Capability;
  project: Project;
  presentationId: string;
  actor: Actor | null;
  share: Share | null;
  now: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isActive(expiresAt: unknown, now: number): boolean {
  return expiresAt === null || (typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > now);
}

/**
 * Evaluates server-verified project, membership, and share facts only.
 * The caller must authenticate requests, resolve membership and the presentation's
 * project, verify tokens, and load current expiry/revocation state server-side.
 * Passing raw request claims here does not authenticate or authorize them.
 */
export function canAccess(input: AccessInput): boolean {
  if (!isRecord(input)) return false;
  const { capability, project, presentationId, actor, share, now } = input;
  if (typeof now !== 'number' || !Number.isFinite(now)) return false;
  if (capability !== 'view' && capability !== 'comment' && capability !== 'edit' && capability !== 'manage') return false;
  if (!isRecord(project) || !isId(project.id) || !isId(project.workspaceId) || !isId(presentationId)) return false;
  if (!isActive(project.expiresAt, now)) return false;

  if (isRecord(actor) && isId(actor.id) && isId(actor.projectId) && isId(actor.workspaceId)
    && actor.projectId === project.id && actor.workspaceId === project.workspaceId
    && isActive(actor.expiresAt, now)
    && (actor.role === 'viewer' || actor.role === 'collaborator' || actor.role === 'owner')) {
    if (capability === 'view' || capability === 'comment' || actor.role === 'owner'
      || (capability === 'edit' && actor.role === 'collaborator')) return true;
  }

  if (!isRecord(share) || !isId(share.projectId) || !isId(share.presentationId)
    || share.projectId !== project.id || share.presentationId !== presentationId
    || !isActive(share.expiresAt, now) || share.revoked !== false
    || typeof share.tokenVerified !== 'boolean' || typeof share.allowComments !== 'boolean') return false;
  if (share.mode !== 'public' && share.mode !== 'token') return false;
  if (share.mode === 'token' && share.tokenVerified !== true) return false;
  return capability === 'view' || (capability === 'comment' && share.allowComments === true);
}
