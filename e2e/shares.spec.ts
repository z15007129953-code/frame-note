import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
const origin = "http://127.0.0.1:4310";
async function fixture(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a private demo" }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
  const p = await page.request.post("/api/presentations", { headers: { origin }, data: { title: "Field notes" } });
  expect(p.status()).toBe(201);
  const presentation = await p.json();
  const s = await page.request.post("/api/screens", { headers: { origin }, data: { title: "Garden study", presentationId: presentation.id } });
  expect(s.status()).toBe(201);
  const screen = await s.json();
  for (const version of [1, 2]) {
    const image = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#e3e5d3"/><circle cx="600" cy="230" r="150" fill="${version === 1 ? "#a8b28b" : "#839776"}"/><text x="50" y="80" font-size="18" fill="#34432c">FIELD NOTES / 0${version}</text><text x="50" y="240" font-size="42" fill="#34432c">Room to grow.</text><rect x="50" y="290" width="280" height="10" fill="#839776"/><rect x="50" y="320" width="180" height="10" fill="#839776"/></svg>`)).png().toBuffer();
    expect((await page.request.post(`/api/upload?screenId=${screen.id}`, { headers: { origin, "content-type": "image/png" }, data: image })).status()).toBe(201);
  }
  await page.reload();
  await expect(page.getByRole("img", { name: "Garden study", exact: true })).toBeVisible();
  return presentation.id as string;
}

test("owner shares one presentation and revocation clears a separate read-only viewer", async ({ page, browser }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Create view-only link", exact: true }).click();
  const link = await page.getByLabel("New share link", { exact: true }).inputValue();
  const parsed = new URL(link), token = parsed.hash.slice(1), id = parsed.pathname.split("/").at(-1)!;
  expect(token).toMatch(/^[\w-]{43}$/);
  await page.screenshot({ path: "test-results/shares-owner.png", fullPage: true, mask: [page.getByLabel("New share link", { exact: true })] });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied.", { exact: true })).toBeVisible();
  const visitor = await browser.newContext();
  const view = await visitor.newPage();
  const requested: string[] = [];
  view.on("request", request => requested.push(request.url()));
  await view.goto(link);
  await expect(view.getByRole("heading", { name: "Field notes", exact: true })).toBeVisible();
  await expect(view.getByText("Read only", { exact: true })).toBeVisible();
  await expect(view.getByRole("img", { name: "Garden study v2", exact: true })).toBeVisible();
  await view.getByLabel("Version", { exact: true }).selectOption("1");
  await expect(view.getByRole("img", { name: "Garden study v1", exact: true })).toBeVisible();
  await expect(view.getByRole("button", { name: "Upload screen", exact: true })).toHaveCount(0);
  await expect(view.getByRole("button", { name: "Add pin", exact: true })).toHaveCount(0);
  const snapshot = await (await visitor.request.get(`${origin}/api/shared/${id}`, { headers: { authorization: `Bearer ${token}` } })).json();
  const assetId = snapshot.presentation.screens[0].versions[0].assetId;
  expect((await visitor.request.get(`${origin}/api/assets/${assetId}`)).status()).toBe(401);
  expect((await visitor.request.post(`${origin}/api/presentations`, { headers: { origin, authorization: `Bearer ${token}` }, data: { title: "Forbidden" } })).status()).toBe(401);
  expect(requested.every(url => !url.includes(token))).toBe(true);
  await view.screenshot({ path: "test-results/shared-desktop.png", fullPage: true });
  await view.setViewportSize({ width: 390, height: 844 });
  expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await view.screenshot({ path: "test-results/shared-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Revoke link", exact: true }).click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(page.getByLabel("New share link", { exact: true })).toHaveCount(0);
  expect((await visitor.request.get(`${origin}/api/shared/${id}`, { headers: { authorization: `Bearer ${token}` } })).status()).toBe(404);
  expect((await visitor.request.get(`${origin}/api/shared/${id}/assets/${assetId}`, { headers: { authorization: `Bearer ${token}` } })).status()).toBe(404);
  await expect(view.getByRole("heading", { name: "This link is unavailable.", exact: true })).toBeVisible({ timeout: 10000 });
  await expect(view.getByRole("img")).toHaveCount(0);
  await visitor.close();
});

test("shared routes reject missing tokens and foreign presentation images", async ({ page, browser }) => {
  const presentationId = await fixture(page);
  const response = await page.request.post("/api/shares", { headers: { origin }, data: { presentationId, hours: 1 } });
  expect(response.status()).toBe(201);
  const share = await response.json();
  const outsider = await browser.newContext();
  expect((await outsider.request.get(`${origin}/api/shared/${share.id}`)).status()).toBe(404);
  expect((await outsider.request.get(`${origin}/api/shared/${share.id}`, { headers: { authorization: `Bearer ${"a".repeat(43)}` } })).status()).toBe(404);
  expect((await outsider.request.delete(`${origin}/api/shares/${share.id}`, { headers: { origin, authorization: `Bearer ${share.token}` } })).status()).toBe(401);
  const other = await (await page.request.post("/api/presentations", { headers: { origin }, data: { title: "Unshared" } })).json();
  const otherScreen = await (await page.request.post("/api/screens", { headers: { origin }, data: { title: "Secret", presentationId: other.id } })).json();
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#789456" } }).png().toBuffer();
  await page.request.post(`/api/upload?screenId=${otherScreen.id}`, { headers: { origin, "content-type": "image/png" }, data: bytes });
  const data = await (await page.request.get("/api/workspace")).json();
  const asset = data.presentations.find((p: {id: string}) => p.id === other.id).screens[0].versions[0].assetId;
  expect((await outsider.request.get(`${origin}/api/shared/${share.id}/assets/${asset}`, { headers: { authorization: `Bearer ${share.token}` } })).status()).toBe(404);
  const view = await outsider.newPage();
  await view.goto(`${origin}/share/${share.id}`);
  await expect(view.getByRole("heading", { name: "This link is unavailable.", exact: true })).toBeVisible();
  await outsider.close();
});

test("shared image failures retry and invalidation does not show stale artwork", async ({ page, browser }) => {
  const presentationId = await fixture(page);
  const response = await page.request.post("/api/shares", { headers: { origin }, data: { presentationId, hours: 1 } });
  expect(response.status()).toBe(201);
  const share = await response.json();
  const visitor = await browser.newContext();
  const view = await visitor.newPage();
  let fail = true;
  await view.route("**/api/shared/*/assets/*", route => fail ? route.fulfill({ status: 503, json: { error: "Image storage failed." } }) : route.continue());
  await view.goto(`${origin}/share/${share.id}#${share.token}`);
  await expect(view.getByRole("button", { name: "Retry image", exact: true })).toBeVisible();
  fail = false;
  await view.getByRole("button", { name: "Retry image", exact: true }).click();
  await expect(view.getByRole("img", { name: "Garden study v2", exact: true })).toBeVisible();
  await view.evaluate(() => { location.hash = "invalid"; });
  await expect(view.getByRole("heading", { name: "This link is unavailable.", exact: true })).toBeVisible();
  await expect(view.getByRole("img")).toHaveCount(0);
  await visitor.close();
});

test("initial share-list authorization failure clears the expired owner workspace", async ({ page }) => {
  await fixture(page);
  await page.request.post("/api/presentations", { headers: { origin }, data: { title: "Another presentation" } });
  await page.reload();
  await expect(page.getByRole("button", { name: "Create view-only link", exact: true })).toBeEnabled();
  await page.context().clearCookies();
  await page.getByRole("navigation", { name: "Presentations", exact: true }).getByRole("button").filter({ hasText: "Another presentation" }).click();
  await expect(page.getByRole("button", { name: "Start a private demo" })).toBeVisible();
  await expect(page.getByRole("img")).toHaveCount(0);
  await expect(page.getByLabel("New share link", { exact: true })).toHaveCount(0);
});

test("switching presentations clears the one-time token and copy failure offers manual copying", async ({ page }) => {
  await fixture(page);
  await page.request.post("/api/presentations", { headers: { origin }, data: { title: "Another presentation" } });
  await page.reload();
  await page.getByRole("button", { name: "Create view-only link", exact: true }).click();
  await expect(page.getByLabel("New share link", { exact: true })).toBeVisible();
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, "writeText", { value: async () => { throw new Error("Blocked"); } }); });
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Copy was blocked. Select and copy the link above.", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Presentations", exact: true }).getByRole("button").filter({ hasText: "Another presentation" }).click();
  await expect(page.getByLabel("New share link", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create view-only link", exact: true })).toBeEnabled();
  await page.getByRole("navigation", { name: "Presentations", exact: true }).getByRole("button").filter({ hasText: "Field notes" }).click();
  await expect(page.getByRole("button", { name: "Revoke link", exact: true })).toBeVisible();
  await expect(page.getByLabel("New share link", { exact: true })).toHaveCount(0);
});

test("an unavailable image cannot be restored by a later successful snapshot poll", async ({ page, browser }) => {
  const presentationId = await fixture(page);
  const share = await (await page.request.post("/api/shares", { headers: { origin }, data: { presentationId, hours: 1 } })).json();
  const visitor = await browser.newContext(); const view = await visitor.newPage();
  await view.route("**/api/shared/*/assets/*", route => route.fulfill({ status: 404, json: { error: "Not found." } }));
  await view.goto(`${origin}/share/${share.id}#${share.token}`);
  await expect(view.getByRole("heading", { name: "This link is unavailable.", exact: true })).toBeVisible();
  await view.unroute("**/api/shared/*/assets/*");
  await view.evaluate(() => window.dispatchEvent(new Event("focus")));
  // Cross the normal poll interval to prove terminal invalidation survives future checks.
  await view.waitForTimeout(5500);
  await expect(view.getByRole("heading", { name: "This link is unavailable.", exact: true })).toBeVisible();
  await expect(view.getByRole("img")).toHaveCount(0);
  await visitor.close();
});

test("link numbers remain attached to their original links when another is created", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Create view-only link", exact: true }).click();
  await expect(page.getByRole("button", { name: "Revoke link", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Create view-only link", exact: true }).click();
  const rows = page.getByRole("region", { name: "Share presentation", exact: true }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Link 1");
  await expect(rows.last()).toContainText("Link 2");
});
