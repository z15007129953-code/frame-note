import { test } from "node:test";
import assert from "node:assert/strict";
import { assertOrigin, readBody, HttpError, configuredOrigin } from "./http.ts";
const origin = "http://127.0.0.1:4310";
test("mutations require exact configured origin", () => {
  assert.doesNotThrow(() =>
    assertOrigin(new Request(origin, { headers: { origin } }), origin),
  );
  for (const value of [
    "",
    "null",
    "https://evil.example",
    origin + ".evil",
    "http://localhost:4310",
  ])
    assert.throws(
      () =>
        assertOrigin(
          new Request(origin, { headers: { origin: value } }),
          origin,
        ),
      HttpError,
    );
});
test("request bytes are bounded even without content-length", async () => {
  assert.equal(
    (
      await readBody(new Request(origin, { method: "POST", body: "123" }), 3)
    ).toString(),
    "123",
  );
  await assert.rejects(
    readBody(new Request(origin, { method: "POST", body: "1234" }), 3),
    HttpError,
  );
  await assert.rejects(
    readBody(
      new Request(origin, {
        method: "POST",
        body: "1",
        headers: { "content-length": "100" },
      }),
      3,
    ),
    HttpError,
  );
});
test("configured origin must be a plain HTTP(S) origin", () => {
  assert.equal(configuredOrigin(undefined), origin);
  assert.equal(
    configuredOrigin("https://review.example"),
    "https://review.example",
  );
  for (const value of [
    "",
    "null",
    "file:///tmp/test",
    origin + "/",
    origin + "/path",
    "https://user:pass@review.example",
    origin + "?x=1",
  ]) {
    assert.throws(() => configuredOrigin(value));
  }
});
test("stalled body reads time out and cancel the stream", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request(origin, {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  await assert.rejects(
    readBody(request, 10, 20),
    (error: unknown) => error instanceof HttpError && error.status === 408,
  );
  assert.equal(cancelled, true);
});
