import fs from "node:fs";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";
test.describe("AR-1 five area navigation", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
  test.beforeEach(() => {
    if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
    test.skip(!fs.existsSync(owner), "Isolated test-only owner session required");
  });

  test("five sizes, mobile area bar, desktop remembered sidebar, skip link and axe", async ({ page }) => {
    for (const width of [360, 390, 820, 1280, 1920]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/desk/today");
      if (width < 1024) {
        const main = page.getByRole("navigation", { name: "Main" });
        await expect(main.getByRole("link")).toHaveCount(5);
        await expect(main.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
      } else {
        const areas = page.getByRole("navigation", { name: "Areas" });
        await expect(areas.getByRole("link")).toHaveCount(5);
        await expect(page.getByRole("button", { name: "Collapse menu" })).toBeVisible();
      }
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(axe.violations).toEqual([]);
    }
    await page.getByRole("button", { name: "Collapse menu" }).click();
    await expect(page.getByRole("button", { name: "Expand menu" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand menu" })).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await skip.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("area tabs, keyboard command and retired landing-page redirects", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk/today");
    await page.getByRole("navigation", { name: "Areas" }).getByRole("link", { name: "Customers" }).click();
    const tabs = page.getByRole("navigation", { name: "Customers sections" });
    await expect(tabs.getByRole("link", { name: "Customers" })).toHaveAttribute("aria-current", "page");
    await expect(tabs.getByRole("link", { name: "Leads" })).toBeVisible();
    await page.keyboard.press("Control+k");
    const command = page.getByRole("dialog", { name: "Search or jump to anything" });
    await expect(command).toBeVisible();
    const input = command.getByRole("combobox", { name: "Search the desk" });
    await input.fill("estimate");
    await expect(command.getByText("New quote")).toBeVisible();
    await input.fill("customer");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Control+Enter");
    await expect(command).not.toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(command).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(command).not.toBeVisible();
    await page.goto("/desk/more");
    await expect(page).toHaveURL(/\/desk\/today/);
    await page.goto("/desk/control-center");
    await expect(page).toHaveURL(/\/desk\/today/);
  });
});

test.describe("staff is not offered forbidden pages", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });
  test.beforeEach(() => {
    if (process.env.CI) expect(fs.existsSync(staff)).toBe(true);
    test.skip(!fs.existsSync(staff), "Isolated test-only staff session required");
  });
  test("every tab this staff account sees opens without an access refusal", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk/today");
    const homes = await page.getByRole("navigation", { name: "Areas" })
      .getByRole("link").evaluateAll(els => els.map(el => (el as HTMLAnchorElement).getAttribute("href")!).filter(Boolean));
    const hrefs = new Set(homes);
    for (const home of homes) {
      await page.goto(home);
      const tabs = page.getByRole("navigation", { name: /sections/ });
      if (await tabs.count()) {
        for (const href of await tabs.getByRole("link").evaluateAll(els =>
          els.map(el => (el as HTMLAnchorElement).getAttribute("href")!).filter(Boolean))) hrefs.add(href);
      }
    }
    for (const href of hrefs) {
      await page.goto(href);
      await expect(page).not.toHaveURL(/screen=not-in-job-role/);
      await expect(page.getByText("You don't have access to that screen.")).toHaveCount(0);
      await expect(page.getByRole("main")).toBeVisible();
    }
    await page.keyboard.press("Control+k");
    const command = page.getByRole("dialog", { name: "Search or jump to anything" });
    await command.getByRole("combobox", { name: "Search the desk" }).fill("payment");
    await expect(command.getByText("Take a payment", { exact: true })).toHaveCount(0);
    await expect(command.getByText("New lead", { exact: true })).toHaveCount(0);
  });
});
