import fs from "node:fs";
import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ownerState="e2e/.auth/owner.json";
test.use({storageState:fs.existsSync(ownerState)?ownerState:undefined});
test.beforeEach(()=>{
  if(process.env.CI) expect(fs.existsSync(ownerState)).toBe(true);
  test.skip(!process.env.CI||!fs.existsSync(ownerState),"Disposable CI owner only");
});
test("customer communications timeline filter is navigable on mobile",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/desk/customers");
  const first=page.locator("a[href^='/desk/customers/']:not([href*='/export'])").first();
  await expect(first).toBeVisible();
  const address=await first.getAttribute("href");
  expect(address).toBeTruthy();
  await page.goto(address+"?tab=activity&filter=communications");
  await expect(page.getByText("Notes, activity and communications")).toBeVisible();
  await expect(page.getByRole("link",{name:"Texts and calls"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const violations=(await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze()).violations;
  expect(violations).toEqual([]);
});
