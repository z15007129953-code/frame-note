# Guest Comments Design

**Status:** Approved by the user on 2026-09-24.

## Goal

Allow a share link owner to opt into comments. A visitor holding an active,
comment-enabled link can read comments for the shared presentation, add a pin
to a specific version, and reply to existing threads. Owners keep resolve and
reopen control; visitors never gain upload, edit, or workspace membership.

## Authorization

The share row stores `allow_comments`, defaulting to false. Existing links stay
read-only. Every guest comment request revalidates the bearer hash, issuer
ownership, share expiry/revocation, project/member expiry, presentation scope,
and the selected version inside one transaction. Revocation or expiry blocks
listing, creation, and replies immediately.

Guest messages have no member identity. They reference the issuing share and are
rendered as `Guest`; owner-created messages continue to reference their member.
The same existing comment thread model is used, so owners and comment-enabled
visitors see one version-specific discussion. A guest cannot resolve or reopen a
thread.

## UI and behavior

The owner creates a link with an `Allow guest comments` checkbox. The share list
shows whether each link is read-only or comment-enabled. The shared page exposes
a comments section only when enabled, with a pin placement mode, coordinate
fallback, message/reply forms, loading/retry/error states, and no upload/edit
controls. Pin coordinates remain normalized to the displayed image.

## Verification

Real PostgreSQL tests cover migration compatibility, default read-only links,
guest create/list/reply authorization, owner resolve/reopen, version and
presentation isolation, revocation/expiry, malformed input and quotas. Chrome
journeys cover opt-in creation, guest pin/reply, owner visibility and resolve,
read-only denial, revoke clearing, version switching, retry and mobile layout.
