import { test, expect } from "@playwright/test";
import sharp from "sharp";

test("version-specific pins persist, support replies and resolution, and follow image resizing", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a private demo" }).click();
  await page.getByLabel("Presentation title").fill("Review discussion");
  await page
    .getByRole("button", { name: "Create presentation", exact: true })
    .click();
  await page.getByLabel("Screen title").fill("Homepage");
  const png = await sharp({
    create: { width: 640, height: 400, channels: 3, background: "#aca68c" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Image file")
    .setInputFiles({ name: "home.png", mimeType: "image/png", buffer: png });
  await page
    .getByRole("button", { name: "Upload screen", exact: true })
    .click();
  const img = page.getByRole("img", { name: "Homepage" });
  await expect(img).toBeVisible();
  await page.getByRole("button", { name: "Add pin", exact: true }).click();
  const box = (await img.boundingBox())!;
  await img.click({ position: { x: box.width * 0.25, y: box.height * 0.4 } });
  await page
    .getByLabel("Comment", { exact: true })
    .fill("Please enlarge this heading.");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(
    page.getByText("Please enlarge this heading.", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Reply", { exact: true })
    .fill("I will adjust it in the next version.");
  await page.getByRole("button", { name: "Post reply", exact: true }).click();
  await expect(
    page.getByText("I will adjust it in the next version.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Resolve thread", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reopen thread", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reopen thread", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "Pin 1", exact: true }).click();
  await expect(
    page.getByText("I will adjust it in the next version.", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileImage = (await img.boundingBox())!;
  const pin = (await page
    .getByRole("button", { name: "Pin 1", exact: true })
    .boundingBox())!;
  expect(
    Math.abs(
      (pin.x + pin.width / 2 - mobileImage.x) / mobileImage.width - 0.25,
    ),
  ).toBeLessThan(0.015);
  expect(
    Math.abs(
      (pin.y + pin.height / 2 - mobileImage.y) / mobileImage.height - 0.4,
    ),
  ).toBeLessThan(0.015);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/comments-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/comments-desktop.png",
    fullPage: true,
  });
  const snapshot = await (await page.request.get("/api/workspace")).json();
  const v1 = snapshot.presentations[0].screens[0].versions[0].id;
  const outsider = await browser.newContext();
  await outsider.request.post("http://127.0.0.1:4310/api/demo", {
    headers: { origin: "http://127.0.0.1:4310" },
  });
  expect(
    (
      await outsider.request.get(
        `http://127.0.0.1:4310/api/comments?versionId=${v1}`,
      )
    ).status(),
  ).toBe(404);
  await outsider.close();
  await page
    .getByLabel("New version image")
    .setInputFiles({ name: "new.png", mimeType: "image/png", buffer: png });
  await page
    .getByRole("button", { name: "Upload new version", exact: true })
    .click();
  await expect(page.getByLabel("Version", { exact: true })).toHaveValue("2");
  await expect(
    page.getByText("No comments on this version yet."),
  ).toBeVisible();
  await page.getByLabel("Version", { exact: true }).selectOption("1");
  await expect(
    page.getByRole("button", { name: "Pin 1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add pin", exact: true }).click();
  await page
    .getByRole("button", { name: "Place at center", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Horizontal position (%)")).toHaveValue("50");
  await page
    .getByLabel("Comment", { exact: true })
    .fill("Keyboard review note");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pin 2", exact: true }),
  ).toBeVisible();
  await page.route("**/api/comments/*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Comment service test failure" }),
    }),
  );
  await page
    .getByLabel("Reply", { exact: true })
    .fill("Keep this failed draft");
  await page.getByRole("button", { name: "Post reply", exact: true }).click();
  await expect(page.getByLabel("Reply", { exact: true })).toHaveValue(
    "Keep this failed draft",
  );
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Comment service test failure" })
      .first(),
  ).toBeVisible();
  await page.getByLabel("Version", { exact: true }).selectOption("2");
  await expect(
    page.getByRole("alert").filter({ hasText: "Comment service test failure" }),
  ).toHaveCount(0);
});
