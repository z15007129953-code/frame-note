export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function configuredOrigin(value: string | undefined): string {
  const origin = value ?? "http://127.0.0.1:4310";
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
    throw new Error("FRAME_ORIGIN must be a plain HTTP(S) origin.");
  return origin;
}
export function assertOrigin(request: Request, origin: string): void {
  if (request.headers.get("origin") !== origin)
    throw new HttpError(403, "Open Frame Note directly and try again.");
}
export async function readBody(
  request: Request,
  max: number,
  timeoutMs = 30_000,
): Promise<Buffer> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > max))
    throw new HttpError(
      413,
      "This file is too large. Use an image under 10 MiB.",
    );
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new HttpError(408, "The upload took too long. Please try again."));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new HttpError(
          413,
          "This file is too large. Use an image under 10 MiB.",
        );
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}
