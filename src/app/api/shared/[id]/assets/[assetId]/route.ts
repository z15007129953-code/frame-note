import { services, route } from "../../../../../../server/runtime.ts";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  return route(async () => {
    const { id, assetId } = await params;
    const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] ?? "";
    const image = await (await services().shares).read(id, token, assetId);
    return new Response(new Uint8Array(image.bytes), { headers: {
      "Content-Type": image.mimeType, "Content-Length": String(image.bytes.length),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline", "Referrer-Policy": "no-referrer",
    } });
  });
}
