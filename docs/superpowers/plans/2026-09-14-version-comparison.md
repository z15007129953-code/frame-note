# Version comparison implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the component, followed by specification and quality reviews. Use test-driven-development throughout.

**Goal:** Compare two revisions of the same screen side by side or with a draggable reveal, without mixing comment context.

**Architecture:** A client comparison component consumes the existing authorized workspace snapshot and private asset endpoint. A screen-keyed review-stage component owns review/compare mode and keeps the current ReviewCanvas mounted but hidden during comparison so draft comments survive. No migrations, uploads, permission changes or public routes.

**Tech Stack:** Next 16, React 19, strict TypeScript, existing CSS tokens, Playwright with Chrome.

## Approved design and boundary

The suite specification §6.2 approves side-by-side and overlay comparison; the user delegated detailed design choices. Reuse `.impeccable.md` gallery-worktable context, fonts and palette. Two equal common canvases share width=max(widths), height=max(heights). Images align top-left at the same scale, retain aspect ratio, and never crop or stretch. Neutral empty area is explicitly explained. Phone side-by-side stacks the two canvases; overlay remains usable. Mode controls are native buttons with pressed state; reveal uses a native labelled range plus pointer drag. Comparison offers no pin creation. Versions must be distinct and from the same screen; selecting the other version swaps the pair. Existing review selection is preserved when entering and leaving compare. Screen/version changes reset comparison context; busy operations disable switching. Initial pair uses current reviewed version and its predecessor (or next version for v1).

## Task 1 — Browser contracts and stage acceptance

Files: `e2e/comparison.spec.ts`, `docs/acceptance-zh.md`.

- [x] Write failing tests using original sharp PNG fixtures and real workspace routes, with origin header on writes. Test single-version guidance and Compare versions entry after v2, distinct pair defaults and swapping, review-draft retention, left/right labels, side-by-side scale and mobile stacking, overlay keyboard and pointer reveal, image failure/retry and private outsider refusal.
- [x] Run `npx playwright test e2e/comparison.spec.ts`; expect missing Compare versions control on current build. Keep evidence of expected failure. Four tests individually failed at missing guidance/control on the original production build. Fixture creation now waits for session readiness before API writes.
- [x] Record September 14 upload/version/pin-comments acceptance, explicitly not complete product approval or permission to publish.

Test anchors:
```ts
await page.getByRole('button', { name: 'Compare versions', exact: true }).click();
await expect(page.getByLabel('Left version', { exact: true })).toHaveValue('1');
await expect(page.getByLabel('Right version', { exact: true })).toHaveValue('2');
await page.getByRole('button', { name: 'Overlay', exact: true }).click();
await page.getByRole('slider', { name: 'Reveal left version' }).press('Home');
await expect(page.getByRole('slider', { name: 'Reveal left version' })).toHaveValue('0');
```

## Task 2 — Isolated comparison UI

Files: create `src/app/version-comparison.tsx`, `src/app/review-stage.tsx`; modify `src/app/workspace.tsx`, `src/app/globals.css`.

- [x] After Task 1 red result, implement review-stage integration; preserve hidden review drafts on mode toggle, reset keyed screen/version context on selection changes.
- [x] Implement version selection, explicit pair labels/dimensions, native Side by side / Overlay controls, same-scale canvases, native reveal slider and pointer-captured divider. Image layers are keyed by asset and attempt; each displays loading/error and Retry left image / Retry right image. A failed image must never silently show an older selection or look like a valid empty image. Controls disable during writes.
- [x] Reuse `/api/assets/${version.assetId}?attempt=${attempt}` only. No secret/token URLs or public asset grants. Callback to existing session handler on authorization failure if needed.
- [x] Style using existing spacing and colors, container query for side-by-side width, visible focus and 44px targets. No new typography or animation system.
- [x] Run `npm run typecheck`, rebuild and restart local4310 preview, then browser contracts. Expected pass. Update welcome scope to include comparison but not imply sharing exists.

Geometry contract:
```ts
const width = Math.max(left.width, right.width);
const height = Math.max(left.height, right.height);
const imageStyle = { width: `${version.width / width * 100}%`, height: 'auto' };
const canvasStyle = { aspectRatio: `${width} / ${height}` };
// Overlay clipping must clip a full-sized layer; never resize the image.
const clipPath = `inset(0 ${100 - reveal}% 0 0)`;
```

## Task 3 — Verification, reviews and handoff

Files: `docs/development-status.md`, `docs/acceptance-zh.md`, this plan.

- [x] Run `npm test`, `npm run typecheck`, `npm run build`, real DB tests sequentially with retained private env, and all Chrome journeys. Final results: 347 unit tests, 70 DB tests, 14 Chrome journeys; strict typecheck and production build pass.
- [x] Inspect desktop and390px screenshots for artwork scale, controls, loading/errors and overflow. Browser emulation is not real-device certification.
- [x] Independent specification review, then code-quality review. Reproduce findings with failing tests before repairs and request re-review. Both approved after busy-state overlap and comparison re-entry cache regressions were repaired; no blocking findings remain for this local milestone.
- [x] Record exact fresh results and remaining gaps; commit only scoped files locally. Retain worktree and local data; no remote, push, hosting or DNS. Implementation commits: caa9de1 and 023b0b0.
- [x] Present local preview and a short Chinese operation guide for comparison acceptance. Chrome opened at localhost4310; detailed guide is in docs/acceptance-zh.md. Full product sharing and other approved features remain subsequent work.
