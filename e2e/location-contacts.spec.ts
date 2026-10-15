import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { prisma } from "../src/lib/prisma";
const ownerState = "e2e/.auth/owner.json";
const customerState = "e2e/.auth/customer.json";
const addressUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(addressUrl.hostname) &&
  addressUrl.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(ownerState) ? ownerState : undefined });

test("W-23 owner and customer can update the same owned site; guest cannot see private contacts", async ({ page, browser }) => {
  test.skip(!enabled || !fs.existsSync(ownerState) || !fs.existsSync(customerState),
    "Requires disposable database and checked owner/customer browser sessions.");
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.TEST_CUSTOMER_EMAIL!.toLowerCase() }, select: { id: true },
  });
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { userId: user.id },
    select: { id: true, locationContactPolicy: true, locationContactPolicyAt: true,
      locationContactPolicyByUserId: true },
  });
  const address = await prisma.serviceAddress.create({ data: {
    customerId: customer.id, line1: "627 Tenant Site Browser Ave",
    city: "Greeley", state: "CO", zip: "80631",
  } });
  let personId: string | null = null;
  try {
    await page.goto("/desk/customers/" + customer.id + "/locations");
    await expect(page.getByRole("heading", { name: /location contacts/i })).toBeVisible();
    const unit = page.getByRole("textbox", { name: "Unit label" }).last();
    await unit.fill("Suite 7");
    await page.getByRole("textbox", { name: "Private access notes" }).last().fill("Keep gate locked.");
    await page.getByRole("button", { name: "Save site details and permission" }).last().click();
    await expect(page.getByRole("status").getByText("Saved.")).toBeVisible();
    await page.getByRole("button", { name: "Add contact" }).last().click();
    await page.getByRole("textbox", { name: "Name" }).last().fill("W23 Tenant Browser");
    await page.getByRole("button", { name: "Add location contact" }).last().click();
    await expect(page.getByText("W23 Tenant Browser")).toBeVisible();
    personId = (await prisma.locationContact.findFirstOrThrow({
      where: { serviceAddressId: address.id, name: "W23 Tenant Browser" },select:{id:true},
    })).id;

    const clientCtx = await browser.newContext({ storageState: customerState });
    try {
      const clientPage = await clientCtx.newPage();
      await clientPage.goto("/account/properties");
      await expect(clientPage.getByRole("heading", { name: /my properties and on-site contacts/i })).toBeVisible();
      await expect(clientPage.getByText("W23 Tenant Browser")).toBeVisible();
      await expect(clientPage.getByRole("textbox", { name: "Private access notes" }).last())
        .toHaveValue("Keep gate locked.");
      await clientPage.getByRole("button", { name: "Move out" }).last().click();
      await expect(clientPage.getByText("Moved out; billing unchanged.")).toBeVisible();
    } finally { await clientCtx.close(); }
    const visitor = await browser.newContext();
    try {
      const unauth = await visitor.newPage();
      await unauth.goto("/desk/customers/" + customer.id + "/locations");
      await expect(unauth).toHaveURL(/\/login/);
      await expect(unauth.getByText("Keep gate locked.")).toHaveCount(0);
    } finally { await visitor.close(); }
    // A desktop + narrow viewport still displays the label/contact action.
    await page.setViewportSize({ width: 375, height: 800 });
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Unit label" }).last()).toHaveValue("Suite 7");
  } finally {
    if (personId) await prisma.staffTask.deleteMany({ where: { sourceKey: "tenant-turnover:" + personId } });
    await prisma.auditLog.deleteMany({ where: { entityId: address.id } });
    await prisma.locationContact.deleteMany({ where: { serviceAddressId: address.id } });
    await prisma.serviceAddress.delete({ where: { id: address.id } });
    // Revert account-level policy if someone changed it in the test.
    await prisma.customer.update({ where: { id: customer.id }, data: {
      locationContactPolicy: customer.locationContactPolicy as object,
      locationContactPolicyAt: customer.locationContactPolicyAt,
      locationContactPolicyByUserId: customer.locationContactPolicyByUserId,
    } });
  }
});
