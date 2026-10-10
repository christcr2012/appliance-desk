import fs from "node:fs";
import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const owner="e2e/.auth/owner.json";
test.use({storageState:fs.existsSync(owner)?owner:undefined});
test.beforeEach(()=>{
 if(process.env.CI) expect(fs.existsSync(owner)).toBe(true);
 test.skip(!process.env.CI||!fs.existsSync(owner),"CI owner only");
});
test("job context panel shows safe empty state on mobile",async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto("/desk/jobs/ci-security-job");
 await expect(page.getByRole("heading",{name:"Related communications"})).toBeVisible();
 await expect(page.getByText("No linked communications recorded.")).toBeVisible();
 await expect(page.getByText(/shared phone number is not evidence/i)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("context cards meet phone accessibility",async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto("/desk/jobs/ci-security-job");
 const report=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze();
 expect(report.violations).toEqual([]);
});
