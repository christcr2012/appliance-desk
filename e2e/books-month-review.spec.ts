import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({storageState:"e2e/.auth/owner.json"});

for(const width of [360,1280]){
 test("BA-3 monthly Books review stays usable and accessible at "+width,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto("/desk/books/months/2026-09");
  await expect(page.getByRole("heading",{name:/Review September 2026.s books/})).toBeVisible();
  await expect(page.getByRole("link",{name:"Back to Your books"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 });
}
test("BA-3 private month and accountant files never leak to staff",async({browser})=>{
 const context=await browser.newContext({storageState:"e2e/.auth/staff.json"});
 try{
  const page=await context.newPage();
  await page.goto("/desk/books/months/2026-09");
  await expect(page.getByRole("heading",{name:/Review September 2026.s books/})).toHaveCount(0);
  const response=await page.request.get("/desk/books/months/2026-09/download?file=journal",{maxRedirects:0});
  expect([302,303,307,308,401,403]).toContain(response.status());
  expect(response.headers()["content-type"]??"").not.toContain("text/csv");
 }finally{await context.close();}
});
