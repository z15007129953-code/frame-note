# Local PostgreSQL

No hosted services or cloud account are required. Use Node 24 and PostgreSQL 17.
Never point the test runner at an important or shared database.

## Docker Compose

Copy `.env.example` to `.env.local` and replace the example password in all three
entries with the same randomly generated local password. Keep that file private.
On macOS/Linux run `chmod 600 .env.local` after creating it.

```sh
npm ci
docker compose --env-file .env.local up -d --wait
npm run db:migrate
npm run test:db
```

Development is `127.0.0.1:54341/frame_note`; testing is
`127.0.0.1:54342/frame_note_test`. The two Compose services use separate named
volumes. Do not run `docker compose down -v` unless you intend to delete that data.

## Existing PostgreSQL binaries (without Docker)

Point `FRAME_POSTGRES_BIN` at the absolute `bin` directory of an installed
PostgreSQL 17 distribution. The helper only uses those executable files; it creates
new Frame Note clusters and does not open another application's data directories.

```sh
FRAME_POSTGRES_BIN=/absolute/path/to/postgres/bin npm run db:local -- init
npm run db:migrate
npm run test:db
```

Initialization creates a random SCRAM password and `.env.local` with owner-only
permissions. It refuses existing clusters or configuration rather than overwriting
anything. A partial initialization remains on disk for diagnosis; no automatic
cleanup or destructive retry is performed.

Use `start`/`stop` instead of `init` after the first run. These commands validate
project-specific cluster markers. Keep native and Compose services mutually
exclusive because they use the same ports. Unix sockets are disabled for the
native helper; listeners are restricted to loopback.

## Test safety

`npm test` runs pure unit checks without PostgreSQL. `npm run test:db` requires an
explicit test URL and fails if it is absent. Connection overrides such as `PGHOST`,
`PGPORT`, `PGSERVICE`, and `PGOPTIONS` are rejected. The runner checks actual server
identity before writing. Tests create UUID-scoped fixtures rather than truncating
tables, so repeat runs accumulate disposable test records.

Schema migration is transactional, advisory-locked and checksum-verified. Applied
SQL must never be edited; add a migration for later changes. No rollback/reset tool
is provided. Back up important data before schema changes.

## Current limitations

These are database/repository checks, not browser acceptance. No HTTP server,
sign-in, real image upload, comments, or version-comparison UI is provided by this
milestone. Asset metadata is only trusted after the future storage adapter has
verified file contents; clients must never directly insert `ready` assets.
