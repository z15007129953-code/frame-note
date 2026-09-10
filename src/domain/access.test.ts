import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccess, type AccessInput, type Actor, type Capability, type Role, type Share } from './access.ts';

const capabilities: Capability[] = ['view', 'comment', 'edit', 'manage'];
const roles: Role[] = ['viewer', 'collaborator', 'owner'];
const actor: Actor = { id: 'person-1', workspaceId: 'workspace-1', projectId: 'project-1', role: 'viewer', expiresAt: null };
const share: Share = { projectId: 'project-1', presentationId: 'presentation-1', mode: 'public', tokenVerified: false, allowComments: false, expiresAt: null, revoked: false };
function input(overrides: Partial<AccessInput> = {}): AccessInput {
  return { capability: 'view', project: { id: 'project-1', workspaceId: 'workspace-1', expiresAt: null }, presentationId: 'presentation-1', actor: null, share: null, now: 100, ...overrides };
}
function runtime(value: unknown): boolean { return canAccess(value as AccessInput); }

for (const role of roles) {
  for (const capability of capabilities) {
    test(`${role} capability ${capability}`, () => {
      const expected = capability === 'view' || capability === 'comment' || role === 'owner' || (role === 'collaborator' && capability === 'edit');
      assert.equal(canAccess(input({ actor: { ...actor, role }, capability })), expected);
    });
  }
}

for (const mode of ['public', 'token'] as const) {
  for (const tokenVerified of [false, true]) {
    for (const allowComments of [false, true]) {
      for (const capability of capabilities) {
        test(`${mode} share verified=${tokenVerified} comments=${allowComments}: ${capability}`, () => {
          const expected = (mode === 'public' || tokenVerified) && (capability === 'view' || (capability === 'comment' && allowComments));
          assert.equal(canAccess(input({ share: { ...share, mode, tokenVerified, allowComments }, capability })), expected);
        });
      }
    }
  }
}

for (const capability of capabilities) {
  test(`anonymous request without share denies ${capability}`, () => assert.equal(canAccess(input({ capability })), false));
}

for (const expiresAt of [null, 101, 100, 99, NaN, Infinity, -Infinity, undefined, '101']) {
  const expected = expiresAt === null || expiresAt === 101;
  for (const target of ['project', 'actor', 'share'] as const) {
    test(`${target} expiry ${String(expiresAt)}`, () => {
      const request = input({ actor: target === 'share' ? null : actor, share: target === 'actor' ? null : share });
      const source = target === 'project' ? request.project : target === 'actor' ? actor : share;
      assert.equal(runtime({ ...request, [target]: { ...source, expiresAt } }), expected);
    });
  }
}

const invalidActors: unknown[] = [
  { ...actor, projectId: 'other-project' }, { ...actor, workspaceId: 'other-workspace' },
  { ...actor, role: 'admin' }, { ...actor, role: undefined },
  { ...actor, expiresAt: 100 }, { ...actor, expiresAt: NaN }, null, undefined, {}, false, 'owner',
  ...['id', 'workspaceId', 'projectId'].flatMap((key) => ['', ' \t\n', null, 42].map((value) => ({ ...actor, [key]: value }))),
];
for (const [index, invalidActor] of invalidActors.entries()) {
  test(`invalid actor ${index} denies membership`, () => assert.equal(runtime({ ...input(), actor: invalidActor }), false));
  test(`invalid actor ${index} preserves share grant`, () => {
    assert.equal(runtime({ ...input({ share }), actor: invalidActor }), true);
    assert.equal(runtime({ ...input({ share, capability: 'edit' }), actor: invalidActor }), false);
  });
}

const invalidShares: unknown[] = [
  { ...share, projectId: 'other-project' }, { ...share, presentationId: 'other-presentation' },
  { ...share, mode: 'private' }, { ...share, mode: undefined },
  { ...share, mode: 'token', tokenVerified: false }, { ...share, revoked: true },
  { ...share, expiresAt: 100 }, { ...share, expiresAt: Infinity },
  ...['revoked', 'tokenVerified', 'allowComments'].flatMap((key) => [undefined, 'true', 1, null].map((value) => ({ ...share, [key]: value }))),
  null, undefined, {}, false, 'public',
  ...['projectId', 'presentationId'].flatMap((key) => ['', ' \t\n', null, 42].map((value) => ({ ...share, [key]: value }))),
];
for (const [index, invalidShare] of invalidShares.entries()) {
  test(`invalid share ${index} denies anonymous access`, () => assert.equal(runtime({ ...input(), share: invalidShare }), false));
  test(`invalid share ${index} preserves owner grant`, () => {
    for (const capability of capabilities) {
      assert.equal(runtime({ ...input({ actor: { ...actor, role: 'owner' }, capability }), share: invalidShare }), true);
    }
  });
}

for (const now of [NaN, Infinity, -Infinity, undefined, null, '100']) {
  test(`invalid current time ${String(now)} denies every source`, () => assert.equal(runtime({ ...input({ actor, share }), now }), false));
}
for (const capability of ['delete', '', 'VIEW', undefined, null, 1, 'toString', '__proto__']) {
  test(`unknown capability ${String(capability)} denies every source`, () => assert.equal(runtime({ ...input({ actor: { ...actor, role: 'owner' }, share }), capability }), false));
}
for (const value of ['', ' \t\n', null, undefined, 42]) {
  for (const key of ['id', 'workspaceId']) {
    test(`invalid project ${key} ${String(value)} denies every source`, () => {
      const request = input({ actor, share });
      assert.equal(runtime({ ...request, project: { ...request.project, [key]: value } }), false);
    });
  }
  test(`invalid presentation ID ${String(value)} denies every source`, () => assert.equal(runtime({ ...input({ actor, share }), presentationId: value }), false));
}
for (const project of [null, undefined, false, 'project-1', {}]) {
  test(`malformed project ${String(project)} denies`, () => assert.equal(runtime({ ...input({ actor, share }), project }), false));
}
for (const request of [null, undefined, false, 1, 'view', {}]) {
  test(`malformed request ${String(request)} denies`, () => assert.equal(runtime(request), false));
}

test('scope comparisons use exact IDs without silently trimming', () => {
  assert.equal(canAccess(input({ actor: { ...actor, projectId: ' project-1 ' } })), false);
  assert.equal(canAccess(input({ actor: { ...actor, workspaceId: ' workspace-1 ' } })), false);
  assert.equal(canAccess(input({ share: { ...share, presentationId: ' presentation-1 ' } })), false);
});

test('lifecycle expires grants at the boundary and honors revocation', () => {
  const request = input({ share: { ...share, expiresAt: 101 } });
  assert.equal(canAccess(request), true);
  assert.equal(canAccess({ ...request, now: 101 }), false);
  assert.equal(canAccess({ ...request, share: { ...request.share!, revoked: true } }), false);
  assert.equal(canAccess({ ...request, project: { ...request.project, expiresAt: 100 } }), false);
});

test('frozen input is not mutated', () => {
  const request = Object.freeze(input({
    project: Object.freeze({ id: 'project-1', workspaceId: 'workspace-1', expiresAt: null }),
    actor: Object.freeze({ ...actor }), share: Object.freeze({ ...share }),
  }));
  const before = structuredClone(request);
  assert.equal(canAccess(request), true);
  assert.deepEqual(request, before);
});
