import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({storageState:"e2e/.auth/owner.json"});
for(const width of [360,1280]){
 test("K-6 book assets owner controls and a11y at "+width,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto("/desk/books/assets");
  await expect(page.getByRole("heading",{name:"What your rental equipment is worth"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Book settings"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Restore recommended"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 });
}
test("fix-by-hand controls live on For your accountant",async({page})=>{
 await page.goto("/desk/books/accountant");
 await expect(page.getByRole("heading",{name:"Fix a book asset by hand"})).toBeVisible();
 await expect(page.getByRole("button",{name:"Enroll in book assets"})).toBeVisible();
});
test("Books links to management assets without granting staff finance access",async({page,browser})=>{
 await page.goto("/desk/books");
 await expect(page.getByRole("link",{name:"Equipment value",exact:true})).toHaveAttribute("href","/desk/books/assets");
 const context=await browser.newContext({storageState:"e2e/.auth/staff.json"});
 try{
  const staff=await context.newPage();
  await staff.goto("/desk/books/assets");
  await expect(staff.getByRole("heading",{name:"What your rental equipment is worth"})).toHaveCount(0);
  await expect(staff.getByRole("button",{name:"Restore recommended"})).toHaveCount(0);
 }finally{await context.close()}
});
