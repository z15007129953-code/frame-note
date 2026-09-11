import {
  actor,
  services,
  json,
  route,
  write,
  body,
} from "../../../../server/runtime.ts";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  return route(async () => {
    write(request);
    const who = await actor();
    const input = await body(request, 16384);
    const { id } = await context.params;
    await services().comments.reply(who, input?.versionId, id, input?.body);
    return json({ ok: true }, 201);
  });
}
export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    write(request);
    const who = await actor();
    const input = await body(request);
    const { id } = await context.params;
    await services().comments.setResolved(
      who,
      input?.versionId,
      id,
      input?.resolved,
    );
    return json({ ok: true });
  });
}
