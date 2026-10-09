import fs from "node:fs";
import { test, expect } from "@playwright/test";

const ownerState = "e2e/.auth/owner.json";
const staffState = "e2e/.auth/staff.json";

test.describe("owner call and voicemail navigation", () => {
  test.use({ storageState: fs.existsSync(ownerState) ? ownerState : undefined });
  test.beforeEach(() => {
    if (process.env.CI) expect(fs.existsSync(ownerState)).toBe(true);
    test.skip(!fs.existsSync(ownerState), "Requires isolated owner login fixture");
  });
  test("opens missed-call list directly from Communications with no external audio", async ({ page }) => {
    await page.goto("/desk/communications");
    const callLink = page.getByRole("link", { name: "Open missed-call inbox" });
    await expect(callLink).toBeVisible();
    await callLink.click();
    await expect(page).toHaveURL(/\/desk\/communications\/calls$/);
    await expect(page.getByRole("heading", { name: "Calls & voicemail" })).toBeVisible();
    await expect(page.getByText("Calls requiring review")).toBeVisible();
    await expect(page.getByText(/Voicemail capture remains OFF/)).toBeVisible();
  });
});

test.describe("staff voice privacy", () => {
  test.use({ storageState: fs.existsSync(staffState) ? staffState : undefined });
  test.beforeEach(() => {
    if (process.env.CI) expect(fs.existsSync(staffState)).toBe(true);
    test.skip(!fs.existsSync(staffState), "Requires isolated staff login fixture");
  });
  test("can access only staff-scoped call inbox, not a fabricated recording", async ({ page }) => {
    await page.goto("/desk/communications/calls");
    await expect(page.getByRole("heading", { name: "Calls & voicemail" })).toBeVisible();
    const denied = await page.request.get("/api/communications/media/nonexistentrecording12345");
    expect(denied.status()).toBe(404);
  });
});

test("an unauthenticated voice media route never serves audio", async ({ request }) => {
  const response = await request.get("/api/communications/media/nonexistentrecording12345");
  expect(response.status()).toBe(401);
});
