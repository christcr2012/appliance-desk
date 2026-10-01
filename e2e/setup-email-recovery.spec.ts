import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const owner = path.resolve("e2e/.auth/owner.json");
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
  test.skip(!process.env.CI || !fs.existsSync(owner), "Disposable CI business fixture only");
});
test("unsent staff setup preserves the account and offers resend recovery", async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const email = `setup-${Date.now()}@example.test`;
  await page.goto("/desk/settings?section=staff");
  await page.getByLabel("Name", { exact: true }).fill("Setup recovery fixture");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Add staff account", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Account created, but the setup email was not sent");
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Resend setup email" }).click();
  await expect(row.getByRole("alert")).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await info.attach("setup-recovery-phone", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(1);
});
