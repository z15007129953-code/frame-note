# Guest Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in, presentation-scoped guest comments to protected Frame Note shares while preserving owner-only resolution and all existing private permissions.

**Architecture:** Migration 0004 adds the share comment flag and nullable guest message attribution. CommentRepository gains a guest transaction path that locks and revalidates the bearer share before every list/create/reply operation. SharedView receives the flag and renders a focused comment component; owner review continues to use the existing comment routes and displays guest messages as `Guest`.

**Tech Stack:** Next.js 16, React 19, PostgreSQL 17, TypeScript, sharp fixtures, Playwright.

---

### Task 1: Persist the opt-in flag and guest message attribution

**Files:**
- Create: `drizzle/0004_guest_comments.sql`
- Modify: `src/db/schema.ts`, `src/db/migrate.ts`, `tests/persistence.test.ts`
- Test: `tests/shares.test.ts`, `tests/comments.test.ts`

- [ ] Write failing database tests proving new shares default to read-only, opted-in shares expose the flag, old member messages remain valid, and guest messages can be attributed to a share without creating a member.
- [ ] Run the focused tests and confirm they fail because migration 0004 and guest fields are absent.
- [ ] Add the transactional migration: `shares.allow_comments boolean not null default false`; nullable `comment_messages.author_id`; nullable `comment_messages.guest_share_id`; scope/index constraints and an exactly-one-author check.
- [ ] Register 0004 without changing applied migrations 0000–0003, update the migration history expectation, and add Drizzle schema declarations.
- [ ] Run focused database tests and then the existing persistence/comment suites.

### Task 2: Implement secure guest comment repository operations

**Files:**
- Modify: `src/db/comment-repository.ts`, `src/db/share-repository.ts`
- Test: `tests/comments.test.ts`, `tests/shares.test.ts`

- [ ] Write failing real-DB contracts for guest list/create/reply, read-only denial, foreign version/presentation denial, revoked/expired issuer denial, malformed pins/bodies, and owner visibility/resolution.
- [ ] Run those tests RED.
- [ ] Implement a shared guest authorization transaction that validates the bearer hash, active owner issuer, `allow_comments`, exact presentation/version scope, and expiry before and after writes; use the existing lock order.
- [ ] Insert guest messages with `guest_share_id` and null `author_id`; leave owner operations unchanged and keep resolve/reopen owner-only.
- [ ] Enforce existing 100-thread/100-message limits for guest writes and map invalid or unauthorized guest requests to the existing not-found/invalid errors without touching files.
- [ ] Run all database tests GREEN.

### Task 3: Add owner controls and guest API routes

**Files:**
- Modify: `src/db/share-repository.ts`, `src/app/share-manager.tsx`, `src/app/share/[id]/shared-view.tsx`, `src/app/globals.css`
- Create: `src/app/api/shared/[id]/comments/route.ts`, `src/app/api/shared/[id]/comments/[threadId]/route.ts`
- Test: `e2e/shares.spec.ts`

- [ ] Add `allowComments` to create/list/snapshot contracts; send the checkbox value from the owner and label each link accurately.
- [ ] Add bearer-protected GET/POST comment routes and POST reply route; never accept actor/member IDs from request data and keep no-store/no-referrer headers.
- [ ] Write failing browser journeys for opt-in creation, owner list visibility, guest comments, read-only denial, reply, revoke/expiry, and owner session expiry.
- [ ] Implement guest comment UI with normalized pin placement, explicit `Guest` labels, version reset, retry/error states, and a mobile layout that keeps forms below the image.
- [ ] Run the focused browser tests RED then GREEN, including screenshots.

### Task 4: Integrate owner display and documentation

**Files:**
- Modify: `src/app/review-canvas.tsx`, `README.md`, `docs/acceptance-zh.md`, `docs/development-status.md`
- Test: `e2e/comments.spec.ts`, `e2e/shares.spec.ts`

- [ ] Render guest-authored messages as `Guest` in the owner review UI without changing owner author behavior.
- [ ] Add a browser regression proving comments remain bound to their version and owner can resolve/reopen a guest thread.
- [ ] Update local operation and limitation docs with the opt-in semantics and local-only restriction.

### Task 5: Full verification and local handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-09-24-guest-comments.md`

- [ ] Run `npm test`, `node --env-file=../persistence/.env.local --test --test-concurrency=1 tests/*.test.ts`, `npm run typecheck`, `npm run build`, and `npx playwright test`.
- [ ] Inspect desktop and 390px screenshots and run independent specification and quality reviews.
- [ ] Mark verified plan items, commit only scoped local files, keep the preview on `http://127.0.0.1:4310`, and wait for user acceptance before any publication.
