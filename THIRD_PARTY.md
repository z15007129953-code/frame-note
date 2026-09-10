# Third-party dependencies

Frame Note's original application source is MIT-licensed. Dependency licenses
remain independent and are not replaced by the repository's license.

- `sharp` 0.35.4 — Apache-2.0; image decoding and normalization. Its installed
  distribution contains the license and its native dependency distributions
  retain their own notices. Preserve these files when packaging runtime binaries.
- `drizzle-orm` 0.45.2 — Apache-2.0; database schema/types.
- `postgres` 3.4.9 — Unlicense; PostgreSQL client.
- `zod` 4.5.4 — MIT; input schemas.
- TypeScript and Node.js development types retain their package licenses.

`package-lock.json` records exact dependency versions and integrity hashes.
Install with `npm ci`. This source repository does not vendor third-party
application source or native binaries. A packaged application must include the
license/notice files for all bundled transitive and native dependencies, not just
the direct dependencies listed here.

Storage tests generate their own solid-color/noise fixtures. No upstream product
screenshots, artwork or branding are included.
