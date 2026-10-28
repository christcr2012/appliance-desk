import { test,expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({storageState:"e2e/.auth/owner.json"});
for(const width of [360,768,1440]){
 test("K-CASH-4B bank/protected/envelope desk stays truthful and accessible at "+width,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto("/desk/books/budget");
  await expect(page.getByRole("heading",{name:"Budget backing",exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:/Cash ready to assign/})).toBeVisible();
  await expect(page.getByRole("heading",{name:/Required protected obligations/})).toBeVisible();
  await expect(page.getByRole("heading",{name:/One shared set of discretionary envelopes/})).toBeVisible();
  await expect(page.getByRole("heading",{name:/Posted business spending/})).toBeVisible();
  await expect(page.getByRole("heading",{name:/Transfer already-funded cash/})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 });
}
test("K-CASH-4B bank screen links owner budget backing",async({page})=>{
 await page.goto("/desk/settings/features");
 const switchedOn=(await page.getByRole("switch",{name:"Budget envelopes"}).getAttribute("aria-checked"))==="true";
 await page.goto("/desk/books/cash");
 const link=page.getByRole("link",{name:"Budget backing"});
 await expect(link).toHaveCount(switchedOn?1:0);
 if(switchedOn) await expect(link).toHaveAttribute("href","/desk/books/budget");
 // Only the menu choice changes; the owner's budget route remains usable.
 await page.goto("/desk/books/budget");
 await expect(page.getByRole("heading",{name:"Budget backing",exact:true})).toBeVisible();
});
test("K-CASH-4B staff route cannot expose private protected debt or cash",async({browser})=>{
 const c=await browser.newContext({storageState:"e2e/.auth/staff.json"});
 try{const p=await c.newPage();await p.goto("/desk/books/budget");
  await expect(p.getByRole("heading",{name:"Budget backing",exact:true})).toHaveCount(0);
  await expect(p.getByRole("heading",{name:/Cash ready to assign/})).toHaveCount(0);
 }finally{await c.close();}
});

test("K-CASH-5A/B owner planning view labels plans as unpaid and does not expose bank money as a target",async({page})=>{
 await page.setViewportSize({width:360,height:820});
 await page.goto("/desk/books/budget?tab=plan");
 await expect(page.getByRole("heading",{name:"Budget — plan ahead"})).toBeVisible();
 await expect(page.getByRole("heading",{name:"Known future costs"})).toBeVisible();
 await expect(page.getByRole("button",{name:"Save planned cost only — do not pay"})).toBeVisible();
 await expect(page.getByRole("heading",{name:"My envelopes and targets"})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
});
test("K-CASH-5A/B staff planning route cannot expose private goals or cash",async({browser})=>{
 const c=await browser.newContext({storageState:"e2e/.auth/staff.json"});
 try{const p=await c.newPage();await p.goto("/desk/books/budget?tab=plan");
  await expect(p.getByRole("heading",{name:"Budget — plan ahead"})).toHaveCount(0);
  await expect(p.getByRole("heading",{name:"My envelopes and targets"})).toHaveCount(0);
 }finally{await c.close();}
});
