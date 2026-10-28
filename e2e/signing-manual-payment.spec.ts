import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ownerState = "e2e/.auth/owner.json";
const staffState = "e2e/.auth/staff.json";
const customerState = "e2e/.auth/customer.json";
const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(ownerState) ? ownerState : undefined });

test("manual signing collection is an owner-only, explicit accessible review — no simulated money is accepted", async ({
  page, browser,
}, info) => {
  test.skip(!enabled, "Requires disposable PostgreSQL and authenticated CI sessions.");
  for (const path of [ownerState, staffState, customerState]) {
    expect(fs.existsSync(path), path + " must exist").toBe(true);
  }
  const { prisma } = await import("../src/lib/prisma");
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.TEST_CUSTOMER_EMAIL!.toLowerCase() },
  });
  const customer = await prisma.customer.findUniqueOrThrow({ where: { userId: user.id } });
  const address = await prisma.serviceAddress.create({ data: {
    customerId: customer.id, line1: "13 Owner Only St", city: "Greeley",
    state: "CO", zip: "80631",
  } });
  const agreement = await prisma.rentalAgreement.create({ data: {
    customerId: customer.id, serviceAddressId: address.id, status: "AWAITING_SIGNATURE",
  } });
  // Display-only synthetic obligation: lacks genuine signed frozen evidence,
  // so the action must NOT settle it. The real signed/settled case is proved
  // by tests/signing-manual-payment-w22-integration.test.ts.
  await prisma.agreementSigningPayment.create({ data: {
    agreementId: agreement.id, orderFingerprint: "a".repeat(64), evidenceVersion: 1,
    setupFeeCents: 0, setupTaxCents: 0, downPaymentCents: 3500,
    totalCents: 3500, signedAt: new Date(), status: "AWAITING_PAYMENT",
  } });
  try {
    const path = "/desk/agreements/" + agreement.id;
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await page.setViewportSize({ width: 360, height: 900 });
    // AR-4a: signing work lives on the record's Signing tab now.
    await page.goto(path + "?tab=signing");
    await expect(page.getByRole("heading", { name: "Signing payment", exact: true })).toBeVisible();
    await expect(page.getByText("Record money received at signing", { exact: false })).toBeVisible();
    await expect(page.getByLabel("How was it paid?")).toBeVisible();
    await expect(page.getByLabel("Date received")).toBeVisible();
    await expect(page.getByLabel("Payment reference")).toBeVisible();
    await expect(page.getByRole("button", { name: "Record signing payment" })).toBeVisible();
    await prisma.signingPaymentAttempt.create({ data: {
      agreementId: agreement.id, requestKey: "w22-failure-" + randomUUID(),
      attemptNumber: 1, method: "STRIPE_CHECKOUT", status: "FAILED",
      orderFingerprint: "a".repeat(64), amountCents: 3500,
      failureCode: "STRIPE_ASYNC_PAYMENT_FAILED",
    } });
    await page.reload();
    await expect(page.getByText("The latest signing collection attempt failed", { exact: false })).toContainText("attempt failed");
    await expect(page.getByRole("button", { name: "Record signing payment" })).toBeVisible();
    expect((await new AxeBuilder({ page })
      .include('[aria-labelledby="signing-manual-heading"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);

    const staff = await browser.newContext({
      storageState: staffState, baseURL: info.project.use.baseURL as string,
    });
    const customerContext = await browser.newContext({
      storageState: customerState, baseURL: info.project.use.baseURL as string,
    });
    try {
      const staffPage = await staff.newPage();
      await staffPage.goto(path);
      await expect(staffPage.getByRole("button", { name: "Record signing payment" })).toHaveCount(0);
      const customerPage = await customerContext.newPage();
      await customerPage.goto(path);
      await expect(customerPage.getByRole("button", { name: "Record signing payment" })).toHaveCount(0);
    } finally {
      await staff.close();
      await customerContext.close();
    }

    await page.getByLabel("Payment reference").fill("CHK-" + randomUUID().slice(0, 8));
    await page.getByRole("checkbox", { name: /I verified that the full/ }).check();
    await page.getByRole("button", { name: "Record signing payment" }).click();
    await expect(page.getByRole("status").last()).not.toBeEmpty();
    // No genuine signature matches the display-only synthetic obligation.
    expect(await prisma.receipt.count({ where: { customerId: customer.id,
      notes: { startsWith: "W-22 exact signed manual payment" } } })).toBe(0);
    expect((await prisma.agreementSigningPayment.findUniqueOrThrow({
      where: { agreementId: agreement.id },
    })).status).toBe("AWAITING_PAYMENT");
  } finally {
    await prisma.signingPaymentAttempt.deleteMany({ where: { agreementId: agreement.id } });
    await prisma.agreementSigningPayment.delete({ where: { agreementId: agreement.id } });
    await prisma.rentalAgreement.delete({ where: { id: agreement.id } });
    await prisma.serviceAddress.delete({ where: { id: address.id } });
  }
});
