# Version-specific pin comments

> Execute with superpowers:subagent-driven-development: delegate the independent
> repository task, then independent specification and quality reviews. The main
> agent integrates HTTP and UI. This continues the user-approved suite spec 6.2
> and acceptance items 6/8, with delegated detailed design choices.

Goal: place a pin on an uploaded version, post/reply, resolve/reopen, refresh and
switch versions without losing or mixing discussion context. Local only.

## Backend contract

Create `src/db/comment-repository.ts`, `tests/comments.test.ts` and immutable
`drizzle/0002_comments.sql`; update schema, migration registry/count test.

`CommentRepository(connection)` methods:

```ts
type Message = {id:string;body:string;authorId:string;createdAt:string};
type Thread = {id:string;versionId:string;x:number;y:number;resolved:boolean;messages:Message[]};
list(actor:Actor,versionId:string):Promise<Thread[]>
create(actor:Actor,versionId:string,pin:{x:number;y:number},body:string):Promise<Thread>
reply(actor:Actor,versionId:string,threadId:string,body:string):Promise<void>
setResolved(actor:Actor,versionId:string,threadId:string,resolved:boolean):Promise<void>
```

- [ ] Write and run failing real DB tests first: persistence, version/project
  isolation, viewer read-only, collaborator/owner writes, revoked/expired denial,
  finite normalized coordinates, 1–2000 trimmed text characters, 100 threads per
  version and 100 messages per thread, concurrent last-slot quota, resolve/reopen.
- [ ] Implement all methods with persisted `authorize`, project/member locks,
  exact tenant/project/version scope, expiry recheck after downstream waits and
  before writes/returns. Root message and thread insert share one transaction.
  Composite FKs bind version/thread and author to the same workspace/project.
  `list` returns bounded ordered messages, no paths/tokens. Viewer writes remain
  forbidden until explicit shared-comment permissions are implemented later.
- [ ] Run DB suite sequentially with existing persistence private env. Never edit
  migrations 0000/0001 or move/init databases. Independent spec then quality review.

## HTTP and browser

- [ ] Write browser regression: upload actual generated PNG → pin at 25%/40% →
  submit text → reply → resolve/reopen → reload → version 2 has no old threads →
  return v1 restores threads; narrow viewport pin stays relative to actual image;
  second authenticated session rejected; keyboard center pin entry works.
- [ ] Add session-authorized `/api/comments` GET/POST and
  `/api/comments/[id]` POST/PATCH. Use existing exact-origin guard for writes,
  bounded JSON body, generic error handling; validate via repository.
  POST collection body `{versionId,x,y,body}`, reply `{versionId,body}`, PATCH
  `{versionId,resolved}`. GET query `versionId`. Actor never from request fields.
- [ ] Extract current private-image UI into `src/app/review-canvas.tsx` which
  receives `{version,title,request}`. Request is the shared existing API helper.
  Key component by version id; keep drafts/loading/errors scoped per version.
  Overlay pins on exact image box (not letterbox), percentage positioning; image
  fits without cropping. Existing image loading/retry stays functional.
- [ ] Include explicit “Add pin” toggle, click image to select location, and
  “Place at center” keyboard alternative. Editable X/Y percent fields adjust
  location precisely. Existing pins are native buttons with accessible names;
  selected thread lists messages and reply/resolve/reopen controls. Thread list
  and forms remain below artwork on mobile; no pretend multi-user activity.
  Disable writes/navigation during pending mutations; show errors locally;
  preserve failed drafts and discard drafts on version changes.
- [ ] Verify unit/typecheck/full DB/build and Chrome journeys; inspect screenshots
  on desktop/narrow layouts. Update checkpoint/README honestly, keep retained
  worktree/data; no remote publication or full product-completion claim.
