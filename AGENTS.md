# Frame Note development

This is an independent repository. Do not copy upstream application source,
history, branding, or documentation. Suite-authored utilities may be reused
deliberately with their provenance intact.

Current delivery is local acceptance followed by GitHub publication only.
Never create a remote or push before the user's explicit acceptance of Frame Note.
Do not provision cloud services, modify DNS, or change other suite repositories.

Use `.worktrees/` for isolated worktrees. Keep local data and secrets ignored.
Use impeccable teach/craft for UI work; see `.impeccable.md` for confirmed context.
Use strict TypeScript, test-first domain rules, and real PostgreSQL integration
tests when persistence is introduced. Domain policy is not a substitute for
server-side membership lookup or transactional authorization.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
