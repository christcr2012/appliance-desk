import { test,expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({storageState:"e2e/.auth/owner.json"});

for(const width of [360,768,1440]){
 test("K-CASH-5A/5B planning, forecasts and source labels are accessible at "+width,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto("/desk/books/budget?tab=plan&days=30&view=calendar");
  await expect(page.getByRole("heading",{name:"Budget — plan ahead"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Known future costs"})).toBeVisible();
  await expect(page.getByRole("link",{name:"Next 30 days"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Refresh dated plan horizon (no charge)"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 });
}
test("K-CASH-5B expense budgeting is source-only and offers no bank transfer",async({page})=>{
 await page.goto("/desk/expenses");
 await expect(page.getByRole("heading",{name:"Expense and budget context"})).toBeVisible();
 await expect(page.getByRole("combobox",{name:/Requested discretionary budget label/})).toBeVisible();
 await expect(page.getByText(/Illustrative remaining/)).toHaveCount(0);
 await page.goto("/desk/books/closing");
 await expect(page.getByText(/No new collections — confirmed bank cash/)).toBeVisible();
 await expect(page.getByText(/Expected collections scenario/)).toBeVisible();
});
test("K-CASH-5B staff cannot read owner planning or bank status",async({browser})=>{
 const c=await browser.newContext({storageState:"e2e/.auth/staff.json"});
 try{
  const p=await c.newPage();
  await p.goto("/desk/books/budget?tab=plan",{waitUntil:"domcontentloaded"});
  // Next can issue an RSC redirect in a streamed HTTP 200 response. Check
  // the actual navigation and private DOM, not an assumed 3xx status.
  await expect(p).not.toHaveURL(/\/desk\/books\/budget(?:\?|$)/);
  await expect(p.getByRole("heading",{name:"Budget — plan ahead"})).toHaveCount(0);
  await expect(p.getByText(/Actual bank backing|Ready after protected/)).toHaveCount(0);
  await p.goto("/desk/expenses",{waitUntil:"domcontentloaded"});
  await expect(p.getByRole("combobox",{name:/Requested discretionary budget label/})).toBeVisible();
  await expect(p.getByText(/Cash review:/)).toHaveCount(0);
  await expect(p.getByText(/Ready to assign:/)).toHaveCount(0);
 }finally{await c.close();}
});
