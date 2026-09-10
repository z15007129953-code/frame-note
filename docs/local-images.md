# Local image storage

This backend milestone implements the approved local-only storage adapter.
It is not yet a browser upload endpoint or a complete review application.

## Image policy

Only PNG, JPEG and WebP are supported. The server compares the declared MIME
type with the decoded format, fully decodes the image, applies orientation and
re-encodes it without original metadata. Source and canonical output are limited
to 10 MiB each; images must be single-frame, at most 10,000 pixels on either axis
and at most 40 million pixels. SVG, GIF, animations, corrupt data and mismatched
formats are rejected. Re-encoding may change compression; original file bytes
are not preserved. Canonical pixels/dimensions are used for annotations.

## Private filesystem

The configured directory must be an absolute private path outside `public/` or
any web-served directory. Use a separate directory per application/environment.
For local development, use a project-owned directory such as `.local/images`;
tests use disposable temporary directories, never that development directory.
Files use server-generated opaque keys, not uploaded filenames. Never expose
this directory with a static-file server. File permissions are owner-only and
the adapter refuses path traversal, symlinks and unexpected root replacements.
The owning OS account is trusted: application path checks do not sandbox an
attacker who can modify the process, its parents or its private data directory.

## Database boundary

Uploads and reads are mediated by persisted project membership, not by a
caller-supplied role. HTTP routes must resolve actor IDs from authenticated
sessions before invoking this backend. Viewer membership permits reading only;
collaborators and owners can upload. Protected/public share access requires a
separate share-lifecycle service and is not automatically granted by a file key.

The project upload policy is at most 500 assets and 100 MiB of canonical bytes;
existing pending metadata also counts. Quotas are checked under the project
lock so concurrent uploads cannot exceed them. File writes complete before ready
metadata is inserted. Existing assets are not overwritten by a new upload.

The service holds authorization locks during bounded image decoding and file
I/O, then rechecks expiry before inserting metadata or returning bytes. This
prioritizes correct revocation and quotas over concurrent throughput for a single
project. Request-level rate/concurrency/time limits are required when HTTP routes
are added. A ready row assumes trusted application writers and a private disk;
the current read check detects missing files and byte-length disagreement, not
arbitrary same-size modification by the trusted operating-system owner.

## Failure and retention

A filesystem and PostgreSQL transaction cannot commit atomically. If a database
insert/commit fails after a file write, the file is retained: deleting it on an
ambiguous commit could destroy a successfully committed asset. Failed writes may
also leave a partial, unreferenced opaque file. These orphans are not readable
through the permission-checked asset API, but consume disk space outside the
database quota. Explicit reconciliation and retention cleanup are still required
before public demo acceptance. There is no automatic reset or recursive cleanup.

Back up the database and image directory together. Restoring only one can leave
missing assets or unreferenced files. Missing/invalid storage is an error, never
a fabricated successful upload. Browser signed grants, request limits, sessions
and user-facing retry states are part of the next application integration stage.

## Backend verification in the current workspace

The existing native clusters are owned by the retained persistence worktree.
From `.worktrees/image-storage`, use their private configuration explicitly:

```sh
npm test
npm run typecheck
node --env-file=../persistence/.env.local --test --test-concurrency=1 tests/*.test.ts
```

Do not initialize another cluster or copy database directories. For a fresh
standalone clone, create its own `.env.local` using the local database guide,
then `npm run test:db` discovers both persistence and asset test files.
