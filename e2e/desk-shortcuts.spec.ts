import fs from "node:fs";
import { expect, test } from "@playwright/test";

const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";
test.describe("owner keyboard desk controls", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
  test.beforeEach(() => {
    if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
    test.skip(!fs.existsSync(owner), "Requires isolated owner fixture");
  });
  test("finds search, changes areas and opens help without interfering with typing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/desk/today");
    await page.keyboard.press("/");
    await expect(page.locator("#global-search")).toBeFocused();
    await page.keyboard.type("gmt");
    await page.keyboard.press("g");
    await page.keyboard.press("m");
    await expect(page).toHaveURL(/\/desk\/today/);
    await page.locator("#global-search").evaluate((element) => (element as HTMLElement).blur());
    await page.keyboard.press("g");
    await page.keyboard.press("c");
    await expect(page).toHaveURL(/\/desk\/customers/);
    await page.keyboard.press("Shift+/");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await expect(help).toContainText("Next / previous table row");
    await page.keyboard.press("Escape");
    await expect(help).not.toBeVisible();
  });
});
test.describe("staff shortcuts never enter owner money", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });
  test.beforeEach(() => {
    if (process.env.CI) expect(fs.existsSync(staff)).toBe(true);
    test.skip(!fs.existsSync(staff), "Requires isolated staff fixture");
  });
  test("ignores g then m and still navigates to Customers", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/desk/today");
    await page.keyboard.press("g");
    await page.keyboard.press("m");
    await expect(page).toHaveURL(/\/desk\/today/);
    await page.keyboard.press("g");
    await page.keyboard.press("c");
    await expect(page).toHaveURL(/\/desk\/customers/);
  });
});
