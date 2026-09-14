# Read-only protected sharing implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development with specification and code-quality review. Implement test-first.

**Goal:** An owner creates an expiring, revocable link to one presentation, opened in a separate browser session without workspace membership.

**Architecture:** A separate ShareRepository owns presentation-scoped bearer authorization. Share tokens are random32-byte base64url values stored only as SHA256 hashes. Link fragment carries the token to client memory; authenticated fetches send Authorization: Bearer, never a token query/path. Shared image reads happen transactionally against exact presentation membership and recheck expiry after file I/O. No changes to existing private routes or member permissions.

**Tech Stack:** Existing Next16, React19, PostgreSQL17, local image store, strict TypeScript and Chrome Playwright.

**Verified outcome (2026-09-14):** 347 unit tests, 88 database tests, 21 Chrome journeys, strict TypeScript and production build passed. Independent specification and quality re-reviews approved. Storage initialization is lazy within authorized image reads; list/revoke remain database-only during image-store failure. Desktop/mobile screenshots inspected. Chrome UI connection is unavailable; handoff uses the verified local4310 URL for manual opening. No GitHub remote or publication. Read-only milestone awaits user acceptance.

## Scope/design decisions

Approved suite§6.2 includes public/token shares and viewer comments. Deliver token-protected read-only first; comments, public links and presentation mode remain next increments. Owner management is inline, not a modal; existing impeccable gallery-worktable tokens/fonts remain. Show exact expiration, create/copy link, active/revoked list and revoke action. Link is displayed once on creation (cannot recover plaintext after refresh), clearly says anyone holding it can view all current/future versions of this presentation until expiry/revocation. 1h or24h duration, capped by project and issuer expiration. Local-only links work on this computer, not a hosted public website. No cloud or domain work.

Visitor shows a single presentation, screen/version selectors and images, with explicit Read only, expiration, loading, retry and unavailable states. No upload/comment/edit controls. Poll authorization every5s and on focus; revoke prevents subsequent server reads immediately, already-displayed content clears on next check. Cannot retract images already downloaded or screenshotted. No localStorage/sessionStorage tokens, no raw tokens in logs or DOM output outside the user-requested copyable link. Fragments remain for refresh; set no-referrer/noindex metadata and no-store API responses.

## Task1 — Persisted share authorization

Files: `src/db/share-repository.ts`, `drizzle/0003_shares.sql`, `src/db/schema.ts`, `src/db/migrate.ts`, `tests/shares.test.ts`.

- [x] Write failing real database contracts for create/list/revoke/snapshot/image read. New class takes Connection and LocalImageStore. API:
```ts
create(actor: Actor, presentationId: string, hours: 1 | 24): Promise<{id:string;token:string;expiresAt:string}>
list(actor: Actor, presentationId: string): Promise<Array<{id:string;expiresAt:string;revoked:boolean}>>
revoke(actor: Actor, shareId: string): Promise<void>
snapshot(shareId: string, token: string): Promise<{presentation: WorkspacePresentation; expiresAt:string}>
read(shareId: string, token: string, assetId:string): Promise<{bytes:Buffer;mimeType:string;width:number;height:number}>
```
- [x] Run new tests RED, then implement migration+repository. Max20 total links per presentation (revoked count too, explicit local limit); serialize quota by project lock. Owner-only create/list/revoke. Persist issuer ID, presentation composite FK, hash64hex, expiry, revoked boolean, createdAt. No plaintext secret storage. Issuer must remain active owner for guest access; missing/revoked/expired/wrong token/foreign asset return not-found. Invalid owner input returns invalid. Recheck wall time after locks/file I/O. Lock project, issuer member/membership, share, presentation consistently; avoid share→project deadlock. Unauthorized reads must never access files.
- [x] Cover other presentation in same project, other project/workspace, orphan/pending assets, corrupted size, owner downgrade/expiry, token malformation, revoke, quota concurrency, expiry during locks and file I/O. Apply only new0003 through migrator; never modify applied0000–0002 or database clusters. Run full DB suite sequentially.

## Task2 — HTTP contracts + browser UI

Files: `src/server/runtime.ts`, `src/app/api/shares/route.ts`, `src/app/api/shares/[id]/route.ts`, `src/app/api/shared/[id]/route.ts`, `src/app/api/shared/[id]/assets/[assetId]/route.ts`, `src/app/share-manager.tsx`, `src/app/share/[id]/page.tsx`, `src/app/share/[id]/shared-view.tsx`, `src/app/workspace.tsx`, `src/app/globals.css`, `e2e/shares.spec.ts`.

- [x] Write failing browser journeys using real uploads. POST /api/shares `{presentationId,hours}` returns id/token/expiresAt; GET /api/shares?presentationId lists; DELETE /api/shares/id revokes. Owner routes use actor and exact Origin writes. GET /api/shared/id and assets/id require bearer, reject missing/bad tokens. Shared requests never authorize private owner endpoints.
- [x] Run browser test RED on missing Create view-only link. Implement routes using ShareRepository; private no-store nosniff images and no-referrer on shared resources. Shared page contains no server-rendered presentation data, reads fragment on client.
- [x] Inline manager labelled Share presentation; duration select1h/24h; Copy link with manual read-only textbox fallback and explicit copy failure. Existing execute handler preserves session-expiry clearing. Manager keyed presentation; clear transient token on switch/logout.
- [x] Visitor fetches snapshot and blob images with Authorization header, aborts obsolete reads and revokes objectURLs. Use a cancellable5s poll, focus check, and retry. 404 clears current image and snapshot; transient failure blocks image display with retry rather than claiming revocation. Choose current latest version by default; selectors reset cleanly. Reuse image proportions and tokens; phone no overflow.
- [x] Test separate-session image rendering, version switch, owner-only endpoints, token not in server-request URLs, revocation blocks metadata/assets and clears open visitor; invalid/missing token, image retry, mobile screenshot, copy feedback, and owner session expiry.

## Task3 — Verification and local handoff

- [x] Run unit/DB/browser suites, strict typecheck and production build. Inspect actual desktop/mobile screenshots. Independent spec then quality review; reproduce repairs before fixes. Record exact results and remaining comment/public-share gaps.
- [x] Commit only scoped files in retained codex/browser-workspace; no remote/push or cleanup of user data. Keep local4310 preview for acceptance and explain link limitations.
