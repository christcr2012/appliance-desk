import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const owner = "e2e/.auth/owner.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

test("owner sets up the starter checklist, records a date and number, and sees it on the list", async ({ page }) => {
  test.skip(!enabled || !fs.existsSync(owner), "Disposable CI database only");
  const { prisma } = await import("../src/lib/prisma");
  await prisma.businessPaperwork.deleteMany({});
  try {
    await page.goto("/desk/paperwork");
    await expect(page.getByRole("heading", { name: "Business paperwork", level: 1 })).toBeVisible();
    await expect(page.getByText("Nothing here yet")).toBeVisible();

    await page.getByRole("button", { name: "Set up my starter checklist" }).click();
    await expect(page.getByRole("link", { name: "Get your federal EIN" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Colorado yearly report (periodic report)" })).toBeVisible();

    await page.getByRole("link", { name: "Colorado yearly report (periodic report)" }).click();
    await expect(page.getByRole("heading", { name: "Colorado yearly report (periodic report)", level: 1 })).toBeVisible();
    await page.getByLabel("Number (optional)").fill("TEST-NUMBER-9876");
    await page.getByLabel("Next due, renewal or expiry date").fill("2027-02-15");
    await page.getByLabel("Where are you with it?").selectOption("IN_PROGRESS");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(/\/desk\/paperwork$/);
    await expect(page.getByText("Date: 2027-02-15").or(page.getByText(/Due 2027-02-15/))).toBeVisible();
    // The number is only ever shown masked on the list.
    await expect(page.getByText("Number ••••9876")).toBeVisible();
    await expect(page.getByText("TEST-NUMBER-9876")).toHaveCount(0);

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/desk/paperwork");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations, `axe at ${width}px`).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow, `no sideways scroll at ${width}px`).toBe(false);
    }
  } finally {
    await prisma.businessPaperwork.deleteMany({});
  }
});

test("a non-owner cannot open the paperwork page", async ({ browser }) => {
  test.skip(!enabled || !fs.existsSync("e2e/.auth/staff.json"), "Disposable CI database only");
  const context = await browser.newContext({ storageState: "e2e/.auth/staff.json" });
  const page = await context.newPage();
  const response = await page.goto("/desk/paperwork");
  const body = await page.content();
  expect(body).not.toContain("Business paperwork</h1>");
  expect([200, 307, 403, 404]).toContain(response?.status() ?? 0);
  await context.close();
});
