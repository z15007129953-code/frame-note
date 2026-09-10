import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { createConnection } from '../src/db/connection.ts';
import { migrate } from '../src/db/migrate.ts';
import { assertTestTarget } from '../src/db/test-target.ts';
import { assertResolvedTestTarget, assertServerIdentity } from '../src/db/server-identity.ts';
import { ReviewRepository } from '../src/db/review-repository.ts';

const url = process.env.TEST_DATABASE_URL;
assert.ok(url, 'Set explicit TEST_DATABASE_URL.');
assertTestTarget(url, process.env);
const connection = createConnection(url);
const { sql } = connection;
try {
  assertResolvedTestTarget(url, sql.options);
  const [identity] = await sql`select current_database() as name, host(inet_server_addr()) as address, inet_server_port() as port`;
  assertServerIdentity({ name: identity?.name, address: identity?.address, port: identity?.port }, process.env.FRAME_TEST_TRANSPORT);
} catch (error) { await sql.end(); throw error; }
before(async () => { await migrate(connection); });
after(async () => { await sql.end(); });
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected;

async function repositories() {
  const demoModule = await import('../src/db/demo-repository.ts');
  const workspaceModule = await import('../src/db/workspace-repository.ts');
  return { demo: new demoModule.DemoRepository(connection), workspace: new workspaceModule.WorkspaceRepository(connection) };
}

test('demo repositories are available', async () => {
  await assert.doesNotReject(repositories(), 'The demo backend is implemented');
});

test('demo creation persists only a hash and atomically binds an owner with 24 hour expiry', async () => {
  const { demo } = await repositories();
  const session = await demo.create();
  assert.match(session.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(session.token, 'base64url').length, 32);
  assert.ok(session.expiresAt instanceof Date);
  const [row] = await sql`select s.*, m.expires_at as member_expiry, p.expires_at as project_expiry, pm.role,
    extract(epoch from s.expires_at - clock_timestamp())::float as seconds
    from demo_sessions s join members m on m.id = s.member_id and m.workspace_id = s.workspace_id
    join projects p on p.id = s.project_id and p.workspace_id = s.workspace_id
    join project_members pm on pm.project_id = p.id and pm.workspace_id = s.workspace_id and pm.member_id = m.id
    where s.token_hash = ${hash(session.token)}`;
  assert.ok(row);
  assert.equal(row.role, 'owner');
  assert.deepEqual(new Date(row.expires_at), session.expiresAt);
  assert.deepEqual(new Date(row.member_expiry), session.expiresAt);
  assert.deepEqual(new Date(row.project_expiry), session.expiresAt);
  assert.ok(row.seconds > 86_390 && row.seconds <= 86_400);
  assert.ok(!JSON.stringify(row).includes(session.token));
  assert.deepEqual(await demo.resolve(session.token), session.actor);
});

test('separate demos isolate actors, malformed tokens fail closed, revocation deletes only one session', async () => {
  const { demo, workspace } = await repositories();
  const a = await demo.create(); const b = await demo.create();
  assert.notEqual(a.actor.workspaceId, b.actor.workspaceId);
  assert.notEqual(a.actor.projectId, b.actor.projectId);
  assert.notEqual(a.actor.memberId, b.actor.memberId);
  for (const invalid of ['', 'invalid', randomBytes(32).toString('base64url'), a.token + '=', 'x'.repeat(10000)]) {
    assert.equal(await demo.resolve(invalid), null);
    await demo.revoke(invalid);
  }
  await assert.rejects(workspace.snapshot({ ...a.actor, projectId: b.actor.projectId }), code('not-found'));
  await assert.rejects(workspace.snapshot({ ...a.actor, memberId: b.actor.memberId }), code('forbidden'));
  await demo.revoke(a.token);
  assert.equal(await demo.resolve(a.token), null);
  assert.deepEqual(await demo.resolve(b.token), b.actor);
  for (const [table, id] of [['workspaces', a.actor.workspaceId], ['projects', a.actor.projectId], ['members', a.actor.memberId]]) {
    assert.equal((await sql`select id from ${sql(table!)} where id = ${id!}`).length, 1);
  }
});

for (const scope of ['demo_sessions', 'members', 'projects', 'membership'] as const) {
  test(`demo resolve rechecks persisted ${scope}`, async () => {
    const { demo, workspace } = await repositories();
    const session = await demo.create();
    if (scope === 'membership') {
      await sql`delete from project_members where project_id = ${session.actor.projectId} and member_id = ${session.actor.memberId}`;
    } else if (scope === 'demo_sessions') {
      await sql`update demo_sessions set expires_at = clock_timestamp() where token_hash = ${hash(session.token)}`;
    } else {
      const id = scope === 'members' ? session.actor.memberId : session.actor.projectId;
      await sql`update ${sql(scope)} set expires_at = clock_timestamp() where id = ${id}`;
    }
    assert.equal(await demo.resolve(session.token), null);
    if (scope !== 'demo_sessions') await assert.rejects(workspace.snapshot(session.actor), code('forbidden'));
  });
}

test('snapshot returns bounded project data, real asset dimensions, ordered screens and versions without secrets', async () => {
  const { demo, workspace } = await repositories();
  const { actor } = await demo.create();
  const review = new ReviewRepository(connection);
  assert.deepEqual((await workspace.snapshot(actor)).presentations, []);
  const p = await workspace.createPresentation(actor, '  Design review  ');
  const s1 = await review.createScreen(actor.workspaceId, actor.projectId, p.id, actor.memberId, 'First');
  const s2 = await review.createScreen(actor.workspaceId, actor.projectId, p.id, actor.memberId, 'Second');
  const assetId = randomUUID();
  await sql`insert into assets (id, workspace_id, project_id, storage_key, mime_type, byte_size, width, height, status)
    values (${assetId}, ${actor.workspaceId}, ${actor.projectId}, ${'private/' + assetId}, 'image/png', 100, 1280, 720, 'ready')`;
  const version = await review.addVersion(actor.workspaceId, actor.projectId, s1.id, actor.memberId, assetId);
  await review.reorderScreens(actor.workspaceId, actor.projectId, p.id, actor.memberId, [s2.id, s1.id]);
  const other = await review.createProject(actor.workspaceId, actor.memberId, 'Other project');
  await review.createPresentation(actor.workspaceId, other.id, actor.memberId, 'Invisible');
  const snapshot = await workspace.snapshot(actor);
  assert.equal(snapshot.project.id, actor.projectId);
  assert.deepEqual(Object.keys(snapshot.project).sort(), ['id', 'title']);
  assert.deepEqual(snapshot.presentations, [{ id: p.id, title: 'Design review', screens: [
    { id: s2.id, title: 'Second', position: 0, versions: [] },
    { id: s1.id, title: 'First', position: 1, versions: [{ id: version.id, number: 1, assetId, width: 1280, height: 720 }] },
  ] }]);
  assert.ok(!JSON.stringify(snapshot).includes('private/'));
  await sql`update project_members set role = 'viewer' where project_id = ${actor.projectId} and member_id = ${actor.memberId}`;
  await workspace.snapshot(actor);
  await assert.rejects(workspace.createPresentation(actor, 'Denied'), code('forbidden'));
});

test('presentation validation and concurrent quota enforce the 100 presentation maximum', async () => {
  const { demo, workspace } = await repositories();
  const { actor } = await demo.create();
  for (const title of ['', ' ', 'x'.repeat(161)]) await assert.rejects(workspace.createPresentation(actor, title), code('invalid'));
  await sql`insert into presentations (workspace_id, project_id, title)
    select ${actor.workspaceId}::uuid, ${actor.projectId}::uuid, 'Existing' from generate_series(1, 99)`;
  const outcomes = await Promise.allSettled([workspace.createPresentation(actor, 'Last'), workspace.createPresentation(actor, 'Excess')]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await workspace.snapshot(actor)).presentations.length, 100);
  await sql`insert into presentations (workspace_id, project_id, title) values (${actor.workspaceId}, ${actor.projectId}, 'Legacy excess')`;
  assert.equal((await workspace.snapshot(actor)).presentations.length, 100);
});

test('snapshot includes the maximum 100 screens and 50 versions with stable ordering', async () => {
  const { demo, workspace } = await repositories();
  const { actor } = await demo.create();
  const presentation = await workspace.createPresentation(actor, 'Boundary');
  const screens = await sql`insert into screens (workspace_id, project_id, presentation_id, title, position)
    select ${actor.workspaceId}::uuid, ${actor.projectId}::uuid, ${presentation.id}::uuid, 'Screen ' || n, n from generate_series(0, 99) n
    returning id, position`;
  const screen = screens.find(row => row.position === 0)!;
  const assets = await sql`insert into assets (workspace_id, project_id, storage_key, mime_type, byte_size, width, height, status)
    select ${actor.workspaceId}::uuid, ${actor.projectId}::uuid, 'private/' || gen_random_uuid(), 'image/png', 100, n, n, 'ready'
    from generate_series(1, 50) n returning id, width`;
  for (const asset of assets) await sql`insert into versions (workspace_id, project_id, screen_id, asset_id, number)
    values (${actor.workspaceId}, ${actor.projectId}, ${screen.id}, ${asset.id}, ${asset.width})`;
  const snapshot = await workspace.snapshot(actor);
  const actual = snapshot.presentations[0]!.screens;
  assert.deepEqual(actual.map(row => row.position), Array.from({ length: 100 }, (_, i) => i));
  assert.deepEqual(actual[0]!.versions.map(row => row.number), Array.from({ length: 50 }, (_, i) => i + 1));
  assert.ok(actual[0]!.versions.every(row => row.width === row.number && row.height === row.number));
});

for (const operation of ['snapshot', 'create'] as const) {
  test(`${operation} checks wall clock expiry after waiting for the project lock`, async () => {
    const { demo, workspace } = await repositories();
    const { actor } = await demo.create();
    await sql`update projects set expires_at = clock_timestamp() + interval '1 second' where id = ${actor.projectId}`;
    const blocker = await sql.reserve();
    let pending: Promise<unknown> | undefined;
    try {
      await blocker`begin`;
      const [pid] = await blocker`select pg_backend_pid() as pid`;
      await blocker`select id from projects where id = ${actor.projectId} for update`;
      pending = (operation === 'snapshot' ? workspace.snapshot(actor) : workspace.createPresentation(actor, 'Expired'))
        .then(value => ({ value }), error => ({ error }));
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const [row] = await sql`select exists(select 1 from pg_stat_activity where ${pid!.pid} = any(pg_blocking_pids(pid))) as blocked`;
        if (row!.blocked) { blocked = true; break; }
        await sql`select pg_sleep(0.01)`;
      }
      assert.ok(blocked, 'The operation must wait for the held project lock');
      await blocker`select pg_sleep(greatest(extract(epoch from expires_at - clock_timestamp()), 0)::float + 0.02) from projects where id = ${actor.projectId}`;
      await blocker`commit`;
      const result = await pending as { error?: unknown };
      assert.ok(code('forbidden')(result.error));
      assert.equal((await sql`select count(*)::int as count from presentations where project_id = ${actor.projectId}`)[0]!.count, 0);
    } finally {
      await blocker`rollback`;
      blocker.release();
      if (pending) await pending;
    }
  });
}

test('concurrent demo creation caps total sessions at 1000 and rejected creation leaves no partial workspace', async () => {
  const { demo } = await repositories();
  const { actor } = await demo.create();
  const [initial] = await sql`select count(*)::int as count from demo_sessions`;
  const needed = 999 - initial!.count;
  assert.ok(needed >= 0, 'Integration database has space for the bounded quota fixture');
  const hashes = Array.from({ length: needed }, () => hash(randomBytes(32).toString('base64url')));
  try {
    if (hashes.length) await sql`insert into demo_sessions (token_hash, workspace_id, project_id, member_id, expires_at)
      select value, ${actor.workspaceId}::uuid, ${actor.projectId}::uuid, ${actor.memberId}::uuid, clock_timestamp() + interval '1 day'
      from unnest(${sql.array(hashes)}::text[]) value`;
    const [before] = await sql`select count(*)::int as count from workspaces`;
    const outcomes = await Promise.allSettled([demo.create(), demo.create()]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await sql`select count(*)::int as count from demo_sessions`)[0]!.count, 1000);
    assert.equal((await sql`select count(*)::int as count from workspaces`)[0]!.count, before!.count + 1);
  } finally {
    if (hashes.length) await sql`delete from demo_sessions where token_hash in ${sql(hashes)}`;
  }
});
