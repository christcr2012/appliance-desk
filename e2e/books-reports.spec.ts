import { test,expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({storageState:"e2e/.auth/owner.json"});
for(const width of [360,1280]){
 for(const kind of ["profit","balance","payback"]){
  test("K-7 private "+kind+" source report at "+width,async({page})=>{
   await page.setViewportSize({width,height:900});
   await page.goto("/desk/books/reports?kind="+kind);
   await expect(page.getByRole("heading",{name:"Books — financial reports"})).toBeVisible();
   await expect(page.getByRole("link",{name:"Profit and loss"})).toBeVisible();
   await expect(page.getByRole("link",{name:"Balance snapshot"})).toBeVisible();
   await expect(page.getByRole("link",{name:"Appliance payback"})).toBeVisible();
   await expect(page.getByRole("heading",{name:kind==="profit"?/Profit and loss/:kind==="balance"?/Balance snapshot/:/Appliance payback/})).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
   expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  });
 }
}
test("Books navigation reaches reports, and staff cannot read owner finance reports",async({page,browser})=>{
 await page.goto("/desk/books");
 await expect(page.getByRole("link",{name:"Profit, balance and payback"})).toHaveAttribute("href","/desk/books/reports");
 const ctx=await browser.newContext({storageState:"e2e/.auth/staff.json"});
 try{
  const staff=await ctx.newPage();
  await staff.goto("/desk/books/reports?kind=profit");
  await expect(staff.getByRole("heading",{name:"Books — financial reports"})).toHaveCount(0);
  await expect(staff.getByRole("heading",{name:/Profit and loss/})).toHaveCount(0);
 }finally{await ctx.close()}
});
