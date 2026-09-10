import {
  actor,
  services,
  json,
  route,
  write,
  body,
} from "../../../server/runtime.ts";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => {
    write(request);
    const who = await actor();
    const input = await body(request);
    return json(
      await services().workspace.createPresentation(who, input?.title),
      201,
    );
  });
}
