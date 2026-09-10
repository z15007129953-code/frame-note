# Frame Note Local Image Storage Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for implementation and independent specification/quality review. User already approved the product specification and local-only storage delivery; this plan implements that scope without UI or cloud changes.

**Goal:** Store validated image bytes locally and associate them with permission-checked persisted assets usable by screen versions.

**Architecture:** A bounded image validator decodes and re-encodes PNG/JPEG/WebP. A private flat filesystem adapter writes opaque immutable keys. A repository service uses existing project/member locks and current permissions to save ready asset metadata and read its verified bytes. Files are not web-public; HTTP/session/share adapters will call this service in the subsequent application milestone.

**Tech Stack:** Node 24, TypeScript, sharp (pinned registry release), existing PostgreSQL 17/postgres/Drizzle/Zod.

## Task 1 — Verified images and private filesystem adapter

Files: `src/storage/image-validator.ts`, `src/storage/local-image-store.ts`, `src/storage/errors.ts`, `image.test.ts` / `local-image-store.test.ts`; `package.json` / lockfile.

- [x] Add sharp pinned dependency and add `src/storage/*.test.ts` to unit test script.
- [x] Write failing image tests using sharp-generated original fixtures. Public API `validateImage(bytes: Buffer, declaredMime: string): Promise<ValidatedImage>`, result `{bytes, mimeType, width, height, byteSize, extension}`. Accept PNG/JPEG/WebP only; actual format must match declared MIME. Input/output <=10 MiB, dimension <=10000 each, <=40 million pixels, single page only. Reject SVG/GIF, empty/corrupt/truncated data, wrong MIME and oversized input. Fully decode/re-encode, auto-orient, strip metadata; metadata-only inspection is insufficient. Tests confirm EXIF orientation/dimensions and no retained private metadata.
- [x] Run `node --test src/storage/image.test.ts` red, implement bounded decoding with sharp `failOn: 'warning'` / `limitInputPixels`, then rerun green. Errors use stable generic `StorageError` codes `invalid-image`, `invalid-key`, `not-found`, `storage-failed`; never expose local paths or input bytes.
- [x] Write failing real filesystem tests for `LocalImageStore.open(absoluteDirectory)` -> adapter with `put(image): Promise<string>` and `read(key): Promise<Buffer>`. Flat keys are server-generated UUID + canonical extension. Private directory0700/files0600, exclusive writes, never overwrite. Reject malformed/traversal keys, symlink files/root and non-regular reads; cap read size. Test roundtrip/reopen and missing file without leaking paths. Use generated temporary test directories; remove only these test-owned directories in teardown.
- [x] Implement adapter green. Use a privately owned root outside web-public; check canonical root and use no-follow descriptor opens. Read from the opened descriptor after regular-file/size validation. Defend against symlink substitution of the configured root by checking its identity. No recursive production delete/reset or list-all endpoint.
- [x] Unit/typecheck, independent spec review then quality review; commit assigned files.

## Task 2 — Persisted asset service with real authorization

Files: `src/db/review-authorization.ts` extracted from existing repository, `src/db/review-repository.ts`, `src/db/asset-repository.ts`, `tests/assets.test.ts`; scripts and docs.

- [x] Write database tests against the existing strictly guarded local test database. API `new AssetRepository(connection, store).upload(workspaceId, projectId, memberId, bytes, mime)` returns camelCase persisted asset; `.read(workspaceId, projectId, memberId, assetId)` returns `{bytes,mimeType,width,height}`. Actor IDs are server-session facts, not HTTP request roles. Test owner/collaborator uploads, viewer reads only, outsider/cross-tenant/revoked/expired denial, new version using uploaded asset, reopened file/database reads, corrupt input leaves no asset, and ready status only after bytes exist.
- [x] Run test red before implementation. Extract unchanged shared authorization helpers and `ReviewError` into focused module; all existing tests must retain behavior. Asset operations lock project/member/membership in existing order. Check expiry again after image/filesystem work before insert/return. UUIDs and MIME/bytes checked at boundaries. No share access until share lifecycle is implemented.
- [x] Under project lock enforce at most500 assets and100MiB total canonical bytes per project (including existing pending rows); concurrent writes cannot overshoot. Single file cap stays10MiB. Tests create boundary fixtures and prove no additional row on quota denial.
- [x] Decode image only after persisted edit authorization. Store canonical bytes, then insert ready metadata using server-generated key and actual dimensions/size; no arbitrary client keys/ready states. Read exact workspace/project asset and confirm canonical file byte length matches stored metadata; fail closed for missing file. Internal metadata never includes absolute paths.
- [x] Failed DB insert/uncertain commit may leave an unreferenced immutable file; never delete a potentially committed file automatically. Document this conservative failure mode and deferred explicit orphan reconciliation. Do not expose a user-triggered delete or automatic cleanup in this milestone.
- [x] Run `npm test`, `npm run typecheck`, existing19 DB tests plus new asset tests sequentially. New worktree uses explicit `--env-file=../persistence/.env.local` only for checks; do not copy/move clusters or credentials.
- [ ] Independent spec review then quality review; fix important findings with regressions. Update README/status with actual verified capability and explicitly note no UI/HTTP/session/signed-share acceptance yet. Integrate locally while retaining data worktrees. No push.

## Acceptance boundary

This completes a storage backend slice, not the browser upload journey. Signed
HTTP grants, real sessions, comments, shares, presentation/comparison UI and
browser acceptance remain required. Local storage is intentionally persistent
and private; no cloud provider, account, DNS or remote repository is involved.
