import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ownerState = "e2e/.auth/owner.json";
test.use({ storageState: fs.existsSync(ownerState) ? ownerState : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(ownerState)).toBe(true);
  test.skip(!fs.existsSync(ownerState), "Test-only owner session required");
});

test("Settings Features shows guarded controls at five sizes and passes accessibility", async ({ page }) => {
  for (const width of [360, 390, 820, 1280, 1920]) {
    await page.setViewportSize({ width, height: width < 820 ? 844 : 800 });
    await page.goto("/desk/settings/features");
    await expect(page.getByRole("heading", { name: "Features", level: 1 })).toBeVisible();
    await expect(page.getByText("Turn on more when your business needs it.")).toBeVisible();
    await expect(page.getByText("Files for your accountant", { exact: true })).toBeVisible();
    await expect(page.getByText("Phone and texting costs", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Settings" }).last()).toHaveAttribute("href", "/desk/settings");
    const issues = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(issues.violations).toEqual([]);
  }
});

test("Books navigation follows the owner's feature choices without changing direct access", async ({ page }) => {
  await page.goto("/desk/settings/features");
  const gated = [
    { name: "Files for your accountant", href: "/desk/books/exports", linkName: "Exports" },
    { name: "Bank statements", href: "/desk/books/cash", linkName: "Bank statements and cash records" },
  ];
  const choices = await Promise.all(gated.map(async l => ({
    ...l, on: (await page.getByRole("switch", { name: l.name }).getAttribute("aria-checked")) === "true",
  })));
  const budgetOn = (await page.getByRole("switch", { name: "Budget envelopes" }).getAttribute("aria-checked")) === "true";
  await page.goto("/desk/books/accountant");
  for (const choice of choices) {
    const link = page.getByRole("link", { name: choice.linkName, exact: true });
    await expect(link).toHaveCount(choice.on ? 1 : 0);
    if (choice.on) await expect(link).toHaveAttribute("href", choice.href);
  }
  await page.goto("/desk/books");
  const budgetTab = page.getByRole("link", { name: "Money set aside", exact: true });
  await expect(budgetTab).toHaveCount(budgetOn ? 1 : 0);
  if (budgetOn) await expect(budgetTab).toHaveAttribute("href", "/desk/books/budget");
});
