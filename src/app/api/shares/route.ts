import { actor, services, route, json, write, body } from "../../../server/runtime.ts";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return route(async () => json(await (await services().shares).list(await actor(), new URL(request.url).searchParams.get("presentationId") ?? "")));
}
export async function POST(request: Request) {
  return route(async () => {
    write(request);
    const who = await actor(), data = await body(request);
    return json(await (await services().shares).create(who, data?.presentationId, data?.hours), 201);
  });
}
