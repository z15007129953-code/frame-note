# Frame Note Review Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish testable access decisions and image pin geometry for the approved Frame Note product.

**Architecture:** Pure, typed domain policies accept server-verified facts; they never authenticate request-provided identities. Geometry operates on the displayed image rectangle, excluding letterboxing. Persistence, UI, upload adapters, and browser tests follow in separate milestones.

**Tech Stack:** TypeScript, Node 24 built-in test runner; later Next.js, React, PostgreSQL, Drizzle, Auth.js, Tailwind.

## Scope and file boundaries

- `src/domain/access.ts`: typed project, presentation-share, actor facts and capability checks.
- `src/domain/access.test.ts`: role, cross-project, expiry, revoked-share and precedence tests.
- `src/domain/pins.ts`: normalized pin validation and coordinate conversions.
- `src/domain/pins.test.ts`: image-boundary, resizing, nonfinite and degenerate-rectangle tests.
- `tsconfig.json`: strict domain-only typechecking, no emitted files.
- `docs/development-status.md`: verified evidence and explicit remaining work.

There is no application baseline to test: the initial commit contains documentation
and configuration only. Do not treat an empty test run as passing functionality.

### Task 1: Project and share access

- [ ] Write tests using `node:test` and `node:assert/strict`, importing `canAccess` from `./access.ts`.

The exact public types and API are:

```ts
export type Capability = 'view' | 'comment' | 'edit' | 'manage';
export type Role = 'viewer' | 'collaborator' | 'owner';
export type Project = { id: string; workspaceId: string; expiresAt: number | null };
export type Actor = { id: string; workspaceId: string; projectId: string; role: Role; expiresAt: number | null };
export type Share = { projectId: string; presentationId: string; mode: 'public' | 'token'; tokenVerified: boolean; allowComments: boolean; expiresAt: number | null; revoked: boolean };
export type AccessInput = { capability: Capability; project: Project; presentationId: string; actor: Actor | null; share: Share | null; now: number };
export function canAccess(input: AccessInput): boolean;
```

Actor is an already authenticated, persisted project membership. Share facts come
from a server lookup; tokenVerified is produced by token verification, never JSON
input. A null expiry means no expiry. Invalid timestamps, empty resource IDs,
expired project, and unrecognized capabilities/roles/modes fail closed. Whitespace-only
IDs are invalid. A matching active viewer can view/comment; collaborator additionally
edits; owner additionally manages. No actor may use a membership from another
workspace or project. Public and verified-token shares may view their exact
presentation; only allowComments permits comments. No share grants edit/manage.
An expired or unrelated actor does not defeat otherwise valid public sharing.
Conversely, an expired/revoked share does not defeat valid direct membership.
Expiry at exactly now is expired. The function must not mutate its inputs.

Minimal expected test:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAccess, type AccessInput } from './access.ts';
const input: AccessInput = { capability: 'view', project: { id: 'p1', workspaceId: 'w1', expiresAt: null }, presentationId: 'deck1', actor: null, share: null, now: 100 };
test('private project denies anonymous access', () => assert.equal(canAccess(input), false));
test('owner cannot manage another project', () => assert.equal(canAccess({ ...input, capability: 'manage', actor: { id: 'a1', workspaceId: 'w1', projectId: 'p2', role: 'owner', expiresAt: null } }), false));
```

- [ ] Run `node --test src/domain/access.test.ts`; first observe missing implementation, then a temporary throw-only exported stub must produce behavioral assertion failures before real code.
- [ ] Implement fail-closed guards with `Number.isFinite`, `value.trim().length > 0`, expiry `null || expiresAt > now`, and a fixed role/capability lookup. Validate direct membership independently of share lookup; union legitimate capabilities only after validating project lifecycle. Return false for unknown runtime values.
- [ ] Extend tests for every role/capability pair, both share modes, exact presentation binding, expiry equality, nonfinite dates, wrong workspace/project, invalid actor with valid share, valid actor with invalid share, and frozen inputs. Run tests after each rule.
- [ ] Run all domain tests and commit only explicit task files, with honest test evidence.

### Task 2: Normalized pin geometry

- [ ] Write tests using these exports from `./pins.ts`:

```ts
export type Pin = { x: number; y: number };
export type ImageRect = { left: number; top: number; width: number; height: number };
export function normalizePin(point: Pin, image: ImageRect): Pin | null;
export function projectPin(pin: Pin, image: ImageRect): Pin | null;
export function isValidPin(value: unknown): value is Pin;
```

Coordinates use viewport CSS pixels. The caller supplies the rendered IMAGE bounds,
not its surrounding stage. Reject invalid/nonfinite numbers, zero or negative
dimensions, nonfinite right/bottom boundaries, and points outside the image.
Normalize `(point.x-left)/width`, `(point.y-top)/height` into inclusive `[0,1]`.
Projection computes `left+pin.x*width`, `top+pin.y*height`. Reject nonfinite output.
Never clamp outside clicks onto the image. Edge pins are valid. Stored pins are
version-specific; this helper must not copy comments between versions.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePin, projectPin, isValidPin } from './pins.ts';
test('normalizes against image not stage', () => assert.deepEqual(normalizePin({x:150,y:100}, {left:50,top:50,width:200,height:100}), {x:0.5,y:0.5}));
test('projects after resizing', () => assert.deepEqual(projectPin({x:0.5,y:0.5}, {left:0,top:0,width:800,height:400}), {x:400,y:200}));
test('rejects invalid persisted pin', () => assert.equal(isValidPin({x:NaN,y:0}), false));
```

- [ ] Run `node --test src/domain/pins.test.ts` and observe red before implementing.
- [ ] Implement the formulas above in separate small pure helpers with no DOM or framework dependencies.
- [ ] Add tests for all corners, just-outside boundaries, letterbox clicks, resized projection, roundtrip tolerance, invalid unknown values and overflow. Run `npm test`.
- [ ] Add strict domain typechecking (`target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `noEmit: true`, `allowImportingTsExtensions: true`, `types: ["node"]`) with pinned dev dependencies TypeScript and Node 24 types and a reproducible lockfile.
- [ ] Run typecheck and tests, then commit explicit task files.

### Task 3: Review and handoff

- [ ] Independent spec compliance review against the rules above, then independent code-quality review. Address important findings before integration.
- [ ] Re-run `npm test` and `npm run typecheck` from the independent repo.
- [ ] Record actual test count, commits, and limitations in `docs/development-status.md`.
- [ ] Integrate locally only. No GitHub push, no cloud provisioning, no claim of a complete or runnable app.

## Following milestones (not implemented by this plan)

PostgreSQL schema and scoped repositories; authenticated/demo identity; signed local
image storage with quotas and image validation; presentation ordering/versioning;
share-token lifecycle; comment threads/resolution/mentions; activity and presence;
impeccable craft review UI; desktop/mobile real persisted acceptance journey;
English docs, license and CI; user acceptance, then GitHub publication.
