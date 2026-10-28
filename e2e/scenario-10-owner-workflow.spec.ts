import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// PLAN scenario 10 (BATCH-F WU-F4): the owner runs a normal working session using only the owner's own screens. Change a
// price, publish a line of site copy, schedule a delivery, record a check and decide a deposit refund. Every step shows
// its saved result on the screen and is checked in the disposable database. Everything it changes is put back.
const ownerState = "e2e/.auth/owner.json";
const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(ownerState) ? ownerState : undefined });

test("the owner changes a price, publishes site words, schedules a delivery, records a check and decides a deposit", async ({ page, browser }, info) => {
  test.skip(!enabled || !fs.existsSync(ownerState), "Disposable CI database and owner session only");
  test.setTimeout(240_000);
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID().replaceAll("-", "").slice(0, 20);
  const customerUser = await prisma.user.create({ data: { id: `e10-user-${tag}`, email: `e10-${tag}@example.test`, name: `Workflow ${tag}`, role: "CUSTOMER", emailVerified: true } });
  const customer = await prisma.customer.create({ data: { id: `e10-cust-${tag}`, userId: customerUser.id, referralCode: `E${tag.slice(0, 18)}` } });
  const address = await prisma.serviceAddress.create({ data: { id: `e10-addr-${tag}`, customerId: customer.id, line1: "10 Workflow St", city: "Greeley", state: "CO", zip: "80631" } });
  // FEETAX-2: scheduling a delivery refuses an address whose tax places
  // are not confirmed yet, so the address is confirmed into the
  // state-collected state jurisdiction (ready: no city license rule).
  await prisma.addressTaxLocation.create({ data: { serviceAddressId: address.id, status: "VERIFIED", source: "MANUAL", lookedUpAt: new Date(), isCurrent: true, jurisdictions: { create: [{ jurisdictionId: "tax-jurisdiction-co" }] } } });
  const applianceType = await prisma.applianceType.create({ data: { id: `e10-type-${tag}`, name: `Workflow washer ${tag}`, slug: `e10-${tag}`, monthlyPriceCents: 4000 } });
  const agreement = await prisma.rentalAgreement.create({ data: { id: `e10-agr-${tag}`, customerId: customer.id, serviceAddressId: address.id, status: "ACTIVE", termMonths: 12 } });
  const job = await prisma.job.create({ data: { id: `e10-job-${tag}`, type: "DELIVERY", status: "SCHEDULED", customerId: customer.id, serviceAddressId: address.id } });
  const invoice = await prisma.invoice.create({ data: { id: `e10-inv-${tag}`, customerId: customer.id, agreementId: agreement.id, status: "OPEN", amountDueCents: 6000, dueDate: new Date("2026-09-01T12:00:00Z") } });
  const receipt = await prisma.receipt.create({ data: { id: `e10-rec-${tag}`, customerId: customer.id, source: "MANUAL", amountCents: 5000, method: "check", receivedOn: new Date("2026-10-01T12:00:00Z") } });
  const deposit = await prisma.deposit.create({ data: { id: `e10-dep-${tag}`, agreementId: agreement.id, sourceReceiptId: receipt.id, amountCents: 5000, refundable: true } });
  const introUrl = "/desk/settings/website?view=edit&page=how&key=how.intro";
  let originalIntro: string | null = null;
  try {
    // 1. Price: saved on the settings screen, written to the price history.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk/settings?section=products");
    // AR-8: the price table opens from its panel row on Prices & fees.
    await page.getByRole("button", { name: /Appliance prices/ }).click();
    const row = page.locator("main tr:visible, main li:visible").filter({ has: page.getByText(applianceType.name, { exact: true }) }).first();
    await row.getByRole("spinbutton", { name: `Monthly price for ${applianceType.name}` }).fill("42.50");
    await row.getByRole("button", { name: "Save", exact: true }).click();
    await expect(row.getByRole("status")).toHaveText("Saved");
    expect((await prisma.applianceType.findUniqueOrThrow({ where: { id: applianceType.id } })).monthlyPriceCents).toBe(4250);
    expect(await prisma.pricingRule.count({ where: { applianceTypeId: applianceType.id, oldValueCents: 4000, newValueCents: 4250 } })).toBe(1);

    // 2. Site copy: save a draft, review it, publish it; a visitor sees it.
    await page.goto(introUrl);
    const intro = page.getByRole("textbox", { name: "Introduction" });
    originalIntro = await intro.inputValue();
    const newWords = `Owner workflow words ${tag}`;
    await intro.fill(newWords);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("status").first()).toContainText("Draft saved");
    await page.getByRole("button", { name: /^Review \d+ changes?$/ }).click();
    await page.getByRole("button", { name: /^Publish \d+ changes? to the live website$/ }).click();
    await expect(page.getByRole("status").first()).toContainText(/now live|Already live/);
    const visitor = await browser.newContext();
    try {
      const v = await visitor.newPage();
      await v.goto("/how-it-works");
      await expect(v.locator("main")).toContainText(newWords);
    } finally {
      await visitor.close();
    }

    // 3. Delivery: pick a day and time on the job; it is saved and shown.
    await page.goto(`/desk/jobs/${job.id}`);
    await page.getByLabel("When", { exact: true }).fill("2027-03-02T10:00");
    await page.getByRole("button", { name: "Save schedule" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    const scheduled = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(scheduled.scheduledAt).not.toBeNull();

    // 4. Check: recorded against the open bill; it is applied once and the bill is paid.
    await page.goto(`/desk/billing/customer/${customer.id}`);
    await page.getByRole("button", { name: "+ Record payment" }).click();
    await page.getByLabel("Amount ($)").fill("60.00");
    await page.getByLabel("Apply to").selectOption(invoice.id);
    await page.getByRole("button", { name: "Record payment", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /Applied \$60 across 1 invoice/ })).toBeVisible();
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(paid.status).toBe("PAID");
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id, status: { in: ["SUCCEEDED", "succeeded"] } } })).toBe(1);

    // 5. Deposit: a partial give-back with a written reason is recorded; the money is recorded for the owner to return by hand.
    await page.goto(`/desk/billing/deposits/${deposit.id}`);
    await page.getByLabel(/^Amount \(most you can enter/).fill("40.00");
    await page.getByLabel(/Why are you keeping part of it/).fill("Scuffed door panel");
    await page.getByRole("checkbox", { name: /Yes, give back/ }).check();
    await page.getByRole("button", { name: "Record this decision" }).click();
    // The form is replaced by the saved decision once it is recorded.
    await expect(page.getByText(/A decision was already made: \$40 given back/)).toBeVisible();
    const decided = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(decided.refundedAmountCents).toBe(4000);
    expect(decided.deductionReason).toBe("Scuffed door panel");
    await page.reload();
    await expect(page.getByText(/A decision was already made: \$40 given back \(kept part because: Scuffed door panel\)/)).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
    await info.attach("owner-workflow-deposit-decided", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  } finally {
    // Put the website words back (publish the original) and remove everything this test created.
    if (originalIntro !== null) {
      await page.goto(introUrl);
      const box = page.getByRole("textbox", { name: "Introduction" });
      if ((await box.inputValue()) !== originalIntro) {
        await box.fill(originalIntro);
        await page.getByRole("button", { name: "Save draft" }).click();
        await expect(page.getByRole("status").first()).toContainText("Draft saved");
        await page.getByRole("button", { name: /^Review \d+ changes?$/ }).click();
        await page.getByRole("button", { name: /^Publish \d+ changes? to the live website$/ }).click();
        await expect(page.getByRole("status").first()).toContainText(/now live|Already live/);
      }
    }
    await prisma.pricingRule.deleteMany({ where: { applianceTypeId: applianceType.id } });
    await prisma.applianceType.deleteMany({ where: { id: applianceType.id } });
    // Best-effort removal of the records this test made (some history rows are append-only and stay; they hold no open money or work).
    const gone = async (work: () => Promise<unknown>) => { try { await work(); } catch { /* append-only or already gone */ } };
    const invoiceIds = (await prisma.invoice.findMany({ where: { customerId: customer.id }, select: { id: true } })).map((i) => i.id);
    await gone(() => prisma.creditApplication.deleteMany({ where: { invoiceId: { in: invoiceIds } } }));
    await gone(() => prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } }));
    await gone(() => prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } }));
    await gone(() => prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } }));
    await gone(() => prisma.deposit.deleteMany({ where: { id: deposit.id } }));
    await gone(() => prisma.receipt.deleteMany({ where: { customerId: customer.id } }));
    await gone(() => prisma.customerCredit.deleteMany({ where: { customerId: customer.id } }));
    await gone(() => prisma.staffTask.deleteMany({ where: { jobId: job.id } }));
    await gone(() => prisma.job.deleteMany({ where: { id: job.id } }));
    await gone(() => prisma.auditLog.deleteMany({ where: { entityId: { in: [deposit.id, job.id, agreement.id, ...invoiceIds] } } }));
    await gone(() => prisma.rentalAgreement.deleteMany({ where: { id: agreement.id } }));
    await gone(() => prisma.addressTaxLocation.deleteMany({ where: { serviceAddressId: address.id } }));
    await gone(() => prisma.serviceAddress.deleteMany({ where: { id: address.id } }));
    await gone(() => prisma.customer.deleteMany({ where: { id: customer.id } }));
    await gone(() => prisma.user.deleteMany({ where: { id: customerUser.id } }));
  }
});
