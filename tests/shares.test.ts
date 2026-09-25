import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import sharp from 'sharp';
import { createConnection } from '../src/db/connection.ts';
import { migrate } from '../src/db/migrate.ts';
import { assertTestTarget } from '../src/db/test-target.ts';
import { assertResolvedTestTarget, assertServerIdentity } from '../src/db/server-identity.ts';
import { ReviewRepository } from '../src/db/review-repository.ts';
import { AssetRepository } from '../src/db/asset-repository.ts';
import { LocalImageStore } from '../src/storage/local-image-store.ts';
import { StorageError } from '../src/storage/errors.ts';

const url = assertTestTarget(process.env.TEST_DATABASE_URL, process.env);
const connection = createConnection(url);
const { sql } = connection;
try {
  assertResolvedTestTarget(url, sql.options);
  const [identity] = await sql`select current_database() as name, host(inet_server_addr()) as address, inet_server_port() as port`;
  assertServerIdentity({ name: identity?.name, address: identity?.address, port: identity?.port }, process.env.FRAME_TEST_TRANSPORT);
} catch (error) { await sql.end(); throw error; }
const directory = await mkdtemp(join(tmpdir(), 'frame-note-shares-'));
const store = await LocalImageStore.open(directory);
const reviews = new ReviewRepository(connection);
const assets = new AssetRepository(connection, store);
const png = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#123456' } }).png().toBuffer();
before(async () => { await migrate(connection); });
after(async () => { await sql.end(); await rm(directory, { recursive: true }); });
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;
async function repository(imageStore = store) {
  const { ShareRepository } = await import('../src/db/share-repository.ts');
  return new ShareRepository(connection, imageStore);
}
async function fixture() {
  const workspaceId = randomUUID(); const memberId = randomUUID();
  await sql`insert into workspaces (id, title) values (${workspaceId}, 'Share fixture')`;
  await sql`insert into members (id, workspace_id) values (${memberId}, ${workspaceId})`;
  const project = await reviews.createProject(workspaceId, memberId, 'Shares');
  const actor = { workspaceId, memberId, projectId: project.id };
  const presentation = await reviews.createPresentation(workspaceId, project.id, memberId, 'Shared review');
  const screen = await reviews.createScreen(workspaceId, project.id, presentation.id, memberId, 'Screen');
  await assets.uploadVersion(workspaceId, project.id, screen.id, memberId, png, 'image/png');
  return { actor, presentationId: presentation.id, screenId: screen.id };
}

test('share repository is available', async () => {
  await assert.doesNotReject(repository(), 'Persistent share repository must exist');
});

test('transient storage failures remain retryable while missing images are hidden', async () => {
  const f = await fixture(); const repo = await repository(); const link = await repo.create(f.actor, f.presentationId, 1);
  const [asset] = await sql`select asset_id from versions where screen_id = ${f.screenId}`;
  const original = store.read.bind(store);
  try {
    store.read = async () => { throw new StorageError('storage-failed'); };
    await assert.rejects(repo.read(link.id, link.token, asset!.asset_id), code('storage-failed'));
    store.read = async () => { throw new StorageError('not-found'); };
    await assert.rejects(repo.read(link.id, link.token, asset!.asset_id), code('not-found'));
  } finally { store.read = original; }
});

test('storage initialization failure cannot prevent listing or revoking a share', async () => {
  const f = await fixture(); const { ShareRepository } = await import('../src/db/share-repository.ts');
  let attempts = 0;
  const repo = new ShareRepository(connection, async () => { attempts++; throw new StorageError('storage-failed'); });
  const link = await repo.create(f.actor, f.presentationId, 1);
  assert.equal((await repo.list(f.actor, f.presentationId)).length, 1);
  const snapshot = await repo.snapshot(link.id, link.token);
  assert.equal(attempts, 0);
  const assetId = snapshot.presentation.screens[0]!.versions[0]!.assetId;
  await assert.rejects(repo.read(link.id, link.token, assetId), code('storage-failed'));
  assert.equal(attempts, 1);
  await repo.revoke(f.actor, link.id);
  assert.equal((await repo.list(f.actor, f.presentationId))[0]!.revoked, true);
  await assert.rejects(repo.read(link.id, link.token, assetId), code('not-found'));
  assert.equal(attempts, 1, 'Revoked reads must not initialize storage');
});

test('bearer creation stores only a SHA256 hash and snapshot exposes exactly one presentation and all its versions', async () => {
  const repo = await repository(); const f = await fixture();
  const other = await reviews.createPresentation(f.actor.workspaceId, f.actor.projectId, f.actor.memberId, 'Private');
  await assets.uploadVersion(f.actor.workspaceId, f.actor.projectId, f.screenId, f.actor.memberId, png, 'image/png');
  const beforeMembers = await sql`select count(*)::int as count from members`;
  const start = Date.now(); const link = await repo.create(f.actor, f.presentationId, 1);
  assert.match(link.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(Date.parse(link.expiresAt) >= start + 3599000 && Date.parse(link.expiresAt) <= Date.now() + 3600000);
  const [saved] = await sql`select * from shares where id = ${link.id}`;
  assert.equal(saved!.token_hash, createHash('sha256').update(link.token).digest('hex'));
  assert.ok(!JSON.stringify(saved).includes(link.token));
  assert.equal(saved!.issuer_id, f.actor.memberId);
  const snapshot = await repo.snapshot(link.id, link.token);
  assert.deepEqual(Object.keys(snapshot).sort(), ['allowComments', 'expiresAt', 'presentation']);
  assert.equal(snapshot.presentation.id, f.presentationId);
  assert.ok(!JSON.stringify(snapshot).includes(other.id));
  assert.equal(snapshot.presentation.screens[0]!.versions.length, 2);
  for (const version of snapshot.presentation.screens[0]!.versions) {
    const image = await repo.read(link.id, link.token, version.assetId);
    assert.deepEqual(image, { bytes: png, mimeType: 'image/png', width: 20, height: 30 });
  }
  assert.deepEqual(await sql`select count(*)::int as count from members`, beforeMembers);
  assert.deepEqual(await repo.list(f.actor, f.presentationId), [{ id: link.id, expiresAt: link.expiresAt, revoked: false, allowComments: false }]);
});

test('new shares default to read-only and persist an explicit comment opt-in', async () => {
  const repo = await repository(); const f = await fixture();
  const readOnly = await repo.create(f.actor, f.presentationId, 1);
  const [defaultRow] = await sql`select allow_comments from shares where id = ${readOnly.id}`;
  assert.equal(defaultRow!.allow_comments, false);

  const tokenHash = createHash('sha256').update(randomUUID()).digest('hex');
  const [optedIn] = await sql`insert into shares
    (workspace_id, project_id, presentation_id, issuer_id, token_hash, expires_at, allow_comments)
    values (${f.actor.workspaceId}, ${f.actor.projectId}, ${f.presentationId}, ${f.actor.memberId}, ${tokenHash}, clock_timestamp() + interval '1 hour', true)
    returning allow_comments`;
  assert.equal(optedIn!.allow_comments, true);
});

test('guest invalid IDs, malformed/wrong tokens and foreign assets fail uniformly without exposing orphan or pending assets', async () => {
  const repo = await repository(); const f = await fixture(); const foreign = await fixture();
  const link = await repo.create(f.actor, f.presentationId, 24);
  const second = await reviews.createPresentation(f.actor.workspaceId, f.actor.projectId, f.actor.memberId, 'Other');
  const screen = await reviews.createScreen(f.actor.workspaceId, f.actor.projectId, second.id, f.actor.memberId, 'Other screen');
  await assets.uploadVersion(f.actor.workspaceId, f.actor.projectId, screen.id, f.actor.memberId, png, 'image/png');
  const orphan = await assets.upload(f.actor.workspaceId, f.actor.projectId, f.actor.memberId, png, 'image/png');
  const [otherAsset] = await sql`select asset_id from versions where screen_id = ${screen.id}`;
  const [foreignAsset] = await sql`select asset_id from versions where screen_id = ${foreign.screenId}`;
  const [sharedAsset] = await sql`select asset_id from versions where screen_id = ${f.screenId}`;
  for (const token of ['', 'bad', 'a'.repeat(43), link.token + '=', ' ' + link.token, null, 42]) {
    await assert.rejects(repo.snapshot(link.id, token as string), code('not-found'));
    await assert.rejects(repo.read(link.id, token as string, sharedAsset!.asset_id), code('not-found'));
  }
  for (const id of ['bad', randomUUID()]) await assert.rejects(repo.snapshot(id, link.token), code('not-found'));
  for (const id of ['bad', undefined, null, randomUUID(), orphan.id, otherAsset!.asset_id, foreignAsset!.asset_id]) {
    await assert.rejects(repo.read(link.id, link.token, id as string), code('not-found'));
  }
  await sql`update assets set status = 'pending' where id = ${sharedAsset!.asset_id}`;
  await assert.rejects(repo.read(link.id, link.token, sharedAsset!.asset_id), code('not-found'));
  assert.deepEqual((await repo.snapshot(link.id, link.token)).presentation.screens[0]!.versions, []);
});

test('owner management uses persisted role and scoped targets; issuer downgrade or revocation blocks guests', async () => {
  const repo = await repository(); const f = await fixture(); const other = await fixture();
  const link = await repo.create(f.actor, f.presentationId, 1);
  for (const role of ['viewer', 'collaborator']) {
    await sql`update project_members set role = ${role} where member_id = ${f.actor.memberId}`;
    await assert.rejects(repo.create(f.actor, f.presentationId, 1), code('forbidden'));
    await assert.rejects(repo.list(f.actor, f.presentationId), code('forbidden'));
    await assert.rejects(repo.revoke(f.actor, link.id), code('forbidden'));
    await assert.rejects(repo.snapshot(link.id, link.token), code('not-found'));
  }
  await sql`update project_members set role = 'owner' where member_id = ${f.actor.memberId}`;
  await assert.rejects(repo.create(f.actor, other.presentationId, 1), code('not-found'));
  await assert.rejects(repo.list(f.actor, other.presentationId), code('not-found'));
  await assert.rejects(repo.revoke(other.actor, link.id), code('not-found'));
  await assert.rejects(repo.create(f.actor, f.presentationId, 2 as 1), code('invalid'));
  await assert.rejects(repo.create(f.actor, 'bad', 1), code('invalid'));
  await assert.rejects(repo.list(f.actor, 'bad'), code('invalid'));
  await assert.rejects(repo.revoke(f.actor, 'bad'), code('invalid'));
  await repo.revoke(f.actor, link.id); await repo.revoke(f.actor, link.id);
  assert.equal((await repo.list(f.actor, f.presentationId))[0]!.revoked, true);
  await assert.rejects(repo.snapshot(link.id, link.token), code('not-found'));
});

test('share expiry is capped to member/project expiry and enforced with live issuer membership', async () => {
  const repo = await repository(); const f = await fixture();
  await sql`update projects set expires_at = clock_timestamp() + interval '2 hours' where id = ${f.actor.projectId}`;
  await sql`update members set expires_at = clock_timestamp() + interval '1 hour' where id = ${f.actor.memberId}`;
  const link = await repo.create(f.actor, f.presentationId, 24);
  const [member] = await sql`select expires_at from members where id = ${f.actor.memberId}`;
  assert.equal(link.expiresAt, new Date(member!.expires_at).toISOString());
  await sql`update shares set expires_at = clock_timestamp() - interval '1 second' where id = ${link.id}`;
  await assert.rejects(repo.snapshot(link.id, link.token), code('not-found'));
  const another = await repo.create(f.actor, f.presentationId, 1);
  await sql`delete from project_members where member_id = ${f.actor.memberId}`;
  await assert.rejects(repo.snapshot(another.id, another.token), code('not-found'));
});

test('all 20 links including revoked count toward a serialized quota', async () => {
  const repo = await repository(); const f = await fixture();
  for (let n = 0; n < 19; n++) { const link = await repo.create(f.actor, f.presentationId, 1); await repo.revoke(f.actor, link.id); }
  const results = await Promise.allSettled([repo.create(f.actor, f.presentationId, 1), repo.create(f.actor, f.presentationId, 1)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(results.some(result => result.status === 'rejected' && code('invalid')(result.reason)));
  assert.equal((await repo.list(f.actor, f.presentationId)).length, 20);
});

test('database composite scopes reject foreign presentations and issuers', async () => {
  const repo = await repository(); const f = await fixture(); const other = await fixture();
  const link = await repo.create(f.actor, f.presentationId, 1);
  await assert.rejects(sql`update shares set presentation_id = ${other.presentationId} where id = ${link.id}`, code('23503'));
  await assert.rejects(sql`update shares set issuer_id = ${other.actor.memberId} where id = ${link.id}`, code('23503'));
});

for (const operation of ['snapshot', 'read', 'create', 'list', 'revoke'] as const) {
  test(`${operation} rechecks expiry after its downstream lock wait`, async () => {
    const repo = await repository(); const f = await fixture(); const link = await repo.create(f.actor, f.presentationId, 1);
    const [asset] = await sql`select asset_id from versions where screen_id = ${f.screenId}`;
    await sql`update projects set expires_at = clock_timestamp() + interval '1 second' where id = ${f.actor.projectId}`;
    const blocker = await sql.reserve(); let pending: Promise<{ error?: unknown }> | undefined;
    try {
      await blocker`begin`; const [pid] = await blocker`select pg_backend_pid() as pid`;
      if (operation === 'create' || operation === 'list') await blocker`select id from presentations where id = ${f.presentationId} for update`;
      else await blocker`select id from shares where id = ${link.id} for update`;
      const action = operation === 'snapshot' ? repo.snapshot(link.id, link.token)
        : operation === 'read' ? repo.read(link.id, link.token, asset!.asset_id)
        : operation === 'create' ? repo.create(f.actor, f.presentationId, 1)
        : operation === 'list' ? repo.list(f.actor, f.presentationId) : repo.revoke(f.actor, link.id);
      pending = action.then(() => ({}), error => ({ error }));
      let blocked = false;
      for (let n = 0; n < 100; n++) {
        const [row] = await sql`select exists(select 1 from pg_stat_activity where ${pid!.pid} = any(pg_blocking_pids(pid))) as blocked`;
        if (row!.blocked) { blocked = true; break; } await sql`select pg_sleep(0.01)`;
      }
      assert.ok(blocked, 'Operation must reach its downstream lock');
      await blocker`select pg_sleep(greatest(extract(epoch from expires_at - clock_timestamp()), 0)::float + 0.02) from projects where id = ${f.actor.projectId}`;
      await blocker`commit`;
      assert.ok(code(operation === 'snapshot' || operation === 'read' ? 'not-found' : 'forbidden')((await pending).error));
      assert.equal((await sql`select count(*)::int as count from shares where presentation_id = ${f.presentationId}`)[0]!.count, 1);
      assert.equal((await sql`select revoked from shares where id = ${link.id}`)[0]!.revoked, false);
    } finally { await blocker`rollback`; blocker.release(); if (pending) await pending; }
  });
}

test('guest read rechecks expiry after file I/O and rejects a mismatched stored byte size', async () => {
  const f = await fixture(); const repo = await repository(); const link = await repo.create(f.actor, f.presentationId, 1);
  const [asset] = await sql`select asset_id from versions where screen_id = ${f.screenId}`;
  await sql`update assets set byte_size = byte_size + 1 where id = ${asset!.asset_id}`;
  await assert.rejects(repo.read(link.id, link.token, asset!.asset_id), code('not-found'));
  await sql`update assets set byte_size = byte_size - 1 where id = ${asset!.asset_id}`;
  const original = store.read.bind(store);
  store.read = async key => { const bytes = await original(key); await sql`select pg_sleep(1.05)`; return bytes; };
  try {
    await sql`update shares set expires_at = clock_timestamp() + interval '1 second' where id = ${link.id}`;
    await assert.rejects(repo.read(link.id, link.token, asset!.asset_id), code('not-found'));
  } finally { store.read = original; }
});

test('revoke waits for an authorized file read and blocks every following read', async () => {
  const f = await fixture(); const repo = await repository(); const link = await repo.create(f.actor, f.presentationId, 1);
  const [asset] = await sql`select asset_id from versions where screen_id = ${f.screenId}`;
  const original = store.read.bind(store);
  let releaseRead!: () => void; let enteredRead!: () => void;
  const entered = new Promise<void>(resolve => { enteredRead = resolve; });
  const release = new Promise<void>(resolve => { releaseRead = resolve; });
  store.read = async key => { const bytes = await original(key); enteredRead(); await release; return bytes; };
  let pendingRead: ReturnType<typeof repo.read> | undefined; let pendingRevoke: Promise<void> | undefined;
  try {
    pendingRead = repo.read(link.id, link.token, asset!.asset_id); await entered;
    pendingRevoke = repo.revoke(f.actor, link.id);
    let blocked = false;
    for (let n = 0; n < 100; n++) {
      const [row] = await sql`select exists(select 1 from pg_stat_activity where datname = current_database()
        and cardinality(pg_blocking_pids(pid)) > 0) as blocked`;
      if (row!.blocked) { blocked = true; break; } await sql`select pg_sleep(0.01)`;
    }
    assert.ok(blocked, 'Revoke waits for the read transaction');
    releaseRead(); assert.deepEqual((await pendingRead).bytes, png); await pendingRevoke;
    await assert.rejects(repo.read(link.id, link.token, asset!.asset_id), code('not-found'));
  } finally { releaseRead(); store.read = original; if (pendingRead) await pendingRead; if (pendingRevoke) await pendingRevoke; }
});

test('guest revalidates a changed token locator after waiting for its share lock', async () => {
  const f = await fixture(); const repo = await repository(); const link = await repo.create(f.actor, f.presentationId, 1);
  const blocker = await sql.reserve(); let pending: Promise<{ error?: unknown }> | undefined;
  try {
    await blocker`begin`; const [pid] = await blocker`select pg_backend_pid() as pid`;
    await blocker`select id from shares where id = ${link.id} for update`;
    pending = repo.snapshot(link.id, link.token).then(() => ({}), error => ({ error }));
    let blocked = false;
    for (let n = 0; n < 100; n++) {
      const [row] = await sql`select exists(select 1 from pg_stat_activity where ${pid!.pid} = any(pg_blocking_pids(pid))) as blocked`;
      if (row!.blocked) { blocked = true; break; } await sql`select pg_sleep(0.01)`;
    }
    assert.ok(blocked);
    await blocker`update shares set token_hash = ${createHash('sha256').update(randomUUID()).digest('hex')} where id = ${link.id}`;
    await blocker`commit`; assert.ok(code('not-found')((await pending).error));
  } finally { await blocker`rollback`; blocker.release(); if (pending) await pending; }
});

test('live issuer and project expiry invalidate an otherwise unexpired link', async () => {
  const f = await fixture(); const repo = await repository(); const link = await repo.create(f.actor, f.presentationId, 1);
  for (const target of ['member', 'project']) {
    if (target === 'member') await sql`update members set expires_at = clock_timestamp() - interval '1 second' where id = ${f.actor.memberId}`;
    else await sql`update projects set expires_at = clock_timestamp() - interval '1 second' where id = ${f.actor.projectId}`;
    await assert.rejects(repo.snapshot(link.id, link.token), code('not-found'));
    await assert.rejects(repo.create(f.actor, f.presentationId, 1), code('forbidden'));
    await sql`update members set expires_at = null where id = ${f.actor.memberId}`;
  }
});
