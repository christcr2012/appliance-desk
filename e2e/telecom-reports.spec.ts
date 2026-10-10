import fs from "node:fs";
import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ownerState="e2e/.auth/owner.json";
test.use({storageState:fs.existsSync(ownerState)?ownerState:undefined});
test.beforeEach(()=>{
  if(process.env.CI) expect(fs.existsSync(ownerState)).toBe(true);
  test.skip(!process.env.CI||!fs.existsSync(ownerState),"Disposable CI owner session only");
});
test("telecom report preserves evidence labels and private drill-through",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/desk/reports");
  await expect(page.getByRole("heading",{name:"Communications cost evidence"})).toBeVisible();
  await expect(page.getByText(/not finalized books/i).first()).toBeVisible();
  await expect(page.getByRole("link",{name:"View provider setup and private statements"}))
    .toHaveAttribute("href","/desk/settings/telecom");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const violations=(await new AxeBuilder({page}).withTags([
    "wcag2a","wcag2aa","wcag21a","wcag21aa",
  ]).analyze()).violations;
  expect(violations).toEqual([]);
});
