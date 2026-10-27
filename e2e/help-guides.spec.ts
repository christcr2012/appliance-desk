import fs from "node:fs";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
  test.skip(!fs.existsSync(owner), "Isolated test-only owner session required");
});

test("How do I has searchable 3-step answers, real links, keyboard and accessible sizes", async ({ page }) => {
  for (const width of [360, 390, 820, 1280, 1920]) {
    await page.setViewportSize({ width, height: width >= 820 ? 800 : 844 });
    await page.goto("/desk/help");
    await expect(page.getByRole("heading", { level: 1, name: "How do I…?" })).toBeVisible();
    const search = page.getByRole("searchbox", { name: "Search questions" });
    await search.fill("refund");
    await expect(page.getByText("How do I refund a payment?")).toBeVisible();
    await expect(page.getByText("How do I take a card payment?")).toHaveCount(0);
    await search.fill("");
    const question = width < 1024
      ? page.getByRole("list", { name: "How-to guides" }).getByRole("link", { name: /How do I snooze a To do item/i })
      : page.getByRole("table", { name: "How-to guides" }).getByRole("link", { name: "How do I snooze a To do item?" });
    await question.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "How do I snooze a To do item?" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("listitem")).toHaveCount(3);
    await expect(sheet.getByRole("link", { name: "Go there" })).toHaveAttribute("href", "/desk/today");
    await page.keyboard.press("Escape");
    await expect(sheet).not.toBeVisible();
    await expect(question).toBeFocused();
    const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(audit.violations).toEqual([]);
    if (width === 390 || width === 1280) {
      await page.emulateMedia({ colorScheme: "dark" });
      const dark = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(dark.violations).toEqual([]);
      await page.emulateMedia({ colorScheme: "light" });
    }
  }
});

test("staff can reach Help without gaining links to money or settings", async ({ browser }) => {
  test.skip(!fs.existsSync(staff), "Test-only staff session required");
  const context = await browser.newContext({ storageState: staff });
  try {
    const page = await context.newPage();
    await page.goto("/desk/more");
    await expect(page.getByRole("link", { name: "How do I…?" })).toHaveAttribute("href", "/desk/help");
    await page.getByRole("link", { name: "How do I…?" }).click();
    await expect(page.getByRole("heading", { name: "How do I…?" })).toBeVisible();
    await expect(page.getByText("How do I take a card payment?")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
