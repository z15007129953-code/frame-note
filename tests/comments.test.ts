import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { createConnection } from '../src/db/connection.ts';
import { migrate } from '../src/db/migrate.ts';
import { assertTestTarget } from '../src/db/test-target.ts';
import { assertResolvedTestTarget, assertServerIdentity } from '../src/db/server-identity.ts';
import { ReviewRepository } from '../src/db/review-repository.ts';
import type { Actor } from '../src/db/demo-repository.ts';

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
const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected;
const review = new ReviewRepository(connection);
async function repository(target = connection) {
  const { CommentRepository } = await import('../src/db/comment-repository.ts');
  return new CommentRepository(target);
}
async function fixture(existing?: Actor) {
  const workspaceId = existing?.workspaceId ?? randomUUID();
  const memberId = existing?.memberId ?? randomUUID();
  if (!existing) {
    await sql`insert into workspaces (id, title) values (${workspaceId}, 'Comment fixture')`;
    await sql`insert into members (id, workspace_id) values (${memberId}, ${workspaceId})`;
  }
  const project = await review.createProject(workspaceId, memberId, 'Comments');
  const actor = { workspaceId, projectId: project.id, memberId };
  const presentation = await review.createPresentation(workspaceId, project.id, memberId, 'Review');
  const screen = await review.createScreen(workspaceId, project.id, presentation.id, memberId, 'Screen');
  const assetId = randomUUID();
  await sql`insert into assets (id, workspace_id, project_id, storage_key, mime_type, byte_size, width, height, status)
    values (${assetId}, ${workspaceId}, ${project.id}, ${'test/' + assetId}, 'image/png', 100, 1200, 800, 'ready')`;
  const version = await review.addVersion(workspaceId, project.id, screen.id, memberId, assetId);
  return { actor, presentationId: presentation.id, versionId: version.id, screenId: screen.id };
}

test('comment repository is available', async () => {
  await assert.doesNotReject(repository(), 'Persistent comment repository must exist');
});

test('thread and trimmed root persist together across connections with ordered replies and resolve/reopen', async () => {
  const repo = await repository(); const f = await fixture();
  const thread = await repo.create(f.actor, f.versionId, { x: 0, y: 1 }, '  Initial note  ');
  assert.equal(thread.versionId, f.versionId);
  assert.deepEqual([thread.x, thread.y, thread.resolved], [0, 1, false]);
  assert.equal(thread.messages.length, 1);
  assert.equal(thread.messages[0]!.body, 'Initial note');
  assert.equal(thread.messages[0]!.authorId, f.actor.memberId);
  assert.ok(Number.isFinite(Date.parse(thread.messages[0]!.createdAt)));
  await repo.reply(f.actor, f.versionId, thread.id, '  A reply  ');
  await repo.setResolved(f.actor, f.versionId, thread.id, true);
  const reopened = createConnection(url);
  try {
    assertResolvedTestTarget(url, reopened.sql.options);
    const [saved] = await (await repository(reopened)).list(f.actor, f.versionId);
    assert.equal(saved!.resolved, true);
    assert.deepEqual(saved!.messages.map(message => message.body), ['Initial note', 'A reply']);
    assert.deepEqual(saved!.messages[0], thread.messages[0]);
  } finally { await reopened.sql.end(); }
  await repo.setResolved(f.actor, f.versionId, thread.id, false);
  assert.equal((await repo.list(f.actor, f.versionId))[0]!.resolved, false);
});

test('version, project and workspace boundaries apply to reads, creation, replies and status', async () => {
  const repo = await repository(); const a = await fixture(); const b = await fixture(a.actor); const c = await fixture();
  const thread = await repo.create(a.actor, a.versionId, { x: 0.2, y: 0.3 }, 'Private');
  for (const other of [b, c]) {
    await assert.rejects(repo.list(other.actor, a.versionId), code('not-found'));
    await assert.rejects(repo.create(other.actor, a.versionId, { x: 0, y: 0 }, 'Foreign'), code('not-found'));
    await assert.rejects(repo.reply(other.actor, other.versionId, thread.id, 'Foreign'), code('not-found'));
    await assert.rejects(repo.setResolved(other.actor, other.versionId, thread.id, true), code('not-found'));
    assert.deepEqual(await repo.list(other.actor, other.versionId), []);
  }
  const secondAsset = randomUUID();
  await sql`insert into assets (id, workspace_id, project_id, storage_key, mime_type, byte_size, width, height, status)
    values (${secondAsset}, ${a.actor.workspaceId}, ${a.actor.projectId}, ${'test/' + secondAsset}, 'image/png', 100, 1, 1, 'ready')`;
  const second = await review.addVersion(a.actor.workspaceId, a.actor.projectId, a.screenId, a.actor.memberId, secondAsset);
  assert.deepEqual(await repo.list(a.actor, second.id), []);
  await assert.rejects(repo.reply(a.actor, second.id, thread.id, 'Wrong version'), code('not-found'));
  await assert.rejects(repo.setResolved(a.actor, second.id, thread.id, true), code('not-found'));
});

test('persisted collaborators write and viewers only read', async () => {
  const repo = await repository(); const f = await fixture();
  await sql`update project_members set role = 'collaborator' where project_id = ${f.actor.projectId}`;
  const thread = await repo.create(f.actor, f.versionId, { x: 0.5, y: 0.5 }, 'Collaborator');
  await repo.reply(f.actor, f.versionId, thread.id, 'Reply');
  await repo.setResolved(f.actor, f.versionId, thread.id, true);
  await sql`update project_members set role = 'viewer' where project_id = ${f.actor.projectId}`;
  assert.equal((await repo.list(f.actor, f.versionId)).length, 1);
  await assert.rejects(repo.create(f.actor, f.versionId, { x: 0, y: 0 }, 'Denied'), code('forbidden'));
  await assert.rejects(repo.reply(f.actor, f.versionId, thread.id, 'Denied'), code('forbidden'));
  await assert.rejects(repo.setResolved(f.actor, f.versionId, thread.id, false), code('forbidden'));
});

for (const scope of ['membership', 'member', 'project'] as const) {
  test(`revoked or expired ${scope} denies every operation`, async () => {
    const repo = await repository(); const f = await fixture();
    const thread = await repo.create(f.actor, f.versionId, { x: 0, y: 0 }, 'Existing');
    if (scope === 'membership') await sql`delete from project_members where project_id = ${f.actor.projectId}`;
    else if (scope === 'member') await sql`update members set expires_at = clock_timestamp() where id = ${f.actor.memberId}`;
    else await sql`update projects set expires_at = clock_timestamp() where id = ${f.actor.projectId}`;
    await assert.rejects(repo.list(f.actor, f.versionId), code('forbidden'));
    await assert.rejects(repo.create(f.actor, f.versionId, { x: 0, y: 0 }, 'Denied'), code('forbidden'));
    await assert.rejects(repo.reply(f.actor, f.versionId, thread.id, 'Denied'), code('forbidden'));
    await assert.rejects(repo.setResolved(f.actor, f.versionId, thread.id, true), code('forbidden'));
  });
}

test('invalid coordinates, bodies and IDs are rejected without partial threads', async () => {
  const repo = await repository(); const f = await fixture();
  for (const value of [-0.01, 1.01, NaN, Infinity, -Infinity]) {
    await assert.rejects(repo.create(f.actor, f.versionId, { x: value, y: 0 }, 'Invalid'), code('invalid'));
    await assert.rejects(repo.create(f.actor, f.versionId, { x: 0, y: value }, 'Invalid'), code('invalid'));
  }
  for (const body of ['', ' \n\t ', 'x'.repeat(2001)]) {
    await assert.rejects(repo.create(f.actor, f.versionId, { x: 0, y: 0 }, body), code('invalid'));
  }
  assert.deepEqual(await repo.list(f.actor, f.versionId), []);
  const thread = await repo.create(f.actor, f.versionId, { x: 1, y: 0 }, 'x'.repeat(2000));
  for (const body of ['', ' ', 'x'.repeat(2001)]) await assert.rejects(repo.reply(f.actor, f.versionId, thread.id, body), code('invalid'));
  await assert.rejects(repo.list(f.actor, 'bad'), code('invalid'));
  await assert.rejects(repo.reply(f.actor, f.versionId, 'bad', 'Valid'), code('invalid'));
  await assert.rejects(repo.setResolved(f.actor, f.versionId, thread.id, 'true' as unknown as boolean), code('invalid'));
  assert.equal((await repo.list(f.actor, f.versionId))[0]!.messages.length, 1);
});

test('thread and reply quotas serialize the concurrent last slot and reads remain bounded', async () => {
  const repo = await repository(); const f = await fixture();
  await sql`insert into comment_threads (workspace_id, project_id, version_id, x, y)
    select ${f.actor.workspaceId}::uuid, ${f.actor.projectId}::uuid, ${f.versionId}::uuid, 0, 0 from generate_series(1, 99)`;
  const outcomes = await Promise.allSettled([repo.create(f.actor, f.versionId, { x: 0, y: 0 }, 'Last'), repo.create(f.actor, f.versionId, { x: 0, y: 0 }, 'Excess')]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(outcomes.some(result => result.status === 'rejected' && code('invalid')(result.reason)));
  const created = outcomes.find(result => result.status === 'fulfilled');
  assert.ok(created && created.status === 'fulfilled');
  const thread = created.value;
  await sql`insert into comment_messages (workspace_id, project_id, version_id, thread_id, author_id, body)
    select ${f.actor.workspaceId}::uuid, ${f.actor.projectId}::uuid, ${f.versionId}::uuid, ${thread.id}::uuid, ${f.actor.memberId}::uuid, 'Existing reply' from generate_series(1, 98)`;
  const replies = await Promise.allSettled([repo.reply(f.actor, f.versionId, thread.id, 'Last'), repo.reply(f.actor, f.versionId, thread.id, 'Excess')]);
  assert.equal(replies.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(replies.some(result => result.status === 'rejected' && code('invalid')(result.reason)));
  const listed = await repo.list(f.actor, f.versionId);
  assert.equal(listed.length, 100);
  assert.equal(listed.find(row => row.id === thread.id)!.messages.length, 100);
  await sql`insert into comment_threads (workspace_id, project_id, version_id, x, y) values (${f.actor.workspaceId}, ${f.actor.projectId}, ${f.versionId}, 0, 0)`;
  await sql`insert into comment_messages (workspace_id, project_id, version_id, thread_id, author_id, body) values
    (${f.actor.workspaceId}, ${f.actor.projectId}, ${f.versionId}, ${thread.id}, ${f.actor.memberId}, 'Legacy excess')`;
  assert.deepEqual(await repo.list(f.actor, f.versionId), listed);
});

test('database composite keys reject mismatched version, thread and author scopes', async () => {
  const repo = await repository(); const a = await fixture(); const b = await fixture();
  const thread = await repo.create(a.actor, a.versionId, { x: 0, y: 0 }, 'Root');
  await assert.rejects(sql`insert into comment_threads (workspace_id, project_id, version_id, x, y)
    values (${b.actor.workspaceId}, ${b.actor.projectId}, ${a.versionId}, 0, 0)`, code('23503'));
  await assert.rejects(sql`insert into comment_messages (workspace_id, project_id, version_id, thread_id, author_id, body)
    values (${b.actor.workspaceId}, ${b.actor.projectId}, ${b.versionId}, ${thread.id}, ${b.actor.memberId}, 'Foreign thread')`, code('23503'));
  await assert.rejects(sql`insert into comment_messages (workspace_id, project_id, version_id, thread_id, author_id, body)
    values (${a.actor.workspaceId}, ${a.actor.projectId}, ${a.versionId}, ${thread.id}, ${b.actor.memberId}, 'Foreign author')`, code('23503'));
});

test('guest messages reference their issuing share and enforce exactly one author', async () => {
  const repo = await repository(); const f = await fixture();
  const tokenHash = createHash('sha256').update(randomUUID()).digest('hex');
  const [share] = await sql`insert into shares
    (workspace_id, project_id, presentation_id, issuer_id, token_hash, expires_at, allow_comments)
    values (${f.actor.workspaceId}, ${f.actor.projectId},
      (select presentation_id from screens where id = ${f.screenId}), ${f.actor.memberId}, ${tokenHash},
      clock_timestamp() + interval '1 hour', true)
    returning id`;
  const [thread] = await sql`insert into comment_threads
    (workspace_id, project_id, version_id, x, y)
    values (${f.actor.workspaceId}, ${f.actor.projectId}, ${f.versionId}, 0.25, 0.75)
    returning id`;

  const [guest] = await sql`insert into comment_messages
    (workspace_id, project_id, version_id, thread_id, author_id, guest_share_id, body)
    values (${f.actor.workspaceId}, ${f.actor.projectId}, ${f.versionId}, ${thread!.id}, null, ${share!.id}, 'Guest note')
    returning author_id, guest_share_id, body`;
  assert.equal(guest!.author_id, null);
  assert.equal(guest!.guest_share_id, share!.id);
  assert.equal(guest!.body, 'Guest note');

  await assert.rejects(sql`insert into comment_messages
    (workspace_id, project_id, version_id, thread_id, author_id, guest_share_id, body)
    values (${f.actor.workspaceId}, ${f.actor.projectId}, ${f.versionId}, ${thread!.id}, null, null, 'No author')`, code('23514'));
  await assert.rejects(sql`insert into comment_messages
    (workspace_id, project_id, version_id, thread_id, author_id, guest_share_id, body)
    values (${f.actor.workspaceId}, ${f.actor.projectId}, ${f.versionId}, ${thread!.id}, ${f.actor.memberId}, ${share!.id}, 'Two authors')`, code('23514'));

  const foreign = await fixture();
  const foreignTokenHash = createHash('sha256').update(randomUUID()).digest('hex');
  const [foreignShare] = await sql`insert into shares
    (workspace_id, project_id, presentation_id, issuer_id, token_hash, expires_at, allow_comments)
    values (${foreign.actor.workspaceId}, ${foreign.actor.projectId}, ${foreign.presentationId}, ${foreign.actor.memberId},
      ${foreignTokenHash}, clock_timestamp() + interval '1 hour', true)
    returning id`;
  await assert.rejects(sql`insert into comment_messages
    (workspace_id, project_id, version_id, thread_id, author_id, guest_share_id, body)
    values (${f.actor.workspaceId}, ${f.actor.projectId}, ${f.versionId}, ${thread!.id}, null, ${foreignShare!.id}, 'Foreign share')`, code('23503'));
});

test('comment-enabled guest can list, create, and reply while owner can see and resolve the same thread', async () => {
  const repo = await repository(); const f = await fixture();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const [share] = await sql`insert into shares
    (workspace_id, project_id, presentation_id, issuer_id, token_hash, expires_at, allow_comments)
    values (${f.actor.workspaceId}, ${f.actor.projectId}, ${f.presentationId}, ${f.actor.memberId}, ${tokenHash},
      clock_timestamp() + interval '1 hour', true) returning id`;
  const guest = { shareId: share!.id as string, token };
  assert.deepEqual(await repo.listGuest(guest.shareId, guest.token, f.versionId), []);
  const created = await repo.createGuest(guest.shareId, guest.token, f.versionId, { x: 0.25, y: 0.75 }, '  Guest note  ');
  assert.equal(created.messages[0]!.authorId, null);
  assert.equal(created.messages[0]!.isGuest, true);
  await repo.replyGuest(guest.shareId, guest.token, f.versionId, created.id, 'Guest reply');
  const ownerView = await repo.list(f.actor, f.versionId);
  assert.deepEqual(ownerView[0]!.messages.map(message => [message.body, message.authorId, message.isGuest]), [
    ['Guest note', null, true], ['Guest reply', null, true],
  ]);
  await repo.setResolved(f.actor, f.versionId, created.id, true);
  assert.equal((await repo.listGuest(guest.shareId, guest.token, f.versionId))[0]!.resolved, true);
});

test('read-only, expired, revoked, malformed, and foreign guest requests are denied without writes', async () => {
  const repo = await repository(); const f = await fixture(); const other = await fixture();
  const makeShare = async (allowComments: boolean, expires = "clock_timestamp() + interval '1 hour'") => {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const [share] = await sql`insert into shares
      (workspace_id, project_id, presentation_id, issuer_id, token_hash, expires_at, allow_comments)
      values (${f.actor.workspaceId}, ${f.actor.projectId}, ${f.presentationId}, ${f.actor.memberId}, ${tokenHash}, ${sql.unsafe(expires)}, ${allowComments}) returning id`;
    return { id: share!.id as string, token };
  };
  const readOnly = await makeShare(false);
  await assert.rejects(repo.listGuest(readOnly.id, readOnly.token, f.versionId), code('not-found'));
  await assert.rejects(repo.createGuest(readOnly.id, readOnly.token, f.versionId, { x: 0, y: 0 }, 'Denied'), code('not-found'));
  const enabled = await makeShare(true);
  await assert.rejects(repo.listGuest(enabled.id, enabled.token, other.versionId), code('not-found'));
  await assert.rejects(repo.createGuest(enabled.id, enabled.token, f.versionId, { x: -0.1, y: 0 }, 'Invalid'), code('invalid'));
  await assert.rejects(repo.createGuest(enabled.id, enabled.token, f.versionId, { x: 0, y: 0 }, ' '), code('invalid'));
  await assert.rejects(repo.listGuest(enabled.id, 'bad', f.versionId), code('not-found'));
  await sql`update shares set revoked = true where id = ${enabled.id}`;
  await assert.rejects(repo.createGuest(enabled.id, enabled.token, f.versionId, { x: 0, y: 0 }, 'Revoked'), code('not-found'));
  const expired = await makeShare(true, "clock_timestamp() - interval '1 second'");
  await assert.rejects(repo.listGuest(expired.id, expired.token, f.versionId), code('not-found'));
  await sql`update project_members set role = 'collaborator' where project_id = ${f.actor.projectId}`;
  const active = await makeShare(true);
  await assert.rejects(repo.listGuest(active.id, active.token, f.versionId), code('not-found'));
  assert.equal((await sql`select count(*)::int as count from comment_threads where version_id = ${f.versionId}`)[0]!.count, 0);
});

test('guest comment quotas and version scope remain bounded and owner-only resolution is preserved', async () => {
  const repo = await repository(); const f = await fixture();
  const token = randomBytes(32).toString('base64url');
  const [share] = await sql`insert into shares
    (workspace_id, project_id, presentation_id, issuer_id, token_hash, expires_at, allow_comments)
    values (${f.actor.workspaceId}, ${f.actor.projectId}, ${f.presentationId}, ${f.actor.memberId}, ${createHash('sha256').update(token).digest('hex')},
      clock_timestamp() + interval '1 hour', true) returning id`;
  await sql`insert into comment_threads (workspace_id, project_id, version_id, x, y)
    select ${f.actor.workspaceId}::uuid, ${f.actor.projectId}::uuid, ${f.versionId}::uuid, 0, 0 from generate_series(1, 100)`;
  await assert.rejects(repo.createGuest(share!.id, token, f.versionId, { x: 0, y: 0 }, 'Over quota'), code('invalid'));
  const existing = await repo.createGuest(share!.id, token, f.versionId, { x: 0, y: 0 }, 'Should not happen').catch(() => null);
  assert.equal(existing, null);
  const thread = await repo.list(f.actor, f.versionId);
  assert.equal(thread.length, 100);
  await assert.rejects(repo.setResolved({ ...f.actor, memberId: randomUUID() }, f.versionId, thread[0]!.id, true), code('forbidden'));
});

for (const operation of ['list', 'create', 'reply', 'resolve'] as const) {
  test(`${operation} rechecks expiry after a downstream lock wait`, async () => {
    const repo = await repository(); const f = await fixture();
    const thread = await repo.create(f.actor, f.versionId, { x: 0, y: 0 }, 'Existing');
    await sql`update projects set expires_at = clock_timestamp() + interval '1 second' where id = ${f.actor.projectId}`;
    const blocker = await sql.reserve(); let pending: Promise<unknown> | undefined;
    try {
      await blocker`begin`;
      const [pid] = await blocker`select pg_backend_pid() as pid`;
      await blocker`select id from versions where id = ${f.versionId} for update`;
      const action = operation === 'list' ? repo.list(f.actor, f.versionId)
        : operation === 'create' ? repo.create(f.actor, f.versionId, { x: 0, y: 0 }, 'Expired')
        : operation === 'reply' ? repo.reply(f.actor, f.versionId, thread.id, 'Expired')
        : repo.setResolved(f.actor, f.versionId, thread.id, true);
      pending = action.then(value => ({ value }), error => ({ error }));
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row] = await sql`select exists(select 1 from pg_stat_activity where ${pid!.pid} = any(pg_blocking_pids(pid))) as blocked`;
        if (row!.blocked) { blocked = true; break; }
        await sql`select pg_sleep(0.01)`;
      }
      assert.ok(blocked, 'Operation must wait for version lock');
      await blocker`select pg_sleep(greatest(extract(epoch from expires_at - clock_timestamp()), 0)::float + 0.02) from projects where id = ${f.actor.projectId}`;
      await blocker`commit`;
      const result = await pending as { error?: unknown };
      assert.ok(code('forbidden')(result.error));
      const [saved] = await sql`select resolved, (select count(*)::int from comment_messages where thread_id = ${thread.id}) as messages from comment_threads where id = ${thread.id}`;
      assert.equal(saved!.resolved, false); assert.equal(saved!.messages, 1);
      assert.equal((await sql`select count(*)::int as count from comment_threads where version_id = ${f.versionId}`)[0]!.count, 1);
    } finally { await blocker`rollback`; blocker.release(); if (pending) await pending; }
  });
}

test('expiry while the root insert waits rolls back the newly inserted thread atomically', async () => {
  const repo = await repository(); const f = await fixture();
  await sql`update members set expires_at = clock_timestamp() + interval '1 second' where id = ${f.actor.memberId}`;
  const blocker = await sql.reserve(); let pending: Promise<unknown> | undefined;
  try {
    await blocker`begin`;
    const [pid] = await blocker`select pg_backend_pid() as pid`;
    await blocker`lock table comment_messages in access exclusive mode`;
    pending = repo.create(f.actor, f.versionId, { x: 0, y: 0 }, 'Expired root').then(value => ({ value }), error => ({ error }));
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const [row] = await sql`select exists(select 1 from pg_stat_activity where ${pid!.pid} = any(pg_blocking_pids(pid))) as blocked`;
      if (row!.blocked) { blocked = true; break; }
      await sql`select pg_sleep(0.01)`;
    }
    assert.ok(blocked, 'Root message insertion must reach the table lock');
    await blocker`select pg_sleep(greatest(extract(epoch from expires_at - clock_timestamp()), 0)::float + 0.02) from members where id = ${f.actor.memberId}`;
    await blocker`commit`;
    const result = await pending as { error?: unknown };
    assert.ok(code('forbidden')(result.error));
    assert.equal((await sql`select count(*)::int as count from comment_threads where version_id = ${f.versionId}`)[0]!.count, 0);
    assert.equal((await sql`select count(*)::int as count from comment_messages where version_id = ${f.versionId}`)[0]!.count, 0);
  } finally { await blocker`rollback`; blocker.release(); if (pending) await pending; }
});
