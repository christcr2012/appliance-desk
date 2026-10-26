import fs from "node:fs";
import { randomUUID } from "node:crypto";
import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ownerState="e2e/.auth/owner.json";
test.use({storageState:fs.existsSync(ownerState)?ownerState:undefined});
test.beforeEach(()=>{
  if(process.env.CI) expect(fs.existsSync(ownerState)).toBe(true);
  test.skip(!process.env.CI||!fs.existsSync(ownerState),"Disposable CI owner only");
});
const database = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const isolated = process.env.CI === "true" &&
  database.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(database.hostname);

// Do not select the first row of an unisolated customer list. Other browser
// workers create and remove temporary customers concurrently, so that record
// may no longer exist by the time the detail route resolves (HTTP 404).
test("customer communications timeline filter is navigable on mobile",async({page})=>{
  test.skip(!isolated, "Requires disposable PostgreSQL and authorized owner fixture");
  const { prisma } = await import("../src/lib/prisma");
  const key = randomUUID().replaceAll("-", "");
  const user = await prisma.user.create({data:{
    email:"communication-timeline-"+key+"@example.test",
    role:"CUSTOMER",passwordHash:"disposable-ci-only",
    name:"Communication timeline fixture "+key.slice(0,6),
  }});
  let customerId: string | null = null;
  try {
    const customer=await prisma.customer.create({data:{
      userId:user.id,referralCode:("CT"+key).slice(0,20).toUpperCase(),
    }});
    customerId=customer.id;
    await page.setViewportSize({width:390,height:844});
    await page.goto("/desk/customers/"+encodeURIComponent(customerId)+
      "?tab=activity&filter=communications");
    // AR-0b: on phones, Activity › "Texts and calls" shows the message history above the timeline.
    await expect(page.getByRole("heading",{name:"Messages"}).first()).toBeVisible();
    await expect(page.getByRole("link",{name:"Texts and calls"})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const violations=(await new AxeBuilder({page})
      .withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze()).violations;
    expect(violations).toEqual([]);
  } finally {
    if(customerId)await prisma.customer.delete({where:{id:customerId}});
    await prisma.user.delete({where:{id:user.id}});
  }
});
