import { test,expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({storageState:"e2e/.auth/owner.json"});
for(const width of [360,1280]){
 for(const tab of ["forecast","health","year"]){
  test("K-8 private Books "+tab+" report accessible at "+width,async({page})=>{
   await page.setViewportSize({width,height:900});
   await page.goto("/desk/books/closing?tab="+tab);
   await expect(page.getByRole("heading",{name:"Cash forecast, customer health and year-end"})).toBeVisible();
   await expect(page.getByRole("link",{name:"Cash forecast"})).toBeVisible();
   await expect(page.getByRole("link",{name:"Customer health"})).toBeVisible();
   await expect(page.getByRole("link",{name:"Year-end CSV package"})).toBeVisible();
   if(tab==="year")await expect(page.getByRole("link",{name:"Download CSV"})).toHaveCount(5);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
   expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  });
 }
}
test("K-8 is reachable from Books, while staff cannot access reports or CSV download",async({page,browser})=>{
 await page.goto("/desk/books");
 await expect(page.getByRole("link",{name:"Cash forecast, customer health and year-end"})).toHaveAttribute("href","/desk/books/closing");
 const context=await browser.newContext({storageState:"e2e/.auth/staff.json"});
 try{
  const staff=await context.newPage();
  await staff.goto("/desk/books/closing?tab=year");
  await expect(staff.getByRole("heading",{name:"Cash forecast, customer health and year-end"})).toHaveCount(0);
  const response=await staff.request.get("/desk/books/closing/download?year=2026&file=suppliers",{maxRedirects:0});
  expect([302,303,307,308,401,403]).toContain(response.status());
  expect(response.headers()["content-type"]??"").not.toContain("text/csv");
 }finally{await context.close();}
});
