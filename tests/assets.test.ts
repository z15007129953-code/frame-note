import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
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

const url = assertTestTarget(process.env.TEST_DATABASE_URL, process.env);
const connection = createConnection(url);
const { sql } = connection;
try {
  assertResolvedTestTarget(url, sql.options);
  const rows = await sql`select current_database() as name, host(inet_server_addr()) as address, inet_server_port() as port`;
  assertServerIdentity({ name: rows[0]?.name, address: rows[0]?.address, port: rows[0]?.port }, process.env.FRAME_TEST_TRANSPORT);
} catch (error) { await sql.end(); throw error; }
const directory = await mkdtemp(join(tmpdir(), 'frame-note-assets-'));
const store = await LocalImageStore.open(directory);
const repository = new AssetRepository(connection, store);
const reviews = new ReviewRepository(connection);
const png = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#123456' } }).png().toBuffer();
before(async () => { await migrate(connection); });
after(async () => { await sql.end(); await rm(directory, { recursive: true }); });
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;
async function fixture() {
  const workspaceId = randomUUID(); const memberId = randomUUID();
  await sql`insert into workspaces (id, title) values (${workspaceId}, 'Image fixture')`;
  await sql`insert into members (id, workspace_id) values (${memberId}, ${workspaceId})`;
  const project = await reviews.createProject(workspaceId, memberId, 'Images');
  return { workspaceId, memberId, projectId: project.id };
}
async function upload(f: Awaited<ReturnType<typeof fixture>>) {
  return repository.upload(f.workspaceId, f.projectId, f.memberId, png, 'image/png');
}

async function screenFixture() {
  const f = await fixture();
  const presentation = await reviews.createPresentation(f.workspaceId, f.projectId, f.memberId, 'Versions');
  const screen = await reviews.createScreen(f.workspaceId, f.projectId, presentation.id, f.memberId, 'Screen');
  return { ...f, screenId: screen.id };
}

test('uploadVersion commits two distinct readable assets and preserves the first version', async () => {
  const f = await screenFixture();
  const first = await repository.uploadVersion(f.workspaceId, f.projectId, f.screenId, f.memberId, png, 'image/png');
  const original = (await sql`select * from versions where id = ${first.id}`)[0]!;
  const secondPng = await sharp({ create: { width: 40, height: 50, channels: 3, background: '#abcdef' } }).png().toBuffer();
  const second = await repository.uploadVersion(f.workspaceId, f.projectId, f.screenId, f.memberId, secondPng, 'image/png');
  assert.equal(first.number, 1); assert.equal(second.number, 2);
  assert.notEqual(first.id, second.id);
  assert.deepEqual((await sql`select * from versions where id = ${first.id}`)[0], original);
  const rows = await sql`select v.asset_id, a.status from versions v join assets a on a.id = v.asset_id
    where v.screen_id = ${f.screenId} order by v.number`;
  assert.equal(rows.length, 2); assert.notEqual(rows[0]!.asset_id, rows[1]!.asset_id);
  assert.ok(rows.every(row => row.status === 'ready'));
  assert.equal((await repository.read(f.workspaceId, f.projectId, f.memberId, rows[0]!.asset_id)).width, 20);
  assert.equal((await repository.read(f.workspaceId, f.projectId, f.memberId, rows[1]!.asset_id)).width, 40);
  assert.equal((await sql`select count(*)::int as count from assets where project_id = ${f.projectId}`)[0]!.count, 2);
});

test('uploadVersion rejects missing and foreign screens before decoding or writing an asset', async () => {
  const f = await screenFixture(); const foreign = await screenFixture();
  const otherProject = await reviews.createProject(f.workspaceId, f.memberId, 'Other project');
  const otherPresentation = await reviews.createPresentation(f.workspaceId, otherProject.id, f.memberId, 'Other');
  const otherScreen = await reviews.createScreen(f.workspaceId, otherProject.id, otherPresentation.id, f.memberId, 'Other');
  const files = await readdir(directory);
  for (const screenId of [randomUUID(), foreign.screenId, otherScreen.id]) {
    await assert.rejects(repository.uploadVersion(f.workspaceId, f.projectId, screenId, f.memberId, png, 'image/png'), code('not-found'));
    await assert.rejects(repository.uploadVersion(f.workspaceId, f.projectId, screenId, f.memberId, Buffer.from('invalid'), 'image/png'), code('not-found'));
  }
  assert.deepEqual(await readdir(directory), files);
  assert.equal((await sql`select count(*)::int as count from assets where project_id = ${f.projectId}`)[0]!.count, 0);
});

test('uploadVersion serializes the last available version and rejects full screens before decoding or storage', async () => {
  const f = await screenFixture();
  await sql`with seeded as (
    insert into assets (workspace_id,project_id,storage_key,mime_type,byte_size,width,height,status)
    select ${f.workspaceId}::uuid, ${f.projectId}::uuid, gen_random_uuid()::text, 'image/png', 1, 1, 1, 'ready'
    from generate_series(1,49) returning id
  ) insert into versions (workspace_id,project_id,screen_id,asset_id,number)
    select ${f.workspaceId}::uuid, ${f.projectId}::uuid, ${f.screenId}::uuid, id, row_number() over () from seeded`;
  const files = await readdir(directory);
  const results = await Promise.allSettled([
    repository.uploadVersion(f.workspaceId, f.projectId, f.screenId, f.memberId, png, 'image/png'),
    repository.uploadVersion(f.workspaceId, f.projectId, f.screenId, f.memberId, png, 'image/png'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(results.some(result => result.status === 'rejected' && code('invalid')(result.reason)));
  assert.equal((await readdir(directory)).length, files.length + 1);
  const fullFiles = await readdir(directory);
  await assert.rejects(repository.uploadVersion(f.workspaceId, f.projectId, f.screenId, f.memberId, Buffer.from('invalid'), 'image/png'), code('invalid'));
  assert.deepEqual(await readdir(directory), fullFiles);
  assert.equal((await sql`select count(*)::int as count from assets where project_id = ${f.projectId}`)[0]!.count, 50);
  assert.equal((await sql`select count(*)::int as count from versions where screen_id = ${f.screenId}`)[0]!.count, 50);
});

test('uploadVersion uses persisted editing permission before decoding or storing bytes', async () => {
  const f = await screenFixture(); const foreign = await fixture();
  const files = await readdir(directory);
  await assert.rejects(repository.uploadVersion(f.workspaceId, f.projectId, f.screenId, foreign.memberId, png, 'image/png'), code('forbidden'));
  await sql`update project_members set role = 'viewer' where project_id = ${f.projectId} and member_id = ${f.memberId}`;
  await assert.rejects(repository.uploadVersion(f.workspaceId, f.projectId, f.screenId, f.memberId, Buffer.from('invalid'), 'image/png'), code('forbidden'));
  await sql`delete from project_members where project_id = ${f.projectId} and member_id = ${f.memberId}`;
  await assert.rejects(repository.uploadVersion(f.workspaceId, f.projectId, f.screenId, f.memberId, png, 'image/png'), code('forbidden'));
  assert.deepEqual(await readdir(directory), files);
  assert.equal((await sql`select count(*)::int as count from assets where project_id = ${f.projectId}`)[0]!.count, 0);
});

test('uploadVersion rechecks expiry after real file I/O and rolls back all database writes', async t => {
  const f = await screenFixture();
  await sql`update members set expires_at = clock_timestamp() + interval '1 second' where id = ${f.memberId}`;
  const delayedStore = await LocalImageStore.open(directory);
  const original = delayedStore.put.bind(delayedStore);
  t.mock.method(delayedStore, 'put', async (input: Parameters<typeof original>[0]) => {
    const key = await original(input);
    await sql`select pg_sleep(greatest(extract(epoch from expires_at - clock_timestamp()), 0)::double precision + 0.02)
      from members where id = ${f.memberId}`;
    return key;
  });
  const files = await readdir(directory);
  await assert.rejects(new AssetRepository(connection, delayedStore)
    .uploadVersion(f.workspaceId, f.projectId, f.screenId, f.memberId, png, 'image/png'), code('forbidden'));
  assert.equal((await sql`select count(*)::int as count from assets where project_id = ${f.projectId}`)[0]!.count, 0);
  assert.equal((await sql`select count(*)::int as count from versions where screen_id = ${f.screenId}`)[0]!.count, 0);
  // An uncertain transaction outcome must never trigger destructive file cleanup.
  assert.equal((await readdir(directory)).length, files.length + 1);
});

test('real uploaded image persists, reopens, and can become a screen version', async () => {
  const f = await fixture(); const image = await upload(f);
  assert.equal(image.status, 'ready');
  assert.equal(image.width, 20); assert.equal(image.height, 30);
  assert.equal(image.mimeType, 'image/png');
  const presentation = await reviews.createPresentation(f.workspaceId, f.projectId, f.memberId, 'Review');
  const screen = await reviews.createScreen(f.workspaceId, f.projectId, presentation.id, f.memberId, 'One');
  const version = await reviews.addVersion(f.workspaceId, f.projectId, screen.id, f.memberId, image.id);
  assert.equal(version.assetId, image.id);
  const reopened = createConnection(url);
  try {
    const read = await new AssetRepository(reopened, await LocalImageStore.open(directory))
      .read(f.workspaceId, f.projectId, f.memberId, image.id);
    assert.equal(read.mimeType, 'image/png');
    assert.equal((await sharp(read.bytes).metadata()).width, 20);
    assert.equal(BigInt(read.bytes.length), BigInt(image.byteSize));
  } finally { await reopened.sql.end(); }
});

test('viewer can read but not upload; collaborator can upload and revoked membership denies access', async () => {
  const f = await fixture(); const image = await upload(f);
  await sql`update project_members set role = 'viewer' where project_id = ${f.projectId} and member_id = ${f.memberId}`;
  assert.equal((await repository.read(f.workspaceId, f.projectId, f.memberId, image.id)).width, 20);
  const files = await readdir(directory);
  await assert.rejects(upload(f), code('forbidden'));
  await assert.rejects(repository.upload(f.workspaceId, f.projectId, f.memberId, Buffer.from('bad'), 'image/png'), code('forbidden'));
  assert.deepEqual(await readdir(directory), files);
  await sql`update project_members set role = 'collaborator' where project_id = ${f.projectId} and member_id = ${f.memberId}`;
  assert.equal((await upload(f)).status, 'ready');
  await sql`delete from project_members where project_id = ${f.projectId} and member_id = ${f.memberId}`;
  await assert.rejects(upload(f), code('forbidden'));
  await assert.rejects(repository.read(f.workspaceId, f.projectId, f.memberId, image.id), code('forbidden'));
});

test('foreign actors/assets and expired projects fail closed', async () => {
  const a = await fixture(); const b = await fixture(); const image = await upload(a);
  await assert.rejects(repository.upload(a.workspaceId, a.projectId, b.memberId, png, 'image/png'), code('forbidden'));
  await assert.rejects(repository.read(b.workspaceId, b.projectId, b.memberId, image.id), code('not-found'));
  await sql`update projects set expires_at = clock_timestamp() where id = ${a.projectId}`;
  await assert.rejects(upload(a), code('forbidden'));
  await assert.rejects(repository.read(a.workspaceId, a.projectId, a.memberId, image.id), code('forbidden'));
});

test('corrupt image or mismatched declaration creates no ready asset', async () => {
  const f = await fixture();
  await assert.rejects(repository.upload(f.workspaceId, f.projectId, f.memberId, Buffer.from('invalid'), 'image/png'));
  await assert.rejects(repository.upload(f.workspaceId, f.projectId, f.memberId, png, 'image/jpeg'));
  assert.equal((await sql`select count(*)::int as count from assets where project_id = ${f.projectId}`)[0]!.count, 0);
});

test('concurrent upload count quota is serialized and pending assets count', async () => {
  const f = await fixture();
  await sql`insert into assets (workspace_id,project_id,storage_key,mime_type,byte_size,width,height,status)
    select ${f.workspaceId}::uuid, ${f.projectId}::uuid, gen_random_uuid()::text, 'image/png', 1, 1, 1, 'pending'
    from generate_series(1,499)`;
  const files = await readdir(directory);
  const results = await Promise.allSettled([upload(f), upload(f)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.ok(results.some(r => r.status === 'rejected' && code('invalid')(r.reason)));
  assert.equal((await sql`select count(*)::int as count from assets where project_id = ${f.projectId}`)[0]!.count, 500);
  assert.equal((await readdir(directory)).length, files.length + 1);
});

test('canonical byte quota is inclusive and concurrent uploads cannot exceed it', async () => {
  const source = await sharp(png).withMetadata().png().toBuffer();
  const canonical = await sharp(source).autoOrient().png().toBuffer();
  assert.ok(source.length > canonical.length);
  const f = await fixture();
  await sql`insert into assets (workspace_id,project_id,storage_key,mime_type,byte_size,width,height,status)
    values (${f.workspaceId},${f.projectId},${randomUUID()},'image/png',${100 * 1024 * 1024 - canonical.length},1,1,'pending')`;
  const files = await readdir(directory);
  const results = await Promise.allSettled([
    repository.upload(f.workspaceId, f.projectId, f.memberId, source, 'image/png'),
    repository.upload(f.workspaceId, f.projectId, f.memberId, source, 'image/png'),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.some(r => r.status === 'rejected' && code('invalid')(r.reason)));
  assert.equal((await readdir(directory)).length, files.length + 1);
  assert.equal(BigInt((await sql`select sum(byte_size)::text as total from assets where project_id = ${f.projectId}`)[0]!.total), 100n * 1024n * 1024n);
});

test('canonical byte quota denies upload without inserting an asset', async () => {
  const f = await fixture();
  await sql`insert into assets (workspace_id,project_id,storage_key,mime_type,byte_size,width,height,status)
    values (${f.workspaceId},${f.projectId},${randomUUID()},'image/png',${100 * 1024 * 1024},1,1,'pending')`;
  const files = await readdir(directory);
  await assert.rejects(upload(f), code('invalid'));
  assert.deepEqual(await readdir(directory), files);
  assert.equal((await sql`select count(*)::int as count from assets where project_id = ${f.projectId}`)[0]!.count, 1);
});

test('missing backing file does not produce a successful read', async () => {
  const f = await fixture(); const image = await upload(f);
  // This removes only the exact disposable fixture file produced by this test.
  await rm(join(directory, image.storageKey));
  await assert.rejects(repository.read(f.workspaceId, f.projectId, f.memberId, image.id));
});

test('expired member cannot upload or read an existing image', async () => {
  const f = await fixture(); const image = await upload(f);
  await sql`update members set expires_at = clock_timestamp() where id = ${f.memberId}`;
  await assert.rejects(upload(f), code('forbidden'));
  await assert.rejects(repository.read(f.workspaceId, f.projectId, f.memberId, image.id), code('forbidden'));
});

test('same workspace does not grant access to another project asset', async () => {
  const f = await fixture(); const image = await upload(f);
  const other = await reviews.createProject(f.workspaceId, f.memberId, 'Other');
  await assert.rejects(repository.read(f.workspaceId, other.id, f.memberId, image.id), code('not-found'));
});

test('stored byte-size disagreement fails closed', async () => {
  const f = await fixture(); const image = await upload(f);
  await sql`update assets set byte_size = byte_size + 1 where id = ${image.id}`;
  await assert.rejects(repository.read(f.workspaceId, f.projectId, f.memberId, image.id));
});

test('malformed UUIDs fail at every upload and read boundary', async () => {
  const f = await fixture();
  const base = [f.workspaceId, f.projectId, f.memberId] as const;
  for (let index = 0; index < base.length; index++) {
    const args = [...base] as [string, string, string]; args[index] = 'not-a-uuid';
    await assert.rejects(repository.upload(...args, png, 'image/png'), code('invalid'));
    await assert.rejects(repository.read(...args, randomUUID()), code('invalid'));
  }
  await assert.rejects(repository.read(...base, 'not-a-uuid'), code('invalid'));
});

test('pending assets cannot be read even when a backing file exists', async () => {
  const f = await fixture(); const image = await upload(f);
  await sql`update assets set status = 'pending' where id = ${image.id}`;
  await assert.rejects(repository.read(f.workspaceId, f.projectId, f.memberId, image.id), code('not-found'));
});

test('caller byte mutation during authorization cannot change the uploaded image', async () => {
  const f = await fixture(); const bytes = Buffer.from(png);
  const uploading = repository.upload(f.workspaceId, f.projectId, f.memberId, bytes, 'image/png');
  bytes.fill(0);
  const image = await uploading;
  const read = await repository.read(f.workspaceId, f.projectId, f.memberId, image.id);
  assert.equal((await sharp(read.bytes).metadata()).width, 20);
});

for (const operation of ['upload', 'read'] as const) {
  test(`${operation} rechecks expiry after waiting for a project or asset lock`, async () => {
    const f = await fixture(); const image = await upload(f);
    await sql`update members set expires_at = clock_timestamp() + interval '1 second' where id = ${f.memberId}`;
    const blocker = await sql.reserve();
    let pending: Promise<unknown> | undefined;
    try {
      await blocker`begin`;
      const pid = (await blocker`select pg_backend_pid() as pid`)[0]!.pid;
      if (operation === 'upload') await blocker`select id from projects where id = ${f.projectId} for update`;
      else await blocker`select id from assets where id = ${image.id} for update`;
      pending = (operation === 'upload' ? upload(f) : repository.read(f.workspaceId, f.projectId, f.memberId, image.id))
        .then(() => ({ error: null }), error => ({ error }));
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await sql`select exists(select 1 from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))) as blocked`)[0]!.blocked) {
          blocked = true; break;
        }
        await sql`select pg_sleep(0.01)`;
      }
      assert.ok(blocked, 'The repository must actually wait for the resource lock');
      await blocker`select pg_sleep(greatest(extract(epoch from expires_at - clock_timestamp()), 0)::double precision + 0.02)
        from members where id = ${f.memberId}`;
      await blocker`commit`;
      assert.ok(code('forbidden')((await pending as { error: unknown }).error));
    } finally {
      await blocker`rollback`; blocker.release(); await pending;
    }
  });
}

for (const operation of ['put', 'read'] as const) {
  test(`${operation} finishing after actor expiry cannot return success`, async t => {
    const f = await fixture(); const image = await upload(f);
    await sql`update members set expires_at = clock_timestamp() + interval '1 second' where id = ${f.memberId}`;
    // Keep real filesystem I/O, pausing only its completion to exercise the expiry boundary deterministically.
    const delayedStore = await LocalImageStore.open(directory);
    const original = delayedStore[operation].bind(delayedStore);
    t.mock.method(delayedStore, operation, async (input: never) => {
      const result = await original(input);
      await sql`select pg_sleep(greatest(extract(epoch from expires_at - clock_timestamp()), 0)::double precision + 0.02)
        from members where id = ${f.memberId}`;
      return result;
    });
    const delayed = new AssetRepository(connection, delayedStore);
    const operationPromise = operation === 'put'
      ? delayed.upload(f.workspaceId, f.projectId, f.memberId, png, 'image/png')
      : delayed.read(f.workspaceId, f.projectId, f.memberId, image.id);
    await assert.rejects(operationPromise, code('forbidden'));
    assert.equal((await sql`select count(*)::int as count from assets where project_id = ${f.projectId}`)[0]!.count, 1);
  });
}
