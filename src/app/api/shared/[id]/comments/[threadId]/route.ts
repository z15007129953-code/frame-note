import { services, route, json, body } from "../../../../../../server/runtime.ts";
export const runtime = "nodejs";
function bearer(request: Request) { return request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] ?? ""; }
export async function POST(request: Request, { params }: { params: Promise<{ id: string; threadId: string }> }) {
  return route(async () => {
    const { id, threadId } = await params; const data = await body(request, 16384);
    await (await services().comments).replyGuest(id, bearer(request), data?.versionId, threadId, data?.body);
    const response = json({ ok: true }, 201); response.headers.set("Referrer-Policy", "no-referrer"); return response;
  });
}
