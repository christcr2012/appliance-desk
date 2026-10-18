import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({ storageState: "e2e/.auth/owner.json" });
for (const width of [360, 1280]) {
  test("Expenses owner accessibility " + width, async ({page}) => {
    await page.setViewportSize({width, height:900});
    await page.goto("/desk/expenses");
    await expect(page.getByRole("heading", {name:"Expenses", exact:true})).toBeVisible();
    await expect(page.getByRole("heading", {name:"Recurring expense drafts"})).toBeVisible();
    await expect(page.getByRole("button", {name:"Approve and post"})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    const results = await new AxeBuilder({page}).analyze();
    expect(results.violations).toEqual([]);
  });
}
test("Staff can submit without manager accounting controls", async ({browser}) => {
  const context = await browser.newContext({storageState:"e2e/.auth/staff.json",viewport:{width:390,height:844}});
  try {
    const page = await context.newPage();
    await page.goto("/desk/expenses");
    await expect(page.getByRole("heading",{name:"My submitted expenses"})).toBeVisible();
    await expect(page.getByRole("button",{name:"Submit for approval"})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Recurring expense drafts"})).toHaveCount(0);
  } finally { await context.close(); }
});