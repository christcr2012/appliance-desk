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
 await page.goto("/desk/books/cash");
 await expect(page.getByRole("link",{name:"Budget backing"})).toHaveAttribute("href","/desk/books/budget");
});
test("K-CASH-4B staff route cannot expose private protected debt or cash",async({browser})=>{
 const c=await browser.newContext({storageState:"e2e/.auth/staff.json"});
 try{const p=await c.newPage();await p.goto("/desk/books/budget");
  await expect(p.getByRole("heading",{name:"Budget backing",exact:true})).toHaveCount(0);
  await expect(p.getByRole("heading",{name:/Cash ready to assign/})).toHaveCount(0);
 }finally{await c.close();}
});
