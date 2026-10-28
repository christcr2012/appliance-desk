import { test,expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({storageState:"e2e/.auth/owner.json"});
for(const width of [360,1280]){
 test("K-CASH owner evidence and journal controls are accessible at "+width+"px",async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto("/desk/books/cash");
  await expect(page.getByRole("heading",{name:"Bank statements and cash records"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Import a settled bank CSV"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Cash records",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Record balanced cash event"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Preview before importing"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 });
}
test("K-CASH owner can navigate from Books; staff never sees private bank evidence",async({page,browser})=>{
 await page.goto("/desk/settings/features");
 const switchedOn=(await page.getByRole("switch",{name:"Bank statements"}).getAttribute("aria-checked"))==="true";
 await page.goto("/desk/books");
 const link=page.getByRole("link",{name:"Bank statements and cash records"});
 await expect(link).toHaveCount(switchedOn?1:0);
 if(switchedOn) await expect(link).toHaveAttribute("href","/desk/books/cash");
 // Hidden navigation never revokes the underlying owner's authorized direct URL.
 await page.goto("/desk/books/cash");
 await expect(page.getByRole("heading",{name:"Bank statements and cash records"})).toBeVisible();
 const context=await browser.newContext({storageState:"e2e/.auth/staff.json",viewport:{width:390,height:844}});
 try{
  const staff=await context.newPage();await staff.goto("/desk/books/cash");
  await expect(staff.getByRole("heading",{name:"Bank statements and cash records"})).toHaveCount(0);
  await expect(staff.getByRole("button",{name:"Record balanced cash event"})).toHaveCount(0);
 }finally{await context.close();}
});
