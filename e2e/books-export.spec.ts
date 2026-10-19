import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({storageState:"e2e/.auth/owner.json"});
for(const width of [360,1280]) {
 test("K-5 Books export form is private and responsive at "+width,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto("/desk/books/exports");
  await expect(page.getByRole("heading",{name:"Accounting exports"})).toBeVisible();
  await expect(page.getByRole("combobox",{name:"Accounting software",exact:true})).toBeVisible();
  await expect(page.getByRole("combobox",{name:"Detail level",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Create and archive CSV"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Prior immutable exports"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  const violations=(await new AxeBuilder({page}).analyze()).violations;
  expect(violations).toEqual([]);
 });
}
test("Books links to its provider-mapped CSV export",async({page})=>{
 await page.goto("/desk/books");
 await expect(page.getByRole("link",{name:/Export to QuickBooks/})).toHaveAttribute("href","/desk/books/exports");
 await expect(page.locator('select[name="target"] option[value="CASH_MOVEMENTS_CSV"]').first()).toHaveCount(1);
});
test("STAFF cannot see owner accounting exports",async({browser})=>{
 const context=await browser.newContext({storageState:"e2e/.auth/staff.json"});
 try {
  const page=await context.newPage();
  await page.goto("/desk/books/exports");
  await expect(page.getByRole("heading",{name:"Accounting exports"})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Create and archive CSV"})).toHaveCount(0);
 } finally { await context.close(); }
});
