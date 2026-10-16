import fs from "node:fs";
import {randomUUID} from "node:crypto";
import path from "node:path";
import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const owner=path.resolve("e2e/.auth/owner.json");
const customer=path.resolve("e2e/.auth/customer.json");

test.describe("W-25 owner entered order — accessible protected preparation",()=>{
  test.use({storageState:fs.existsSync(owner)?owner:undefined});
  test.beforeEach(()=>{
    if(process.env.CI)expect(fs.existsSync(owner)).toBe(true);
    test.skip(!process.env.CI||!fs.existsSync(owner),
      "Requires disposable CI owner authentication fixture");
  });
  for(const width of [360,768,1440]){
    test("owner phone workspace at "+width+"px never offers verbal signing",async({page})=>{
      await page.setViewportSize({width,height:850});
      await page.goto("/desk/phone-orders");
      await expect(page.getByRole("heading",{name:"Phone orders"})).toBeVisible();
      await expect(page.getByRole("link",{name:"Start phone order"})).toBeVisible();
      await page.getByRole("link",{name:"Start phone order"}).click();
      await expect(page.getByRole("heading",{name:"Start phone order"})).toBeVisible();
      await expect(page.getByText(/not customer acceptance/i)).toBeVisible();
      await expect(page.getByRole("button",{name:"Someone new"})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const audit=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze();
      expect(audit.violations).toEqual([]);
    });
  }
  test("new caller creates a draft, never a phone signature or payment",async({page})=>{
    await page.goto("/desk/phone-orders/new");
    await page.getByRole("button",{name:"Someone new"}).click();
    const unique="W25 browser "+randomUUID();
    await page.locator("#contactName").fill(unique);
    await page.locator("#phone").fill("3035551234");
    await page.locator("#leadEmail").fill("browser-"+randomUUID()+"@example.test");
    await page.locator("#title").fill(unique+" washer/dryer call");
    await page.locator("form button[type=submit]").click();
    await expect(page).toHaveURL(/\/desk\/estimates\/[^/?]+/);
    await expect(page.getByRole("heading",{name:"Finish phone order with customer"})).toBeVisible();
    await expect(page.getByText(/nothing spoken.*binding/i)).toBeVisible();
    await expect(page.getByRole("button",{name:/Send to finish/i})).toBeDisabled();
    await expect(page.getByRole("button",{name:/Copy same customer link/i})).toBeDisabled();
  });
});

test.describe("W-25 customer and guest access denial",()=>{
  test("guest cannot open owner phone workspace",async({page})=>{
    await page.context().clearCookies();
    await page.goto("/desk/phone-orders/new");
    await expect(page).toHaveURL(/\/login|\/sign-in|\/auth/);
    await expect(page.getByRole("heading",{name:"Start phone order"})).toHaveCount(0);
  });
  test.describe("customer role",()=>{
    test.use({storageState:fs.existsSync(customer)?customer:undefined});
    test.beforeEach(()=>{
      if(process.env.CI)expect(fs.existsSync(customer)).toBe(true);
      test.skip(!process.env.CI||!fs.existsSync(customer),"Requires customer CI role fixture");
    });
    test("customer cannot see staff-entered phone orders",async({page})=>{
      await page.goto("/desk/phone-orders");
      await expect(page.getByRole("heading",{name:"Phone orders"})).toHaveCount(0);
    });
  });
});
