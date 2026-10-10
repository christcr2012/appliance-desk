import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ownerState = "e2e/.auth/owner.json";
test.use({ storageState: fs.existsSync(ownerState) ? ownerState : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(ownerState)).toBe(true);
  test.skip(!process.env.CI || !fs.existsSync(ownerState), "CI disposable owner session required");
});
test("owner navigates to private telecom setup with controls inactive", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto("/desk/settings?section=notifications");
  await page.getByRole("link",{name:"Phone, SMS and provider costs"}).click();
  await expect(page).toHaveURL(/\/desk\/settings\/telecom/);
  await expect(page.getByRole("heading",{name:"Phone, texts and provider costs"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Provider accounts and owned numbers"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Spending warnings — preview only"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Private provider billing statements"})).toBeVisible();
  await expect(page.getByText(/No notification, automatic pause/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const violations=(await new AxeBuilder({page}).withTags([
    "wcag2a","wcag2aa","wcag21a","wcag21aa",
  ]).analyze()).violations;
  expect(violations).toEqual([]);
});
