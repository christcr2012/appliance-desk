import { test,expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({storageState:"e2e/.auth/owner.json"});
for(const width of [360,1280]){
 for(const kind of ["profit","balance","payback"]){
  test("K-7 private "+kind+" source report at "+width,async({page})=>{
   await page.setViewportSize({width,height:900});
   await page.goto("/desk/books/reports?kind="+kind);
   await expect(page.getByRole("heading",{name:"Reports",exact:true})).toBeVisible();
   if(width>=1280){
    await expect(page.getByRole("radio",{name:"Profit"})).toBeVisible();
    await expect(page.getByRole("radio",{name:"Own & owe"})).toBeVisible();
    await expect(page.getByRole("radio",{name:"Payback"})).toBeVisible();
   } else {
    await expect(page.getByRole("combobox",{name:"Report view"})).toBeVisible();
   }
   await expect(page.getByRole("heading",{name:kind==="profit"?/Profit and loss/:kind==="balance"?/What the business owns and owes/:/Which appliances have paid for themselves/})).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
   expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  });
 }
}
test("Books navigation reaches reports, and staff cannot read owner finance reports",async({page,browser})=>{
 await page.goto("/desk/books");
 // The Books tab strip and the Overview's task cards both link to Reports; the
 // navigation assertion targets the tab strip (aria-label "Books sections").
 await expect(page.getByRole("navigation",{name:"Books sections"}).getByRole("link",{name:"Reports",exact:true})).toHaveAttribute("href","/desk/books/reports");
 const ctx=await browser.newContext({storageState:"e2e/.auth/staff.json"});
 try{
  const staff=await ctx.newPage();
  await staff.goto("/desk/books/reports?kind=profit");
  await expect(staff.getByRole("heading",{name:"Reports",exact:true})).toHaveCount(0);
  await expect(staff.getByRole("heading",{name:/Profit and loss/})).toHaveCount(0);
 }finally{await ctx.close()}
});
