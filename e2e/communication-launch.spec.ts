import fs from "node:fs";
import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ownerState="e2e/.auth/owner.json",staffState="e2e/.auth/staff.json";
test.describe("COM-L15 owner launch proof (non-sending CI)",()=>{
 test.use({storageState:fs.existsSync(ownerState)?ownerState:undefined});
 test.beforeEach(()=>{
  if(process.env.CI) expect(fs.existsSync(ownerState)).toBe(true);
  test.skip(!process.env.CI||!fs.existsSync(ownerState),"CI owner fixture only");
 });
 test("can inspect setup, independent costs and private inbox without implied activation",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/desk/settings/telecom");
  await expect(page.getByRole("heading",{name:"Phone, texts and provider costs"})).toBeVisible();
  await expect(page.getByText(/Saving suggested warnings does not turn on SMS/)).toBeVisible();
  await page.goto("/desk/reports");
  await expect(page.getByRole("heading",{name:"Communications cost evidence"})).toBeVisible();
  await page.goto("/desk/communications");
  await expect(page.getByRole("heading",{name:"Communications",exact:true})).toBeVisible();
  await expect(page.getByText(/Sending stays off until separately approved/)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags([
    "wcag2a","wcag2aa","wcag21a","wcag21aa",
  ]).analyze()).violations).toEqual([]);
 });
});
test.describe("COM-L15 staff launch privacy",()=>{
 test.use({storageState:fs.existsSync(staffState)?staffState:undefined});
 test.beforeEach(()=>{
  if(process.env.CI) expect(fs.existsSync(staffState)).toBe(true);
  test.skip(!process.env.CI||!fs.existsSync(staffState),"CI staff fixture only");
 });
 test("staff cannot open company phone billing and provider setup",async({page})=>{
  await page.goto("/desk/settings/telecom");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading",{name:"Phone, texts and provider costs"})).toHaveCount(0);
  await expect(page.getByText(/verified telecom statement|provider invoice total/i)).toHaveCount(0);
  await page.goto("/desk/communications");
  await expect(page.getByRole("heading",{name:"Communications",exact:true})).toBeVisible();
  await expect(page.getByText(/Staff see only threads assigned to them/)).toBeVisible();
 });
});
