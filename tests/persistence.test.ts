import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { before, after, test } from 'node:test';
import { assertTestTarget } from '../src/db/test-target.ts';
import { assertResolvedTestTarget, assertServerIdentity } from '../src/db/server-identity.ts';
import { createConnection } from '../src/db/connection.ts';
import { migrate } from '../src/db/migrate.ts';
import { ReviewRepository } from '../src/db/review-repository.ts';

const url = process.env.TEST_DATABASE_URL;
assert.ok(url, 'Set explicit TEST_DATABASE_URL in .env.local; run npm run db:local -- init first.');
assertTestTarget(url, process.env);
const connection = createConnection(url);
const { sql } = connection;
try {
  assertResolvedTestTarget(url, sql.options);
  const identity = await sql`select current_database() as name, host(inet_server_addr()) as address, inet_server_port() as port`;
  assertServerIdentity({ name: identity[0]?.name, address: identity[0]?.address, port: identity[0]?.port }, process.env.FRAME_TEST_TRANSPORT);
} catch (error) {
  await sql.end();
  throw error;
}
const repository = new ReviewRepository(connection);

before(async () => { await Promise.all([migrate(connection), migrate(connection)]); await migrate(connection); });
after(async () => { await sql.end(); });

async function fixture() {
  const workspaceId = randomUUID();
  const memberId = randomUUID();
  await sql`insert into workspaces (id, title) values (${workspaceId}, 'Integration fixture')`;
  await sql`insert into members (id, workspace_id) values (${memberId}, ${workspaceId})`;
  const project = await repository.createProject(workspaceId, memberId, '  Review project  ');
  const presentation = await repository.createPresentation(workspaceId, project.id, memberId, 'Review');
  const screen = await repository.createScreen(workspaceId, project.id, presentation.id, memberId, 'Screen');
  return { workspaceId, memberId, project, presentation, screen };
}
async function asset(f: Awaited<ReturnType<typeof fixture>>, ready = true) {
  const id = randomUUID();
  await sql`insert into assets (id, workspace_id, project_id, storage_key, mime_type, byte_size, width, height, status)
    values (${id}, ${f.workspaceId}, ${f.project.id}, ${'test/' + id}, 'image/png', 10, 20, 30, ${ready ? 'ready' : 'pending'})`;
  return id;
}
function code(expected: string) { return (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === expected; }

test('migration history is applied once and records SHA256', async () => {
  const rows = await sql`select name, checksum from frame_note_migrations`;
  assert.equal(rows.length, 3);
  assert.match(rows[0]!.checksum, /^[a-f0-9]{64}$/);
});

test('changed applied migration refuses and failed migration rolls back all DDL', async () => {
  await assert.rejects(migrate(connection, [{ name: '0000_review.sql', sql: 'select 1' }]), /checksum/i);
  const table = 'rollback_' + randomUUID().replaceAll('-', '');
  await assert.rejects(migrate(connection, [{ name: table + '.sql', sql: `create table ${table} (id integer); select nonexistent_frame_note_function();` }]));
  const result = await sql`select to_regclass(${table}) as table_name`;
  assert.equal(result[0]!.table_name, null);
  const history = await sql`select name from frame_note_migrations where name = ${table + '.sql'}`;
  assert.equal(history.length, 0);
});

test('migration CLI does not reveal credentials for malformed connection URLs', () => {
  const secret = 'private-malformed-password';
  const result = spawnSync(process.execPath, ['src/db/migrate-cli.ts'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: `postgresql://user:${secret}@[bad/frame_note` },
  });
  assert.equal(result.status, 1);
  assert.ok(!result.stderr.includes(secret));
  assert.match(result.stderr, /Migration failed/);
});

test('owner creation, trimmed titles and reconnect persistence', async () => {
  const f = await fixture();
  assert.equal(f.project.title, 'Review project');
  const membership = await sql`select role from project_members where project_id = ${f.project.id} and member_id = ${f.memberId}`;
  assert.equal(membership[0]!.role, 'owner');
  const reopened = createConnection(url);
  try {
    assertResolvedTestTarget(url, reopened.sql.options);
    const rows = await new ReviewRepository(reopened).listScreens(f.workspaceId, f.project.id, f.presentation.id, f.memberId);
    assert.deepEqual(rows.map(row => row.id), [f.screen.id]);
  } finally { await reopened.sql.end(); }
  await assert.rejects(repository.createProject(f.workspaceId, f.memberId, ' '), code('invalid'));
  await assert.rejects(repository.createProject(f.workspaceId, f.memberId, 'x'.repeat(161)), code('invalid'));
});

test('database rejects cross-workspace and cross-project associations', async () => {
  const a = await fixture(); const b = await fixture();
  await assert.rejects(sql`insert into project_members (workspace_id, project_id, member_id, role) values (${a.workspaceId}, ${a.project.id}, ${b.memberId}, 'owner')`, code('23503'));
  await assert.rejects(sql`insert into screens (workspace_id, project_id, presentation_id, title, position) values (${a.workspaceId}, ${a.project.id}, ${b.presentation.id}, 'Foreign', 1)`, code('23503'));
  const other = await repository.createProject(a.workspaceId, a.memberId, 'Other');
  const otherPresentation = await repository.createPresentation(a.workspaceId, other.id, a.memberId, 'Other');
  await assert.rejects(sql`insert into screens (workspace_id, project_id, presentation_id, title, position) values (${a.workspaceId}, ${a.project.id}, ${otherPresentation.id}, 'Foreign', 1)`, code('23503'));
  const foreignAsset = await asset(b);
  await assert.rejects(sql`insert into versions (workspace_id, project_id, screen_id, asset_id, number) values (${a.workspaceId}, ${a.project.id}, ${a.screen.id}, ${foreignAsset}, 1)`, code('23503'));
  await assert.rejects(repository.createProject(a.workspaceId, b.memberId, 'Foreign owner'), code('forbidden'));
  await assert.rejects(repository.listScreens(b.workspaceId, a.project.id, a.presentation.id, b.memberId), code('not-found'));
});

test('persisted role downgrade and revocation immediately deny mutations', async () => {
  const f = await fixture();
  await sql`update project_members set role = 'collaborator' where project_id = ${f.project.id} and member_id = ${f.memberId}`;
  await repository.createScreen(f.workspaceId, f.project.id, f.presentation.id, f.memberId, 'Collaborator');
  await sql`update project_members set role = 'viewer' where project_id = ${f.project.id} and member_id = ${f.memberId}`;
  assert.equal((await repository.listScreens(f.workspaceId, f.project.id, f.presentation.id, f.memberId)).length, 2);
  await assert.rejects(repository.createPresentation(f.workspaceId, f.project.id, f.memberId, 'Denied'), code('forbidden'));
  await assert.rejects(repository.createScreen(f.workspaceId, f.project.id, f.presentation.id, f.memberId, 'Denied'), code('forbidden'));
  await assert.rejects(repository.reorderScreens(f.workspaceId, f.project.id, f.presentation.id, f.memberId, []), code('forbidden'));
  await assert.rejects(repository.addVersion(f.workspaceId, f.project.id, f.screen.id, f.memberId, await asset(f)), code('forbidden'));
  // Revocation is represented by expiring the member; fixtures are never deleted.
  await sql`update members set expires_at = current_timestamp where id = ${f.memberId}`;
  await assert.rejects(repository.listScreens(f.workspaceId, f.project.id, f.presentation.id, f.memberId), code('forbidden'));
  await assert.rejects(repository.createProject(f.workspaceId, f.memberId, 'Denied'), code('forbidden'));
});

test('expired projects deny reads and writes', async () => {
  const f = await fixture();
  await sql`update projects set expires_at = current_timestamp where id = ${f.project.id}`;
  await assert.rejects(repository.listScreens(f.workspaceId, f.project.id, f.presentation.id, f.memberId), code('forbidden'));
  await assert.rejects(repository.createScreen(f.workspaceId, f.project.id, f.presentation.id, f.memberId, 'Denied'), code('forbidden'));
});

for (const scope of ['project', 'member', 'creator'] as const) {
  test(`${scope} expiry during a lock wait denies access after lock acquisition`, async () => {
    const f = await fixture();
    const table = scope === 'project' ? 'projects' : 'members';
    const id = scope === 'project' ? f.project.id : f.memberId;
    await sql`update ${sql(table)} set expires_at = clock_timestamp() + interval '2 seconds' where id = ${id}`;
    const blocker = await sql.reserve();
    let pending: Promise<unknown> | undefined;
    try {
      await blocker`begin`;
      const pid = await blocker`select pg_backend_pid() as pid`;
      await blocker`select id from ${blocker(table)} where id = ${id} for update`;
      pending = (scope === 'creator'
        ? repository.createProject(f.workspaceId, f.memberId, 'Expired creator')
        : repository.listScreens(f.workspaceId, f.project.id, f.presentation.id, f.memberId))
        .then(value => ({ value }), error => ({ error }));
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await sql`select exists(select 1 from pg_stat_activity where ${pid[0]!.pid} = any(pg_blocking_pids(pid))) as blocked`;
        if (rows[0]!.blocked) { blocked = true; break; }
        await sql`select pg_sleep(0.01)`;
      }
      assert.ok(blocked, 'Repository transaction must actually be blocked before expiry');
      await blocker`select pg_sleep(greatest(extract(epoch from expires_at - clock_timestamp()), 0)::double precision + 0.02) from ${blocker(table)} where id = ${id}`;
      await blocker`commit`;
      const result = await pending as { error?: unknown };
      assert.ok(code('forbidden')(result.error), 'Access must use clock after lock acquisition');
    } finally {
      await blocker`rollback`;
      blocker.release();
      if (pending) await pending;
    }
  });
}

for (const operation of ['version-screen', 'version-asset', 'reorder'] as const) {
  for (const scope of ['project', 'member'] as const) {
    test(`${operation} rechecks ${scope} expiry after a downstream row lock wait`, async () => {
      const f = await fixture();
      const assetId = await asset(f);
      const expiryTable = scope === 'project' ? 'projects' : 'members';
      const expiryId = scope === 'project' ? f.project.id : f.memberId;
      const lockTable = operation === 'version-asset' ? 'assets' : 'screens';
      const lockId = operation === 'version-asset' ? assetId : f.screen.id;
      await sql`update ${sql(expiryTable)} set expires_at = clock_timestamp() + interval '2 seconds' where id = ${expiryId}`;
      const blocker = await sql.reserve();
      let pending: Promise<unknown> | undefined;
      try {
        await blocker`begin`;
        const pid = await blocker`select pg_backend_pid() as pid`;
        await blocker`select id from ${blocker(lockTable)} where id = ${lockId} for update`;
        pending = (operation === 'reorder'
          ? repository.reorderScreens(f.workspaceId, f.project.id, f.presentation.id, f.memberId, [f.screen.id])
          : repository.addVersion(f.workspaceId, f.project.id, f.screen.id, f.memberId, assetId))
          .then(value => ({ value }), error => ({ error }));
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const rows = await sql`select exists(select 1 from pg_stat_activity where ${pid[0]!.pid} = any(pg_blocking_pids(pid))) as blocked`;
          if (rows[0]!.blocked) { blocked = true; break; }
          await sql`select pg_sleep(0.01)`;
        }
        assert.ok(blocked, 'Repository must reach the downstream row lock before expiry');
        await blocker`select pg_sleep(greatest(extract(epoch from expires_at - clock_timestamp()), 0)::double precision + 0.02)
          from ${blocker(expiryTable)} where id = ${expiryId}`;
        await blocker`commit`;
        const result = await pending as { error?: unknown };
        assert.ok(code('forbidden')(result.error), 'Downstream lock acquisition must recheck expiry');
        const rows = await sql`select count(*)::int as count from versions where screen_id = ${f.screen.id}`;
        assert.equal(rows[0]!.count, 0);
      } finally {
        await blocker`rollback`;
        blocker.release();
        if (pending) await pending;
      }
    });
  }
}

test('reordering requires exact permutation and rejection preserves prior order', async () => {
  const f = await fixture();
  const second = await repository.createScreen(f.workspaceId, f.project.id, f.presentation.id, f.memberId, 'Second');
  await repository.reorderScreens(f.workspaceId, f.project.id, f.presentation.id, f.memberId, [second.id, f.screen.id]);
  for (const invalid of [[second.id], [second.id, second.id], [second.id, randomUUID()]]) {
    await assert.rejects(repository.reorderScreens(f.workspaceId, f.project.id, f.presentation.id, f.memberId, invalid), code('invalid'));
    assert.deepEqual((await repository.listScreens(f.workspaceId, f.project.id, f.presentation.id, f.memberId)).map(row => row.id), [second.id, f.screen.id]);
  }
});

test('concurrent versions have unique monotonic numbers, repeat upload is idempotent and prior rows immutable', async () => {
  const f = await fixture();
  const firstAsset = await asset(f);
  const first = await repository.addVersion(f.workspaceId, f.project.id, f.screen.id, f.memberId, firstAsset);
  const ids = await Promise.all(Array.from({ length: 8 }, () => asset(f)));
  const created = await Promise.all(ids.map(id => repository.addVersion(f.workspaceId, f.project.id, f.screen.id, f.memberId, id)));
  assert.deepEqual(created.map(row => row.number).sort((a, b) => a - b), [2, 3, 4, 5, 6, 7, 8, 9]);
  const duplicate = await Promise.all(Array.from({ length: 3 }, () => repository.addVersion(f.workspaceId, f.project.id, f.screen.id, f.memberId, firstAsset)));
  assert.ok(duplicate.every(row => row.id === first.id));
  const rows = await sql`select * from versions where id = ${first.id}`;
  assert.equal(rows[0]!.number, 1);
  assert.equal(rows[0]!.asset_id, firstAsset);
  await assert.rejects(sql`update versions set number = 20 where id = ${first.id}`);
  await assert.rejects(repository.addVersion(f.workspaceId, f.project.id, f.screen.id, f.memberId, await asset(f, false)), code('invalid'));
  const foreign = await fixture();
  await assert.rejects(repository.addVersion(f.workspaceId, f.project.id, f.screen.id, f.memberId, await asset(foreign)), code('not-found'));
});

test('screen and version limits hold at boundaries', async () => {
  const f = await fixture();
  await sql`insert into screens (workspace_id, project_id, presentation_id, title, position)
    select ${f.workspaceId}::uuid, ${f.project.id}::uuid, ${f.presentation.id}::uuid, 'Limit', n from generate_series(1, 99) n`;
  await assert.rejects(repository.createScreen(f.workspaceId, f.project.id, f.presentation.id, f.memberId, 'Too many'), code('invalid'));
  const ids = await Promise.all(Array.from({ length: 51 }, () => asset(f)));
  await sql`insert into versions (workspace_id, project_id, screen_id, asset_id, number)
    select ${f.workspaceId}::uuid, ${f.project.id}::uuid, ${f.screen.id}::uuid, a.id, a.ordinality::int
    from unnest(${sql.array(ids.slice(0, 50))}::uuid[]) with ordinality a(id, ordinality)`;
  await assert.rejects(repository.addVersion(f.workspaceId, f.project.id, f.screen.id, f.memberId, ids[50]!), code('invalid'));
  assert.equal((await repository.addVersion(f.workspaceId, f.project.id, f.screen.id, f.memberId, ids[0]!)).number, 1);
});
