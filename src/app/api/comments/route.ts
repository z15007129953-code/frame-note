import {
  actor,
  services,
  json,
  route,
  write,
  body,
} from "../../../server/runtime.ts";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return route(async () => {
    const who = await actor();
    return json(
      await services().comments.list(
        who,
        new URL(request.url).searchParams.get("versionId") ?? "",
      ),
    );
  });
}
export async function POST(request: Request) {
  return route(async () => {
    write(request);
    const who = await actor();
    const input = await body(request, 16384);
    return json(
      await services().comments.create(
        who,
        input?.versionId,
        { x: input?.x, y: input?.y },
        input?.body,
      ),
      201,
    );
  });
}
