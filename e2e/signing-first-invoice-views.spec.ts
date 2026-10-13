import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { SIGNING_FIRST_INVOICE_DESCRIPTION } from "../src/domains/billing/signing-first-invoice-application";

const ownerState = "e2e/.auth/owner.json";
const customerState = "e2e/.auth/customer.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const disposable = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

test.use({ storageState: fs.existsSync(ownerState) ? ownerState : undefined });

test("owner and customer see the identical credited first invoice, including print, mobile, dark and accessibility", async ({
  page, browser,
}, info) => {
  test.skip(!disposable || !fs.existsSync(ownerState) || !fs.existsSync(customerState),
    "Real saved sessions and a disposable CI database are required.");
  const email = process.env.TEST_CUSTOMER_EMAIL;
  expect(email).toBeTruthy();
  const { prisma } = await import("../src/lib/prisma");
  const user = await prisma.user.findUniqueOrThrow({ where: { email: email!.toLowerCase() } });
  const existingCustomer = await prisma.customer.findUnique({ where: { userId: user.id } });
  const customer = existingCustomer ?? await prisma.customer.create({ data: {
    userId: user.id, referralCode: "E2ED12" + randomUUID().replaceAll("-", "").slice(0, 18),
  } });
  const address = await prisma.serviceAddress.create({ data: {
    customerId: customer.id, line1: "100 Signed Invoice Proof St", city: "Greeley", state: "CO", zip: "80631",
  } });
  const agreement = await prisma.rentalAgreement.create({ data: {
    customerId: customer.id, serviceAddressId: address.id, status: "ACTIVE",
  } });
  const invoice = await prisma.invoice.create({ data: {
    customerId: customer.id, agreementId: agreement.id, status: "OPEN",
    stripeInvoiceId: "in_w22d12_e2e_" + randomUUID().replaceAll("-", ""),
    subtotalCents: 0, taxCents: 480, amountDueCents: 480,
    lineItems: { create: [
      { kind: "RENTAL", description: "First month rent", amountCents: 6000 },
      { kind: "CREDIT", description: SIGNING_FIRST_INVOICE_DESCRIPTION, amountCents: -6000 },
      { kind: "TAX", description: "Sales tax", amountCents: 480 },
    ] },
  } });
  const customerContext = await browser.newContext({
    storageState: customerState, baseURL: info.project.use.baseURL as string,
  });
  try {
    const ownerUrl = "/desk/billing/customer/" + customer.id + "/invoice/" + invoice.id;
    const customerUrl = "/account/billing/invoice/" + invoice.id;
    const customerPage = await customerContext.newPage();
    for (const [target, route] of [[page, ownerUrl], [customerPage, customerUrl]] as const) {
      await target.setViewportSize({ width: 360, height: 900 });
      await target.addInitScript(() => localStorage.setItem("theme", "dark"));
      await target.goto(route);
      await expect(target.getByText(SIGNING_FIRST_INVOICE_DESCRIPTION)).toBeVisible();
      await expect(target.getByText("First-month money paid at signing is already deducted", { exact: false })).toBeVisible();
      await expect(target.getByText("Balance owed")).toBeVisible();
      await expect(target.getByText("Paid on this invoice", { exact: true })).toBeVisible();
      await expect(target.getByText("100 Signed Invoice Proof St", { exact: false })).toBeVisible();
      expect(await target.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const printButton = target.getByRole("button", { name: "Print / save as PDF" });
      await printButton.focus();
      await expect(printButton).toBeFocused();
      expect((await new AxeBuilder({ page: target }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
      await target.emulateMedia({ media: "print" });
      await expect(target.getByText(SIGNING_FIRST_INVOICE_DESCRIPTION)).toBeVisible();
      await expect(printButton).toBeHidden();
      await target.emulateMedia({ media: "screen" });
      await target.setViewportSize({ width: 1280, height: 900 });
      await target.reload();
      await expect(target.getByText(SIGNING_FIRST_INVOICE_DESCRIPTION)).toBeVisible();
    }
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "DRAFT" } });
    await customerPage.reload();
    await expect(customerPage.getByText(SIGNING_FIRST_INVOICE_DESCRIPTION)).toHaveCount(0);
    await expect(page.getByText(SIGNING_FIRST_INVOICE_DESCRIPTION)).toBeVisible();
  } finally {
    await customerContext.close();
    await prisma.invoice.delete({ where: { id: invoice.id } });
    await prisma.rentalAgreement.delete({ where: { id: agreement.id } });
    await prisma.serviceAddress.delete({ where: { id: address.id } });
    if (!existingCustomer) await prisma.customer.delete({ where: { id: customer.id } });
  }
});
