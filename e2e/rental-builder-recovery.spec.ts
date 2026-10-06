import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const owner = "e2e/.auth/owner.json";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
  test.skip(
    !process.env.CI || !fs.existsSync(owner),
    "Disposable CI fixtures only",
  );
});
test("draft and reserved line survive refresh with discounted pricing and one checkpoint", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/desk/customers");
  const customerRow = page
    .locator("main tr:visible, main li:visible")
    .filter({ hasText: process.env.TEST_CUSTOMER_EMAIL! })
    .first();
  await expect(customerRow).toBeVisible();
  await customerRow.getByRole("link").first().click();
  await page
    .getByRole("link", { name: "+ New agreement", exact: true })
    .click();
  await page.getByRole("button", { name: "Next: term & fees" }).click();
  await page.getByLabel("Term (months, optional)").fill("6");
  await page.getByRole("button", { name: "Next: appliances" }).click();
  await expect(page).toHaveURL(/draftId=/);
  const checkpoint = page.url();
  await page.reload();
  await expect(page).toHaveURL(checkpoint);
  await expect(
    page.getByRole("link", { name: "Resume saved builder" }),
  ).toBeVisible();
  await page.getByLabel("Label", { exact: true }).fill("CI saved washer");
  await page
    .getByLabel("Monthly price before any discount ($)", { exact: true })
    .fill("35");
  await page
    .locator("label")
    .filter({ hasText: "CI-SECURITY-UNIT" })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: "Add to agreement" }).click();
  await expect(
    page.getByText("CI saved washer — $32.50/mo", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(checkpoint);
  await expect(
    page.getByText("CI saved washer — $32.50/mo", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByText("Total: $32.50/mo", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  for (const width of [360, 768, 1440]) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((mode) => localStorage.setItem("theme", mode), theme);
      await page.reload();
      await expect(
        page.getByText("Total: $32.50/mo", { exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      const image = info.outputPath(`saved-builder-${width}-${theme}.png`);
      await page.screenshot({ path: image, fullPage: true });
      await info.attach(`saved-builder-${width}-${theme}`, {
        path: image,
        contentType: "image/png",
      });
    }
  }
  // Reach and activate Back using the keyboard, preserving the saved line.
  const back = page.getByRole("button", { name: "Back", exact: true });
  for (let tab = 0; tab < 80; tab++) {
    if (await back.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press("Tab");
  }
  await expect(back).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: /Appliances \(1 added/ }),
  ).toBeVisible();
  await expect(
    page.getByText("CI saved washer — $32.50/mo", { exact: true }),
  ).toBeVisible();
});
