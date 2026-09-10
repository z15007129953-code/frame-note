import { test, expect } from "@playwright/test";
import sharp from "sharp";
test("isolated demo uploads real images and keeps versions after reload", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a private demo" }).click();
  await page.getByLabel("Presentation title").fill("Autumn collection");
  await page
    .getByRole("button", { name: "Create presentation", exact: true })
    .click();
  await page.getByLabel("Screen title").fill("Cover");
  const png = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "#a9b59a" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Image file")
    .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
  await page
    .getByRole("button", { name: "Upload screen", exact: true })
    .click();
  await expect(page.getByRole("img", { name: "Cover" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("img", { name: "Cover" })).toBeVisible();
  await page.getByLabel("New version image").setInputFiles({
    name: "revision.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page
    .getByRole("button", { name: "Upload new version", exact: true })
    .click();
  await expect(page.getByLabel("Version", { exact: true })).toHaveValue("2");
  await expect(page.getByLabel("New version image")).toHaveValue("");
  await page.getByLabel("Version", { exact: true }).selectOption("1");
  const src = await page
    .getByRole("img", { name: "Cover" })
    .getAttribute("src");
  const outsider = await browser.newContext();
  expect(
    (await outsider.request.get(`http://127.0.0.1:4310${src}`)).status(),
  ).toBe(401);
  await outsider.request.post("http://127.0.0.1:4310/api/demo", {
    headers: { origin: "http://127.0.0.1:4310" },
  });
  expect(
    (await outsider.request.get(`http://127.0.0.1:4310${src}`)).status(),
  ).toBe(404);
  const ownSnapshot = await (await page.request.get("/api/workspace")).json();
  const foreignScreen = ownSnapshot.presentations[0].screens[0].id;
  expect(
    (
      await outsider.request.post(
        `http://127.0.0.1:4310/api/upload?screenId=${foreignScreen}`,
        {
          headers: {
            origin: "http://127.0.0.1:4310",
            "content-type": "image/png",
          },
          data: Buffer.from("invalid"),
        },
      )
    ).status(),
  ).toBe(404);
  await outsider.close();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/frame-note-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/frame-note-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  expect((await page.request.get(src!)).status()).toBe(401);
});
test("rejects cross-origin demo creation", async ({ request }) => {
  expect(
    (
      await request.post("/api/demo", {
        headers: { origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
});
test("invalid image gives an actionable error and the empty screen can be retried", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a private demo" }).click();
  await page.getByLabel("Presentation title").fill("Upload recovery");
  await page
    .getByRole("button", { name: "Create presentation", exact: true })
    .click();
  await page.getByLabel("Screen title").fill("Draft");
  await page.getByLabel("Image file").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await page
    .getByRole("button", { name: "Upload screen", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Use a complete PNG" }),
  ).toBeVisible();
  await expect(page.getByText("This screen needs an image.")).toBeVisible();
  const png = await sharp({
    create: { width: 320, height: 240, channels: 3, background: "#8a926a" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("New version image")
    .setInputFiles({ name: "valid.png", mimeType: "image/png", buffer: png });
  await page
    .getByRole("button", { name: "Upload new version", exact: true })
    .click();
  await expect(page.getByRole("img", { name: "Draft" })).toBeVisible();
  await page.route("**/api/assets/*", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page.reload();
  await expect(page.getByText("The image could not be loaded.")).toBeVisible();
  await page.unroute("**/api/assets/*");
  await page.getByRole("button", { name: "Retry image" }).click();
  await expect(page.getByRole("img", { name: "Draft" })).toBeVisible();
});
test("selection cannot change while a version is being saved", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a private demo" }).click();
  await page.getByLabel("Presentation title").fill("Stable selection");
  await page
    .getByRole("button", { name: "Create presentation", exact: true })
    .click();
  await page.getByLabel("Screen title").fill("Screen A");
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#697459" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Image file")
    .setInputFiles({ name: "a.png", mimeType: "image/png", buffer: png });
  await page
    .getByRole("button", { name: "Upload screen", exact: true })
    .click();
  await expect(page.getByRole("img", { name: "Screen A" })).toBeVisible();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/upload?*", async (route) => {
    await hold;
    await route.continue();
  });
  await page
    .getByLabel("New version image")
    .setInputFiles({ name: "b.png", mimeType: "image/png", buffer: png });
  await page
    .getByRole("button", { name: "Upload new version", exact: true })
    .click();
  try {
    await expect(
      page
        .getByRole("navigation", { name: "Presentations" })
        .getByRole("button"),
    ).toBeDisabled();
    await expect(page.getByLabel("New version image")).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByLabel("Version", { exact: true })).toHaveValue("2");
});
test("new demo never inherits pending files or draft titles from the previous demo", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a private demo" }).click();
  await page.getByLabel("Presentation title").fill("First demo");
  await page
    .getByRole("button", { name: "Create presentation", exact: true })
    .click();
  await page.getByLabel("Screen title").fill("Private draft");
  await page
    .getByLabel("Image file")
    .setInputFiles({
      name: "private.png",
      mimeType: "image/png",
      buffer: Buffer.from("private pending bytes"),
    });
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Start a private demo" }).click();
  await page.getByLabel("Presentation title").fill("Second demo");
  await page
    .getByRole("button", { name: "Create presentation", exact: true })
    .click();
  await expect(page.getByLabel("Screen title")).toHaveValue("");
  await expect(page.getByLabel("Image file")).toHaveValue("");
  await page.getByLabel("Screen title").fill("Fresh draft");
  await expect(
    page.getByRole("button", { name: "Upload screen", exact: true }),
  ).toBeDisabled();
});
test("expired session returns directly to the private demo entry", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a private demo" }).click();
  await page.getByLabel("Presentation title").fill("Expired session");
  await context.clearCookies();
  await page
    .getByRole("button", { name: "Create presentation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start a private demo" }),
  ).toBeVisible();
});
