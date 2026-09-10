# Frame Note Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for independently reviewable repository work. Checkboxes track actual completion.

**Goal:** Persist projects, project membership, presentations, screens and immutable image-version metadata in real PostgreSQL.

**Architecture:** Typed Drizzle schema with composite tenant foreign keys. Repository mutations resolve current persisted membership inside a transaction, lock the project first, and refuse expired projects or insufficient roles. Local database tooling uses separate dev/test clusters; tests create unique records and never truncate shared data. No UI or cloud provisioning in this milestone.

**Tech Stack:** Node 24, TypeScript, PostgreSQL 17, Drizzle ORM 0.45.2, postgres 3.4.9, Zod 4.5.4.

## Files

- `scripts/local-db.mjs`: initialize/start/stop only Frame Note local clusters, SCRAM authentication, generated private local environment; requires an explicit PostgreSQL binary directory.
- `src/db/test-target.ts`, `src/db/test-target.test.ts`: strict loopback test target validation, reject inherited PostgreSQL connection overrides.
- `src/db/schema.ts`: workspace, member, project, project membership, presentation, screen, asset, version tables.
- `drizzle/0000_review.sql`: matching SQL constraints and foreign keys.
- `src/db/connection.ts`: caller-owned postgres pool and Drizzle connection, no implicit environment access.
- `src/db/migrate.ts`: transactional SQL migration, checksum history, advisory locking, repeated migration no-op, changed applied migration refuses to run.
- `src/db/review-repository.ts`: server-side persisted membership checks and project/presentation/screen/version commands.
- `tests/persistence.test.ts`: actual PostgreSQL happy path, isolation, expiry, role downgrade, order validation, concurrent version creation, transaction rollback and reconnect persistence.

## Task 1 — Isolated local database and test guards

- [x] Write tests importing `assertTestTarget(url, overrides)` from `src/db/test-target.ts`: accept only `postgresql://user:pass@127.0.0.1:54342/frame_note_test` (also localhost/IPv6), reject remote, non-test database, query/hash, malformed name, missing explicit port, inherited `PGHOST`, `PGHOSTADDR`, `PGPORT`, `PGDATABASE`, `PGSERVICE`, `PGSERVICEFILE`, `PGOPTIONS` and invalid ports. Return the validated URL without printing credentials.
- [x] Run `node --test src/db/test-target.test.ts` red, implement URL parsing plus strict protocol/host/port/name allowlists, run green.
- [x] Add local db initializer using node built-ins. Only `.local/postgres-development` on 54341/frame_note and `.local/postgres-test` on 54342/frame_note_test; never use another app's data directories. Refuse existing env/cluster files on init. Generate random SCRAM password, create owner-only temporary password file, initdb/start/createdb, and exclusive `.env.local` mode 0600. Errors never print passwords. `start` and `stop` verify existing cluster metadata; sockets disabled, bind loopback. No reset/delete command.
- [x] Run initialization with installed PostgreSQL 17 binaries; verify explicit live database names and ports. Add Compose alternative with separate named volumes and loopback ports. Ignore all data and secrets.

## Task 2 — Schema, migrations, and repository

- [x] Write real database tests before implementing tables/commands. Tests require explicit `TEST_DATABASE_URL`, pass it through guard, query actual `current_database()` and `inet_server_addr()` before writes, and use random IDs. No truncation/reset. On missing URL the explicit db test command fails with setup instructions, not a skipped success.
- [x] Add tables and immutable SQL migration. Every relationship includes workspace scope; project-members connect project/member, screens connect presentation, versions connect screen and asset. Presentation/screen order is stable; unique `(screen_id, number)` prevents version collisions. Pin/comment tables are outside this milestone. Asset records represent server-verified uploads, not raw browser metadata; storage verification comes next milestone.
- [x] Implement `createConnection(url)` returning `{sql, db}` with max 5 connections, caller calls `sql.end()`. Migration acquires transaction advisory lock, validates SHA256 of prior migrations, applies once atomically, records checksum. Test migration twice and concurrent execution.
- [x] Implement class `ReviewRepository(connection)` with `createProject(workspaceId, memberId, title)`, `createPresentation(workspaceId, projectId, memberId, title)`, `createScreen(workspaceId, projectId, presentationId, memberId, title)`, `reorderScreens(workspaceId, projectId, presentationId, memberId, orderedIds)`, `addVersion(workspaceId, projectId, screenId, memberId, assetId)`, `listScreens(workspaceId, projectId, presentationId, memberId)`. Resolve membership from DB each time; no request-supplied role. Titles trim to 1..160 characters. Duplicate/missing/foreign screen IDs reject reordering atomically. Max 100 screens per presentation. All writes lock project before permission checks, use database wall-clock expiry after authorization and downstream resource locks and lock membership rows to serialize revocation. Actor member must belong to exact workspace and have active expiry. Viewer reads only; collaborator/owner edit. Members can create their own projects in their workspace, never gain rights to other projects. Project creation establishes owner membership transactionally. Return typed not-found/forbidden/invalid errors, no SQL details for eventual API response.
- [x] Add versions under project/screen locking with monotonic sequence, max 50 per screen; require matching ready asset in workspace and project. Duplicate asset on same screen is idempotent. Do not update earlier versions. Reconnect and read persisted rows.
- [x] Prove cross-workspace associations fail in DB, revoked/downgraded role denies writes, expired member/project denies reads/writes, viewer denial, stable ordering, concurrent version numbering and invalid reorder rollback. Run full tests/typecheck.

## Task 3 — Review and local integration

- [x] Independent spec review, then quality review; fix important findings and rerun.
- [x] Document exact setup, migrate/test commands, test results and limitations.
- [x] Integrate locally, preserve feature branches. No remote creation/push and no hosted deployment.

### Verification checkpoint

At `8f8d997`: 313 unit tests, 19 native PostgreSQL integration tests and strict
TypeScript checks pass. Specification review and final quality re-review approve
integration. Native clusters and private configuration remain in the persistence
worktree. Docker policy is unit-tested, not live-Docker tested. IPv6 URL parsing
in postgres 3.4.9 fails closed; use IPv4 or localhost. See local database docs for
partial-initialization recovery and runtime setup.

Primary checkout fast-forwarded to the persistence milestone; fresh `npm ci`,
313 unit tests and strict typechecking passed there. Both feature branches and
the initialized persistence worktree are retained. No remote is configured.

## Deferred acceptance work

Signed local image upload/read, real auth/demo sessions, protected share lifecycle,
comments/resolution/mentions, activity/presence, Next.js UI, presentation/compare
modes and full persisted browser acceptance remain required before user acceptance.
