# Development checkpoint — 10 September 2026

Frame Note now has a runnable first local browser slice. It is **not** the
finished review product and has not received user acceptance. No public remote,
cloud deployment or domain configuration is part of this checkpoint.

## Working browser journey

Start a private demo → create presentation → name and upload a screen → reload
persisted image → upload another version → switch versions → sign out.
Invalid images show a useful error; the created empty screen can be finished
through the new-version form. Image read failures have a retry action. Session
loss returns to the demo entry, clearing pending files and titles.

Next.js 16.3.4 / React 19.3.0 call permission-checked Node routes. Random 32-byte
demo tokens are stored only as SHA256 hashes; cookies are HttpOnly, SameSite
Strict and expire after 24 hours. Writes require the exact configured Origin.
Actor IDs come exclusively from the session, never request fields. Images have
private no-store responses, with membership checked on every request.

Image assets and version rows are saved in one database transaction after
screen scope, permission and capacity checks. Real PNG/JPEG/WebP is fully
decoded, normalized and stripped of source metadata. Prior versions remain
immutable. Filesystem failures or ambiguous commits retain private orphan files
to avoid deleting possibly committed data; reconciliation is still pending.

## Verified checkpoint

- 347 unit tests; 55 real PostgreSQL integration tests, no skips.
- Six Chrome journeys pass against both development and production servers;
  browser tests cover persistence/version selection, second-session isolation,
  cross-origin refusal, invalid-image recovery, image retry, busy selection,
  new-session draft isolation and session-expiry recovery.
- Strict TypeScript and production build checks passed. Build tracing excludes
  runtime uploads; no `.local` or `.env` paths remain in the API trace manifests.
- Desktop and 390px viewport screenshots inspected. This is browser emulation,
  not a real iPhone/Android or full accessibility certification.
- Independent backend specification and code-quality reviews performed.
  Client draft isolation findings were reproduced and repaired with browser tests.

## Limits and honest gaps

- 100 presentations/project, 100 screens/presentation, 50 versions/screen.
- 500 image assets / 100 MiB canonical image bytes per project.
- 10 MiB upload limit, 4096-byte JSON limit, 30-second request-body deadline,
  two simultaneous image uploads per server process.
- The 1000-session cap only counts session rows still present. Logout removes
  the session but retains workspace data. It does **not** bound cumulative demo
  workspaces/files. No automatic expiry/orphan cleanup or global disk cap yet.
- Local-only preview; no internet-facing rate limiting or permanent accounts.
- No persisted comments/resolution, protected sharing, comparison, presence,
  signed grants, cleanup workflow, presentation mode or UI reordering yet.
- Uploads have no idempotency key: after an ambiguous network failure, inspect
  current versions before retrying. Screen creation precedes image upload.
- Demo logout/expiry removes access; permanent recovery/export is not implemented.
  Use disposable test artwork, not irreplaceable or confidential source files.

## This machine's retained workspaces

The native development/test PostgreSQL clusters and private `.env.local` belong
to `.worktrees/persistence`. Run their lifecycle commands there; do not move data
or initialize competing clusters on ports 54341/54342. Images for this browser
preview belong to `.worktrees/browser-workspace/.local/images`.

From `.worktrees/browser-workspace`:

```sh
FRAME_ENV_FILE=../persistence/.env.local npm run dev
# Open http://127.0.0.1:4310
npm run test:browser
node --env-file=../persistence/.env.local --test --test-concurrency=1 tests/*.test.ts
```

For a fresh clone, follow [local database setup](local-database.md), apply
migrations, then `npm run dev`; Next reads the clone's `.env.local` normally.
No credentials, image uploads or database data are tracked in Git.

Next: comments and sharing, comparison, cleanup, permanent login and complete
acceptance/accessibility checks. User approval is required before GitHub publication.
