# Frame Note

Design review that stays attached to the work.

An independently authored application for presentations, image-based feedback,
and screen-version comparison. MIT-licensed. This repository is in early
development: there is no runnable user interface or public release yet.

## Delivery

Local development and user acceptance come before GitHub publication. No cloud
account, custom domain, or hosted deployment is required for acceptance.

## Planned workflow

Create a presentation, upload images, reorder screens, share a presentation,
place and resolve pin comments, upload a second version, and compare versions.
The finished workflow must use persisted data, not hard-coded success responses.

## Implemented foundations

Independently tested project/share authorization and normalized pin coordinates
are implemented. PostgreSQL now persists projects, memberships, presentations,
screen ordering and immutable version metadata. Repository operations resolve
current persisted roles and expiry; they do not trust a caller-supplied role.
These are application foundations, not a completed review workflow.

Install and run foundation tests with Node 24:

```sh
npm ci
npm test
npm run typecheck
```

For real database tests, follow [local database setup](docs/local-database.md),
then run `npm run db:migrate` and `npm run test:db` (Docker requires the documented
transport flag). Development and tests use separate local databases. Database
tests add isolated fixtures; they do not reset existing data.

Next milestones add local signed image storage, Auth.js/demo sessions, comments,
protected shares, the Next.js/React interface, and browser acceptance tests.
Third-party dependencies and assets will retain their required license notices.

See [the local acceptance checklist](docs/acceptance-zh.md) for the eventual
user review journey. Passing repository tests is not browser or product acceptance.
