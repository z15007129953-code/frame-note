import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

const origin = "http://127.0.0.1:4310";
async function setup(page: Page, count = 2) {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a private demo" }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
  const presentationResponse = await page.request.post("/api/presentations", {
    headers: { origin }, data: { title: "Revision study" },
  });
  expect(presentationResponse.status()).toBe(201);
  const presentation = await presentationResponse.json();
  const screenResponse = await page.request.post("/api/screens", {
    headers: { origin }, data: { title: "Homepage", presentationId: presentation.id },
  });
  expect(screenResponse.status()).toBe(201);
  const screen = await screenResponse.json();
  for (let n = 0; n < count; n++) {
    const width = n ? 400 : 640, height = n ? 600 : 400;
    const artwork = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${n ? "#d6debf" : "#e7dbc7"}"/>
      <text x="32" y="44" font-size="14" fill="#394132">FIELD STUDIES / 0${n + 1}</text>
      <circle cx="${n ? 270 : 500}" cy="150" r="85" fill="${n ? "#8a9c72" : "#b19c79"}"/>
      <text x="32" y="${n ? 290 : 170}" font-size="36" fill="#303a2a">A quieter place.</text>
      <rect x="32" y="${n ? 330 : 220}" width="180" height="8" fill="#858976"/>
      <rect x="32" y="${n ? 350 : 240}" width="140" height="8" fill="#858976"/>
      <rect x="32" y="${n ? 400 : 300}" width="130" height="44" rx="3" fill="#394132"/>
      <text x="50" y="${n ? 428 : 328}" font-size="16" fill="#f4f5ed">Explore work</text>
    </svg>`;
    const image = await sharp(Buffer.from(artwork)).png().toBuffer();
    const response = await page.request.post(`/api/upload?screenId=${screen.id}`, {
      headers: { origin, "content-type": "image/png" }, data: image,
    });
    expect(response.ok()).toBe(true);
  }
  await page.reload();
  await expect(page.getByRole("img", { name: "Homepage", exact: true })).toBeVisible();
}

test("comparison needs two versions", async ({ page }) => {
  await setup(page, 1);
  await expect(page.getByText("Upload another version to compare.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Compare versions", exact: true })).toBeDisabled();
});

test("comparison keeps draft context, same-scale geometry and keyboard/pointer reveal", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Add pin", exact: true }).click();
  await page.getByRole("button", { name: "Place at center", exact: true }).click();
  await page.getByLabel("Comment", { exact: true }).fill("Keep this review draft");
  await page.getByRole("button", { name: "Compare versions", exact: true }).click();
  const left = page.getByLabel("Left version", { exact: true });
  const right = page.getByLabel("Right version", { exact: true });
  await expect(left).toHaveValue("1");
  await expect(right).toHaveValue("2");
  await expect(page.getByLabel("Comment", { exact: true })).toBeHidden();
  const leftImg = page.getByRole("img", { name: "Left: Homepage v1", exact: true });
  const rightImg = page.getByRole("img", { name: "Right: Homepage v2", exact: true });
  await expect(leftImg).toBeVisible();
  await expect(rightImg).toBeVisible();
  const a = (await leftImg.boundingBox())!, b = (await rightImg.boundingBox())!;
  expect(b.x).toBeGreaterThan(a.x + a.width);
  expect(Math.abs(a.width / 640 - b.width / 400)).toBeLessThan(0.01);
  expect(Math.abs(a.width / a.height - 1.6)).toBeLessThan(0.01);
  await page.screenshot({ path: "test-results/comparison-desktop.png", fullPage: true });
  await left.selectOption("2");
  await expect(right).toHaveValue("1");
  await page.getByRole("button", { name: "Swap versions", exact: true }).click();
  await expect(left).toHaveValue("1");
  await page.getByRole("button", { name: "Overlay", exact: true }).click();
  await expect(leftImg).toBeVisible();
  await expect(rightImg).toBeVisible();
  const oa = (await leftImg.boundingBox())!, ob = (await rightImg.boundingBox())!;
  expect(Math.abs(oa.x - ob.x)).toBeLessThan(1);
  expect(Math.abs(oa.y - ob.y)).toBeLessThan(1);
  expect(Math.abs(oa.width / 640 - ob.width / 400)).toBeLessThan(0.01);
  const slider = page.getByRole("slider", { name: "Reveal left version", exact: true });
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  await slider.press("End");
  await expect(slider).toHaveValue("100");
  await slider.press("ArrowLeft");
  await expect(slider).toHaveValue("99");
  const canvas = page.getByTestId("comparison-overlay");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.99, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(Math.abs(Number(await slider.inputValue()) - 25)).toBeLessThan(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("comparison-overlay").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/comparison-overlay-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Side by side", exact: true }).click();
  const ma = (await leftImg.boundingBox())!, mb = (await rightImg.boundingBox())!;
  expect(mb.y).toBeGreaterThan(ma.y + ma.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/comparison-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Back to review", exact: true }).click();
  await expect(page.getByLabel("Version", { exact: true })).toHaveValue("2");
  await expect(page.getByLabel("Comment", { exact: true })).toHaveValue("Keep this review draft");
  await page.getByLabel("Version", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Compare versions", exact: true }).click();
  await expect(left).toHaveValue("1");
  await expect(right).toHaveValue("2");
  await page.getByRole("button", { name: "Back to review", exact: true }).click();
  await expect(page.getByLabel("Version", { exact: true })).toHaveValue("1");
});

test("comparison image failures retry without losing private authorization", async ({ page, browser }) => {
  await setup(page);
  const snapshot = await (await page.request.get("/api/workspace")).json();
  const versions = snapshot.presentations[0].screens[0].versions;
  let fail = true;
  await page.route(`**/api/assets/${versions[0].assetId}*`, route => fail ? route.abort() : route.continue());
  await page.getByRole("button", { name: "Compare versions", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry left image", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Overlay", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry left image", exact: true })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry left image", exact: true }).click();
  await expect(page.getByRole("img", { name: "Left: Homepage v1", exact: true })).toBeVisible();
  const outsider = await browser.newContext();
  await outsider.request.post(`${origin}/api/demo`, { headers: { origin } });
  for (const version of versions) {
    expect((await outsider.request.get(`${origin}/api/assets/${version.assetId}`)).status()).toBe(404);
  }
  await outsider.close();
});

test("comparison resets for another screen and session loss clears the private view", async ({ page }) => {
  await setup(page, 3);
  await page.getByRole("button", { name: "Compare versions", exact: true }).click();
  await expect(page.getByLabel("Left version", { exact: true })).toHaveValue("2");
  await expect(page.getByLabel("Right version", { exact: true })).toHaveValue("3");
  await page.getByLabel("Right version", { exact: true }).selectOption("1");
  await expect(page.getByLabel("Left version", { exact: true })).toHaveValue("2");
  const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#96a789" } }).png().toBuffer();
  await page.getByLabel("Screen title", { exact: true }).fill("Another screen");
  await page.getByLabel("Image file", { exact: true }).setInputFiles({ name: "other.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Upload screen", exact: true }).click();
  await expect(page.getByRole("img", { name: "Another screen", exact: true })).toBeVisible();
  await expect(page.getByLabel("Left version", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Compare versions", exact: true })).toBeDisabled();
  await page.locator(".screen-strip").getByRole("button", { name: /Homepage/ }).click();
  await page.getByRole("button", { name: "Compare versions", exact: true }).click();
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Swap versions", exact: true }).click();
  // Switching the image pair performs an authorized read; session loss must not look like an empty image.
  await expect(page.getByRole("button", { name: "Start a private demo" })).toBeVisible();
  await expect(page.getByLabel("Left version", { exact: true })).toHaveCount(0);
});
