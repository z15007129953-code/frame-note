import { services, route, json, body } from "../../../../../server/runtime.ts";
export const runtime = "nodejs";
function bearer(request: Request) { return request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] ?? ""; }
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const { id } = await params;
    const versionId = new URL(request.url).searchParams.get("versionId") ?? "";
    const result = await (await services().comments).listGuest(id, bearer(request), versionId);
    const response = json(result); response.headers.set("Referrer-Policy", "no-referrer"); return response;
  });
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const { id } = await params; const data = await body(request, 16384);
    const result = await (await services().comments).createGuest(id, bearer(request), data?.versionId, { x: data?.x, y: data?.y }, data?.body);
    const response = json(result, 201); response.headers.set("Referrer-Policy", "no-referrer"); return response;
  });
}
