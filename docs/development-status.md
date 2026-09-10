# Development checkpoint — 10 September 2026

Frame Note is at the domain-foundation stage. There is no runnable review UI,
database-backed workflow, upload service, public repository, or hosted website.
Do not treat this checkpoint as product acceptance.

## Implemented and verified

- Independent local Git history, MIT license, design context and acceptance list.
- Server-fact access policy for viewer/collaborator/owner and public/token shares.
- Exact project/workspace/presentation scoping, expiry, revocation and malformed
  input rejection. Authentication and persisted fact resolution are still pending.
- Image-relative normalized pins and projection after resizing; image bounds,
  invalid geometry, fractional edges and out-of-bounds underflow are checked.
- Pinned TypeScript 5.9.3 / Node 24 types and reproducible npm development lockfile.

Verification at `92d2c31`: Node 24.14.0 ran 275 tests, all passing with no skips.
`npm run typecheck` passed. The small domain-only coverage run reported 100% lines
and 98.10% branches; this is not application coverage.

Access policy passed independent specification and quality reviews. The quality
review's minor test-oracle concern was addressed with literal permission tables.
Pin review identified fractional-edge rejection and subnormal-coordinate underflow;
both have regression tests and fixes. Final pin re-review is pending.

## Next work

1. PostgreSQL/Drizzle schema, migrations, independently isolated dev/test databases.
2. Persisted project membership, signed demo sessions, protected share lifecycle.
3. Local signed image upload/read adapter, size/type/quota validation and cleanup.
4. Presentations, screen ordering, immutable versions, comments and activity.
5. Impeccable craft interface, presentation mode, comparison and mobile support.
6. Real browser acceptance, accessibility, docs and reproducible production build.
7. User acceptance, then GitHub publication and CI verification.

No cloud provisioning, DNS changes or hosted deployment is in the current scope.
