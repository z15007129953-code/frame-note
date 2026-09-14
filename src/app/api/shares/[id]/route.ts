import { actor, services, route, json, write } from "../../../../server/runtime.ts";
export const runtime = "nodejs";
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    write(request);
    const who = await actor(), { id } = await params;
    await (await services().shares).revoke(who, id);
    return json({ revoked: true });
  });
}
