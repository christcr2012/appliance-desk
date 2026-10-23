import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The test harness creates this synthetic owner session before browser tests.
test.use({storageState:"e2e/.auth/owner.json"});
for(const width of [360,768,1440])for(const theme of ["light","dark"]){
  test(`Books and journal permissions and responsive UI at ${width} ${theme}`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await page.addInitScript(mode=>localStorage.setItem("theme",mode),theme);
    await page.goto("/desk/books");
    await expect(page.getByRole("heading",{name:"Your books"})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Your accounts"})).toBeVisible();
    await expect(page.getByText("System account types and roles are fixed.",{exact:false})).toBeVisible();
    await expect(page.getByRole("button",{name:"Add account"})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    const results=await new AxeBuilder({page}).analyze();
    expect(results.violations).toEqual([]);
  });
}
