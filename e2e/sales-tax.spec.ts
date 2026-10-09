import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";

const owner = "e2e/.auth/owner.json";
const isolated = process.env.CI === "true" && (() => {
  try { const url = new URL(process.env.DATABASE_URL ?? ""); return url.pathname === "/appliance_desk_test"
    && ["localhost", "127.0.0.1"].includes(url.hostname); }
  catch { return false; }
})();
const date = (day: string) => businessDateFromKey(day)!;

test.describe("sales tax overview and resolved Today routing", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
  test("delivery fees waiting page loads and passes axe", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    await page.goto("/desk/sales-tax/delivery-fees");
    await expect(page.getByRole("heading", { name: "Retail delivery fees waiting on you" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("six tax tabs have working navigation at phone width and dark mode", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    await page.setViewportSize({ width: 360, height: 780 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/desk/sales-tax");
    await expect(page.getByRole("heading", { name: "Tax overview" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Sales tax sections" });
    for (const name of ["Overview", "Returns", "Areas", "Exemptions", "What's taxed", "Setup"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
    await nav.getByRole("link", { name: "Returns" }).click();
    await expect(page.getByRole("heading", { name: "Tax filing returns" })).toBeVisible();
  });

  test("Today tax item opens the actual filing work instead of looping to Today", async ({ page }) => {
    test.skip(!fs.existsSync(owner) || !isolated, "Isolated CI owner fixture required");
    const account = await prisma.taxFilingAccount.create({ data: {
      name: "T7D Today " + randomUUID().slice(0, 8),
      kind: "SALES_RETURN", frequency: "MONTHLY", basis: "ACCRUAL",
      active: true, firstPeriodStart: date("2026-01-01"),
    } });
    const period = await prisma.taxFilingPeriod.create({ data: {
      filingAccountId: account.id,
      periodStart: date("2026-01-01"), periodEnd: date("2026-01-31"),
      dueOn: date("2026-02-20"), legalDueOn: date("2026-02-20"),
    } });
    try {
      await page.goto("/desk/today");
      const href = `/desk/sales-tax/returns/${period.id}`;
      await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
      await page.goto(href);
      await expect(page.getByRole("heading", { name: new RegExp(account.name) })).toBeVisible();
    } finally {
      await prisma.taxFilingPeriod.delete({ where: { id: period.id } });
      await prisma.taxFilingAccount.delete({ where: { id: account.id } });
    }
  });

  test("overview and guided filing have accessible mobile light/dark UI", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    await page.setViewportSize({ width: 360, height: 780 });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/desk/sales-tax");
      const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      expect(scan.violations, scheme).toEqual([]);
    }
  });
});

