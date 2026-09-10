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

## First implementation milestone

Establish independently tested project/share authorization and normalized pin
coordinates. These are domain foundations only, not a completed application.

Run foundation tests with Node 24:

```sh
npm test
```

Next milestones add PostgreSQL/Drizzle persistence, local signed image storage,
Auth.js/demo sessions, the Next.js/React interface, and browser acceptance tests.
Third-party dependencies and assets will retain their required license notices.
