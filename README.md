# Frame Note

Design review that stays attached to the work.

An independently authored application for presentations, image-based feedback,
and screen-version comparison. MIT-licensed. This repository is in early
development: the first local browser workflow is runnable; there is no public
release yet. This is not the completed design-review product.

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
The private image adapter validates and normalizes PNG/JPEG/WebP with bounded
sizes and dimensions, strips source metadata, and stores immutable local files.
Asset upload/read is connected to persisted membership and project storage
quotas. The browser now creates isolated 24-hour demos, presentations and screens,
uploads private images, adds immutable versions, switches versions, and reloads
persisted work. Each image asset and its version are saved in one transaction.
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

## Run the local browser preview

After database setup and migrations, run `npm run dev` and open
http://127.0.0.1:4310. Click **Start a private demo**, create a presentation,
give a screen a title and choose an image, then click **Upload screen**.
Use **Upload new version** and the **Version** selector to review revisions.
Refresh to check persistence. **Sign out** revokes this demo's access; it is not
a permanent account and there is no recovery after logout/24-hour expiry yet.

`npm run test:browser` runs local Chrome journeys against the running server.
It creates disposable demo workspaces in the development database. `npm run build`
checks the production build; `npm start` serves it locally after stopping dev.
The browser is bound to loopback, not the public network.

For this machine's retained worktrees, see [the current checkpoint](docs/development-status.md)
for the private-config reference. Do not initialize competing databases.

## Review a version

Click **Add pin** below an uploaded image, then click the part you want to discuss.
Write your comment and choose **Post comment**. Click a numbered pin to read its
discussion, post a reply, **Resolve thread**, or **Reopen thread**. Keyboard users
can choose **Place at center**, then adjust the horizontal/vertical percentages.
Comments are stored against exactly one version: uploading v2 keeps v1 feedback
on v1. Switch back to read it. Refresh preserves messages and resolution state.
The current demo owner can comment. Shared links are read-only by default; a
link created with **Allow guest comments** lets visitors add pins and replies
for that version. Guests are labeled **Guest** and cannot edit, upload, resolve,
or reopen threads.

## Compare and share

After uploading two versions, choose **Compare versions** for side-by-side or
keyboard/pointer-controlled **Overlay** comparison. Images keep their proportions
and use the same scale. **Back to review** restores the original review context.

Under **Share presentation**, choose a 1-hour or 24-hour duration and create a
view-only link. Enable **Allow guest comments** only when visitors should be
able to add version-specific pins and replies. Copy the full address into a
separate browser session on this computer. Anyone holding it can see all current
and future versions in that one presentation; comment access is controlled by
the checkbox and never grants editing or uploads. Links cannot outlive their project
or issuer. **Revoke link** blocks subsequent reads; open visitors clear the view
on their next access check (normally every 5 seconds). Downloaded images cannot
be recalled. Only a SHA256 token hash is stored; the plaintext link is shown once
and cannot be recovered after leaving or refreshing. There is a 20-link lifetime
limit per presentation, including revoked links. Local links are not hosted URLs.

Next milestones add presentation mode, permanent login, signed grants, resource
cleanup and full acceptance/accessibility testing.
See [image storage policy](docs/local-images.md) and
[third-party dependencies](THIRD_PARTY.md) for storage limits and license notes.

See [the local acceptance checklist](docs/acceptance-zh.md) for the eventual
user review journey. Passing repository tests is not browser or product acceptance.
