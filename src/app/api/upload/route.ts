import {
  actor,
  services,
  json,
  route,
  write,
  uploadSlot,
} from "../../../server/runtime.ts";
import { readBody, HttpError } from "../../../server/http.ts";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => {
    write(request);
    const who = await actor();
    const screenId = new URL(request.url).searchParams.get("screenId");
    if (!z.uuid().safeParse(screenId).success)
      throw new HttpError(400, "Select a screen first.");
    return uploadSlot(async () => {
      const bytes = await readBody(request, 10 * 1024 * 1024);
      const assets = await services().assets;
      const version = await assets.uploadVersion(
        who.workspaceId,
        who.projectId,
        screenId!,
        who.memberId,
        bytes,
        request.headers.get("content-type") ?? "",
      );
      return json({ id: version.id, number: version.number }, 201);
    });
  });
}
