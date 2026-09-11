import { cookies } from "next/headers";
import { resolve } from "node:path";
import { createConnection } from "../db/connection.ts";
import { DemoRepository } from "../db/demo-repository.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { ReviewRepository } from "../db/review-repository.ts";
import { CommentRepository } from "../db/comment-repository.ts";
import { AssetRepository } from "../db/asset-repository.ts";
import { LocalImageStore } from "../storage/local-image-store.ts";
import { StorageError } from "../storage/errors.ts";
import { ReviewError } from "../db/review-authorization.ts";
import { HttpError, assertOrigin, readBody, configuredOrigin } from "./http.ts";
export const cookieName = "frame_demo";
export const appOrigin = configuredOrigin(process.env.FRAME_ORIGIN);
type Services = ReturnType<typeof createServices>;
const globalState = globalThis as typeof globalThis & {
  frameServices?: Services;
  frameUploads?: number;
};
function createServices() {
  if (!process.env.DATABASE_URL)
    throw new HttpError(
      503,
      "Local database is not configured. Follow the README setup steps.",
    );
  const connection = createConnection(process.env.DATABASE_URL);
  let assetService: Promise<AssetRepository> | undefined;
  return {
    demo: new DemoRepository(connection),
    workspace: new WorkspaceRepository(connection),
    reviews: new ReviewRepository(connection),
    comments: new CommentRepository(connection),
    get assets() {
      return (assetService ??= LocalImageStore.open(
        resolve(
          /* turbopackIgnore: true */ process.env.FRAME_IMAGE_DIRECTORY ??
            ".local/images",
        ),
      )
        .then((store) => new AssetRepository(connection, store))
        .catch((error) => {
          assetService = undefined;
          throw error;
        }));
    },
  };
}
export function services() {
  return (globalState.frameServices ??= createServices());
}
export async function actor() {
  const token = (await cookies()).get(cookieName)?.value;
  const result = token ? await services().demo.resolve(token) : null;
  if (!result)
    throw new HttpError(401, "Your demo has ended. Start a new private demo.");
  return result;
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function route(work: () => Promise<Response>) {
  try {
    return await work();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof ReviewError)
      return json(
        {
          error:
            e.code === "forbidden"
              ? "Access has expired or you do not have permission."
              : e.code === "not-found"
                ? "This item is no longer available."
                : "Check the title or project capacity and try again.",
        },
        e.code === "forbidden" ? 403 : e.code === "not-found" ? 404 : 400,
      );
    if (e instanceof StorageError)
      return json(
        {
          error:
            e.code === "invalid-image"
              ? "Use a complete PNG, JPEG or WebP image under 10 MiB. Animated images are not supported."
              : "The image could not be read or saved. Please try again.",
        },
        e.code === "invalid-image" ? 400 : 503,
      );
    return json(
      {
        error:
          "The workspace is temporarily unavailable. Check the local database and try again.",
      },
      503,
    );
  }
}
export function write(request: Request) {
  assertOrigin(request, appOrigin);
}
export async function body(request: Request, maxBytes = 4096) {
  if (request.headers.get("content-type") !== "application/json")
    throw new HttpError(415, "Send JSON data.");
  try {
    return JSON.parse((await readBody(request, maxBytes)).toString());
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "Check the submitted data.");
  }
}
export async function uploadSlot<T>(work: () => Promise<T>): Promise<T> {
  if ((globalState.frameUploads ?? 0) >= 2)
    throw new HttpError(
      429,
      "Two images are being processed. Try again in a moment.",
    );
  globalState.frameUploads = (globalState.frameUploads ?? 0) + 1;
  try {
    return await work();
  } finally {
    globalState.frameUploads!--;
  }
}
