import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// ZONE-1: the service area page — our own zone map, legend, towns by zone and the address checker (the server answers
// from fixed town centers in browser tests; see CENSUS_GEOCODER_FIXTURES in playwright.config.ts). Delivery prices
// stay hidden until the owner switches them on (the switched-on wording is proven in tests/public-pages-render.test.tsx).

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

test.describe("service area map", () => {
  for (const width of [360, 1280]) {
    test(`map, legend and town list render, pass axe and fit at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/service-area", { waitUntil: "load" });
      await expect(page.getByRole("img", { name: "Map of our delivery zones, centered on Greeley" })).toBeVisible();
      const legend = page.getByRole("region", { name: "Delivery zones" });
      await expect(legend.getByText("Local — free delivery")).toBeVisible();
      await expect(legend.getByText("Guaranteed free delivery")).toBeVisible();
      await expect(legend.getByText("Delivery price shown on your estimate")).toHaveCount(2);
      await expect(legend.getByText("$75")).toHaveCount(0);
      await expect(legend.getByText("Beyond 50 miles: pickup only")).toBeVisible();
      const towns = page.getByRole("region", { name: "Towns by delivery zone" });
      await expect(towns.getByRole("link", { name: "Loveland" })).toHaveAttribute("href", "/rent/loveland");
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("the address checker answers with the zone and never shows a position or miles", async ({ page }) => {
    await page.goto("/service-area", { waitUntil: "load" });
    const check = page.getByRole("region", { name: "Check your address" });
    const street = check.getByLabel("Street address");
    await expect(street).toBeEditable();
    await street.fill("123 Main St");
    await check.getByLabel("ZIP code").fill("80537");
    await check.getByRole("button", { name: "Find my zone" }).click();
    const answer = check.getByRole("status");
    await expect(answer).toContainText("You're in our Nearby zone. Your delivery price is shown on your estimate");
    await expect(answer).not.toContainText(/\d+\.\d|miles/);
    await street.fill("123 Main St");
    await check.getByLabel("ZIP code").fill("80401");
    await check.getByRole("button", { name: "Find my zone" }).click();
    await expect(answer).toContainText("Outside our delivery area — you can still rent and pick it up.");
    await street.fill("123 Main St");
    await check.getByLabel("ZIP code").fill("80631");
    await check.getByRole("button", { name: "Find my zone" }).click();
    await expect(answer).toContainText("guaranteed free delivery");
  });

  test("works without JavaScript: the map and towns are plain markup", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/service-area", { waitUntil: "load" });
    await expect(page.locator("svg[role=img] circle").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Evans" })).toBeVisible();
    await context.close();
  });
  // The town pages' zone line is proven in tests/public-pages-render.test.tsx (CI runs the site in "preparing to
  // launch" mode, where town pages go to /launch).
});
