import { services, route, json } from "../../../../server/runtime.ts";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const { id } = await params;
    const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] ?? "";
    const response = json(await (await services().shares).snapshot(id, token));
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  });
}
