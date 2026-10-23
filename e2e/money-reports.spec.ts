import { test,expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({storageState:"e2e/.auth/owner.json"});
for(const width of [360,768,1440]){
 test("published budget review and business finance trends at "+width+" light and keyboard source layouts",async({page})=>{
  await page.setViewportSize({width,height:850});
  await page.goto("/desk/books/budget?tab=review");
  await expect(page.getByRole("heading",{name:"Budget — monthly review"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Publish reviewed monthly plan"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Month-end review checklist"})).toBeVisible();
  await expect(page.getByText(/Current published version: Unplanned — no published baseline/)).toBeVisible();
  const viewport=await page.evaluate(()=>({
   innerWidth,documentWidth:document.documentElement.scrollWidth,
   overflowing:[...document.querySelectorAll("*")].filter(el=>{
    const box=el.getBoundingClientRect();
    return box.width>0&&box.right>innerWidth+1;
   }).slice(0,12).map(el=>({
    tag:el.tagName.toLowerCase(),className:typeof el.className==="string"?el.className.slice(0,130):"",
    right:Math.round(el.getBoundingClientRect().right)
   }))
  }));
  expect(viewport.documentWidth,JSON.stringify(viewport)).toBeLessThanOrEqual(viewport.innerWidth+1);
  expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze()).violations).toEqual([]);
  await page.goto("/desk/books/reports?kind=trends");
  await expect(page.getByRole("heading",{name:"Business finance trends"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Monthly profit and bank trend"})).toBeVisible();
  await expect(page.getByRole("link",{name:/Download this filtered report CSV/})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze()).violations).toEqual([]);
 });
}
test("staff cannot access private monthly publication, review or finance report",async({browser})=>{
 const c=await browser.newContext({storageState:"e2e/.auth/staff.json"});
 try{
  const p=await c.newPage();
  await p.goto("/desk/books/budget?tab=review",{waitUntil:"domcontentloaded"});
  await expect(p).not.toHaveURL(/\/desk\/books\/budget(?:\?|$)/);
  await expect(p.getByRole("heading",{name:"Budget — monthly review"})).toHaveCount(0);
  await p.goto("/desk/books/reports?kind=trends",{waitUntil:"domcontentloaded"});
  await expect(p).not.toHaveURL(/\/desk\/books\/reports(?:\?|$)/);
  await expect(p.getByRole("heading",{name:"Business finance trends"})).toHaveCount(0);
  const download=await p.request.get("/desk/books/reports/export?kind=trends");
  expect(download.headers()["content-type"]??"").not.toContain("text/csv");
 }finally{await c.close();}
});
