import { actor, services, json, route } from "../../../server/runtime.ts";
export const runtime = "nodejs";
export async function GET() {
  return route(async () =>
    json(await services().workspace.snapshot(await actor())),
  );
}
