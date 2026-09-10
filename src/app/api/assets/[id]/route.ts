import { actor, services, route } from "../../../../server/runtime.ts";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    const who = await actor();
    const { id } = await context.params;
    const image = await (
      await services().assets
    ).read(who.workspaceId, who.projectId, who.memberId, id);
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "Content-Type": image.mimeType,
        "Content-Length": String(image.bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  });
}
