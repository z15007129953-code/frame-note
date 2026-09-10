# Development checkpoint — 10 September 2026

Frame Note has domain foundations, PostgreSQL-backed review repositories and
a private local image upload/read service. There is no runnable review UI,
HTTP upload endpoint, public repository or hosted
website. Do not treat this checkpoint as product acceptance.

## Implemented

- Independent local Git history, MIT license, design context and acceptance list.
- Server-fact access policy for viewer/collaborator/owner and public/token shares.
- Tenant-scoped relationships, persisted membership/role checks, expiry and
  revocation. Authentication/session resolution is still pending.
- Image-relative normalized pins and projection after resizing; image bounds,
  invalid geometry, fractional edges and out-of-bounds underflow are checked.
- Pinned TypeScript 5.9.3 / Node 24 types and reproducible npm development lockfile.
- Typed Drizzle schema and transactional checksum-verified PostgreSQL migrations.
- Persisted projects, owner memberships, presentations and ordered screens.
- Immutable version metadata, idempotent creation and concurrent version numbering.
- Atomic exact-permutation reordering and 100-screen / 50-version limits.
- Separate local PostgreSQL 17 development/test clusters and optional Compose setup.
- Strict local test-target, resolved-driver destination and server-identity checks.
- Fully decoded/re-encoded PNG/JPEG/WebP images, orientation correction, stripped
  source metadata, 10 MiB input/output and bounded pixel/dimension limits.
- Private immutable filesystem files, strict opaque keys, descriptor-based reads,
  symlink/hard-link refusal and root/permission-change detection.
- Persisted asset upload/read with live membership checks, 500-asset / 100 MiB
  project quotas and expiry rechecks after locks and filesystem I/O.

## Verification

At `d35e02f`, Node 24 ran 343 unit tests and 37 real PostgreSQL integration tests
(19 review + 18 image-asset cases), all passing with no skips; strict TypeScript
checking passed. Upload-to-version and reopened filesystem/database reads are
verified. Earlier development schema migration and repeated no-op migration
passed; this image milestone changes no schema. Native database checks run on
loopback ports 54341 (development) and 54342 (tests). Docker identity policy has
unit coverage but has not been exercised against a live Docker installation.

Specification review approved the persistence milestone after correcting expiry
checks following authorization lock waits. The important quality-review finding
was also fixed: version creation and reordering recheck expiry after downstream
resource locks. Six additional regressions cover project/member expiry while
waiting for screen or asset locks. Final independent quality re-review approved
local integration with no critical or important findings remaining. Partial
initialization recovery remains manual and is documented in the setup guide.

The image validator/filesystem adapter and asset service both passed independent
specification and quality reviews, with no critical or important findings left.

## Local workspace handoff

The initialized native databases and private `.env.local` currently belong to
the retained `.worktrees/persistence` checkout. Database lifecycle commands run
there. Image-backend tests use `.worktrees/image-storage` with
`node --env-file=../persistence/.env.local --test --test-concurrency=1 tests/*.test.ts`.
Do not initialize competing clusters on the same ports from the primary checkout,
move its data directories, or remove the worktree. Cluster markers intentionally
bind to the absolute original path. No credentials or database files are tracked.

For a fresh clone, follow [local database setup](local-database.md). No cloud
account or custom domain is necessary.

## Next work

1. Signed demo/auth sessions and protected share lifecycle.
2. Signed HTTP image operations, request limits and explicit orphan/expiry cleanup.
3. Persisted pin comments, resolution, mentions, activity and presence.
4. Impeccable craft interface, presentation mode, comparison and mobile support.
5. Real browser acceptance, accessibility, documentation and production build.
6. User acceptance, then GitHub publication and CI verification.

The asset service verifies file contents before saving ready metadata. Actor IDs
must still come from authenticated server sessions, never trusted request fields.
Failed writes/ambiguous database commits retain private orphan files to avoid
deleting potentially committed data. Reconciliation is deferred, documented in
[local image storage](local-images.md), and required before full demo acceptance.

No cloud provisioning, DNS changes or hosted deployment is in the current scope.
