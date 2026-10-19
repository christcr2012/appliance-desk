import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({storageState:"e2e/.auth/owner.json"});
for(const width of [360,1280]){
 test("K-6 book assets owner controls and a11y at "+width,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto("/desk/books/assets");
  await expect(page.getByRole("heading",{name:"Rental equipment — book assets"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Book depreciation policy"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Enroll verified equipment"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Save book defaults"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 });
}
test("Books links to management assets without granting staff finance access",async({page,browser})=>{
 await page.goto("/desk/books");
 await expect(page.getByRole("link",{name:"Rental equipment and book depreciation"})).toHaveAttribute("href","/desk/books/assets");
 const context=await browser.newContext({storageState:"e2e/.auth/staff.json"});
 try{
  const staff=await context.newPage();
  await staff.goto("/desk/books/assets");
  await expect(staff.getByRole("heading",{name:"Rental equipment — book assets"})).toHaveCount(0);
  await expect(staff.getByRole("button",{name:"Save book defaults"})).toHaveCount(0);
 }finally{await context.close()}
});
