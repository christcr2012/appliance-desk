import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// V-4: Today and the portal home use the cut shapes, the day timeline, severity words and the search shortcut. Every
// control must show a complete keyboard focus ring and neither screen may scroll sideways.

const owner = "e2e/.auth/owner.json";
const customer = "e2e/.auth/customer.json";

async function noSideways(page: Page, path: string) {
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `${path} at ${width}px`, timeout: 5000 })
      .toBeLessThanOrEqual(0);
  }
}

test.describe("owner Today", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
  test.beforeEach(() => {
    if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
    test.skip(!fs.existsSync(owner), "Requires isolated CI role fixture");
  });

  test("has no sideways scrolling and the headline card is cut", async ({ page }) => {
    await page.goto("/desk/today", { waitUntil: "load" });
    await noSideways(page, "/desk/today");
    await expect(page.locator(".cut-corner-md.bg-nav-bg").first()).toBeVisible();
  });

  test("the day timeline shows on a wide screen and the visit list on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/desk/today", { waitUntil: "load" });
    const visits = await page.getByText(/scheduled for/).count();
    if (visits === 0) {
      await expect(page.getByText("No visits today")).toBeVisible();
    } else {
      await expect(page.getByTestId("day-timeline")).toBeVisible();
      await page.setViewportSize({ width: 360, height: 800 });
      await expect(page.getByTestId("day-timeline")).toBeHidden();
    }
  });

  test("Ctrl K focuses the one existing search box, and the key hint is shown", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/desk/today", { waitUntil: "load" });
    const search = page.getByRole("searchbox", { name: "Search customers, appliances, and leads" });
    await expect(search).toHaveAttribute("placeholder", "Search or jump to…");
    await expect(page.locator("aside kbd")).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(search).toBeFocused();
    await page.keyboard.type("zzz-no-such-customer");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/desk\/search\?q=zzz-no-such-customer/);
  });

  test("keyboard focus is visible on the search box and the headline card", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/desk/today", { waitUntil: "load" });
    const card = page.locator("a.cut-corner-md.bg-nav-bg").first();
    await card.focus();
    await expect(card).toBeFocused();
    expect(await card.evaluate((el) => getComputedStyle(el).clipPath)).toBe("none");
    expect(await card.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
    const search = page.getByRole("searchbox", { name: "Search customers, appliances, and leads" });
    await search.focus();
    expect(await search.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  });
});

test.describe("customer portal home", () => {
  test.use({ storageState: fs.existsSync(customer) ? customer : undefined });
  test.beforeEach(() => {
    if (process.env.CI) expect(fs.existsSync(customer)).toBe(true);
    test.skip(!fs.existsSync(customer), "Requires isolated CI role fixture");
  });

  test("has no sideways scrolling and the help card keeps a complete focus ring", async ({ page }) => {
    await page.goto("/account", { waitUntil: "load" });
    await noSideways(page, "/account");
    const help = page.getByRole("region", { name: "How do I get help?" });
    await expect(help).toBeVisible();
    const report = help.getByRole("link", { name: "Report a problem" });
    await report.focus();
    await expect(report).toBeFocused();
    expect(await report.evaluate((el) => getComputedStyle(el).clipPath)).toBe("none");
    expect(await report.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  });
});
