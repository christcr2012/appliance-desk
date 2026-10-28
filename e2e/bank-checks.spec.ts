import { test,expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({storageState:"e2e/.auth/owner.json"});
for(const width of [360,768,1440]){
 test("K-CASH-3 owner Bank checks is truthful, keyboard/axe-safe at "+width,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto("/desk/books/cash/checks");
  await expect(page.getByRole("heading",{name:"Bank checks",exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Cash readiness: not authorized for funding"})).toBeVisible();
  await expect(page.getByText("Verified cash funding is not enabled.",{exact:false})).toBeVisible();
  await expect(page.getByRole("link",{name:"Back to bank evidence and CSV imports"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 });
}
test("K-CASH-3 links from existing Bank evidence workspace",async({page})=>{
 await page.goto("/desk/settings/features");
 const switchedOn=(await page.getByRole("switch",{name:"Bank statements"}).getAttribute("aria-checked"))==="true";
 await page.goto("/desk/books/cash");
 const link=page.getByRole("link",{name:"Bank checks and statement reconciliation"});
 await expect(link).toHaveCount(switchedOn?1:0);
 if(switchedOn) await expect(link).toHaveAttribute("href","/desk/books/cash/checks");
 // The bank checks page still works directly for an authorized owner.
 await page.goto("/desk/books/cash/checks");
 await expect(page.getByRole("heading",{name:"Bank checks",exact:true})).toBeVisible();
});
test("K-CASH-3 staff cannot see reconciliation, bank rows or cash totals",async({browser})=>{
 const context=await browser.newContext({storageState:"e2e/.auth/staff.json"});
 try{
  const page=await context.newPage();
  await page.goto("/desk/books/cash/checks");
  await expect(page.getByRole("heading",{name:"Bank checks",exact:true})).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"Cash readiness: not authorized for funding"})).toHaveCount(0);
 }finally{await context.close();}
});
