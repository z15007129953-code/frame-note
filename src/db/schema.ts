import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, integer, bigint, doublePrecision, boolean, index, unique, primaryKey, foreignKey, check } from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const title = () => text('title').notNull();
export const workspaces = pgTable('workspaces', { id: id(), title: title(), createdAt: createdAt() }, t => [check('workspaces_title_check', sql`length(btrim(${t.title})) between 1 and 160`)]);
export const members = pgTable('members', {
  id: id(), workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }), createdAt: createdAt(),
}, t => [unique().on(t.workspaceId, t.id)]);
export const projects = pgTable('projects', {
  id: id(), workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id), title: title(),
  expiresAt: timestamp('expires_at', { withTimezone: true }), createdAt: createdAt(),
}, t => [unique().on(t.workspaceId, t.id), check('projects_title_check', sql`length(btrim(${t.title})) between 1 and 160`)]);
export const projectMembers = pgTable('project_members', {
  workspaceId: uuid('workspace_id').notNull(), projectId: uuid('project_id').notNull(), memberId: uuid('member_id').notNull(),
  role: text('role').$type<'viewer' | 'collaborator' | 'owner'>().notNull(),
}, t => [
  primaryKey({ columns: [t.workspaceId, t.projectId, t.memberId] }),
  foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id] }),
  check('project_members_role_check', sql`${t.role} in ('viewer', 'collaborator', 'owner')`),
]);
export const demoSessions = pgTable('demo_sessions', {
  tokenHash: text('token_hash').primaryKey(), workspaceId: uuid('workspace_id').notNull(),
  projectId: uuid('project_id').notNull(), memberId: uuid('member_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), createdAt: createdAt(),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id] }),
  check('demo_sessions_token_hash_check', sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
]);
export const presentations = pgTable('presentations', {
  id: id(), workspaceId: uuid('workspace_id').notNull(), projectId: uuid('project_id').notNull(), title: title(), createdAt: createdAt(),
}, t => [unique().on(t.workspaceId, t.projectId, t.id),
  foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  check('presentations_title_check', sql`length(btrim(${t.title})) between 1 and 160`),
]);
export const screens = pgTable('screens', {
  id: id(), workspaceId: uuid('workspace_id').notNull(), projectId: uuid('project_id').notNull(),
  presentationId: uuid('presentation_id').notNull(), title: title(), position: integer('position').notNull(), createdAt: createdAt(),
}, t => [unique().on(t.workspaceId, t.projectId, t.id),
  // SQL migration makes this constraint DEFERRABLE; Drizzle's schema DSL cannot express that attribute.
  unique('screens_presentation_position').on(t.presentationId, t.position),
  foreignKey({ columns: [t.workspaceId, t.projectId, t.presentationId], foreignColumns: [presentations.workspaceId, presentations.projectId, presentations.id] }),
  check('screens_title_check', sql`length(btrim(${t.title})) between 1 and 160`), check('screens_position_check', sql`${t.position} between 0 and 99`),
]);
export const assets = pgTable('assets', {
  id: id(), workspaceId: uuid('workspace_id').notNull(), projectId: uuid('project_id').notNull(),
  storageKey: text('storage_key').notNull().unique(), mimeType: text('mime_type').notNull(), byteSize: bigint('byte_size', { mode: 'bigint' }).notNull(),
  width: integer('width').notNull(), height: integer('height').notNull(), status: text('status').$type<'pending' | 'ready'>().notNull(), createdAt: createdAt(),
}, t => [unique().on(t.workspaceId, t.projectId, t.id),
  foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  check('assets_storage_key_check', sql`length(${t.storageKey}) > 0`),
  check('assets_mime_type_check', sql`${t.mimeType} in ('image/png', 'image/jpeg', 'image/webp')`),
  check('assets_byte_size_check', sql`${t.byteSize} > 0`), check('assets_width_check', sql`${t.width} > 0`), check('assets_height_check', sql`${t.height} > 0`),
  check('assets_status_check', sql`${t.status} in ('pending', 'ready')`),
]);
export const versions = pgTable('versions', {
  id: id(), workspaceId: uuid('workspace_id').notNull(), projectId: uuid('project_id').notNull(),
  screenId: uuid('screen_id').notNull(), assetId: uuid('asset_id').notNull(), number: integer('number').notNull(), createdAt: createdAt(),
}, t => [unique().on(t.workspaceId, t.projectId, t.id), unique().on(t.screenId, t.number), unique().on(t.screenId, t.assetId),
  foreignKey({ columns: [t.workspaceId, t.projectId, t.screenId], foreignColumns: [screens.workspaceId, screens.projectId, screens.id] }),
  foreignKey({ columns: [t.workspaceId, t.projectId, t.assetId], foreignColumns: [assets.workspaceId, assets.projectId, assets.id] }),
  check('versions_number_check', sql`${t.number} between 1 and 50`),
]);
export const commentThreads = pgTable('comment_threads', {
  id: id(), workspaceId: uuid('workspace_id').notNull(), projectId: uuid('project_id').notNull(),
  versionId: uuid('version_id').notNull(), x: doublePrecision('x').notNull(), y: doublePrecision('y').notNull(),
  resolved: boolean('resolved').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, t => [
  unique().on(t.workspaceId, t.projectId, t.versionId, t.id),
  foreignKey({ columns: [t.workspaceId, t.projectId, t.versionId], foreignColumns: [versions.workspaceId, versions.projectId, versions.id] }),
  check('comment_threads_x_check', sql`${t.x} between 0 and 1`),
  check('comment_threads_y_check', sql`${t.y} between 0 and 1`),
  index('comment_threads_version_order').on(t.workspaceId, t.projectId, t.versionId, t.createdAt, t.id),
]);
export const commentMessages = pgTable('comment_messages', {
  id: id(), workspaceId: uuid('workspace_id').notNull(), projectId: uuid('project_id').notNull(),
  versionId: uuid('version_id').notNull(), threadId: uuid('thread_id').notNull(), authorId: uuid('author_id').notNull(),
  body: text('body').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.projectId, t.versionId, t.threadId], foreignColumns: [commentThreads.workspaceId, commentThreads.projectId, commentThreads.versionId, commentThreads.id] }),
  // Author identity survives project membership revocation; writes check live membership transactionally.
  foreignKey({ columns: [t.workspaceId, t.authorId], foreignColumns: [members.workspaceId, members.id] }),
  check('comment_messages_body_check', sql`length(btrim(${t.body})) between 1 and 2000`),
  index('comment_messages_thread_order').on(t.workspaceId, t.projectId, t.versionId, t.threadId, t.createdAt, t.id),
]);
