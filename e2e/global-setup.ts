import fs from "node:fs";
import { chromium, type FullConfig } from "@playwright/test";
import { loginAs } from "./utils/auth";
import { completeTwoFactorSetup } from "./utils/two-factor";

// Logs in once per role (OWNER, CUSTOMER) and saves the resulting
// session to disk, so e2e/accessibility-authenticated.spec.ts's many
// tests can each start already logged in via `test.use({ storageState })`
// instead of every single test doing its own real /login round-trip in
// a beforeEach hook. That original per-test-login approach worked but
// was fragile under Playwright's default parallelism — 15 real logins
// fired in quick succession against one `next start` process on a
// modest CI runner intermittently timed out waiting for a response
// (see docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md's dated entry). Logging in twice, total, instead
// of fifteen times is both the standard Playwright pattern for this
// ("reuse signed-in state") and the actual fix.
//
// No-ops entirely if the env vars aren't set — same opt-in pattern as
// prisma/seed.ts's test-account creation; a local run without them
// just has both authenticated describe blocks skip themselves.
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3000";
  fs.mkdirSync("e2e/.auth", { recursive: true });
  const browser = await chromium.launch(config.projects[0]?.use?.launchOptions);

  const ownerEmail = process.env.OWNER_EMAIL;
  const ownerPassword = process.env.OWNER_PASSWORD;
  if (ownerEmail && ownerPassword) {
    const page = await browser.newPage({ baseURL });
    await loginAs(page, ownerEmail, ownerPassword);
    // Force one protected request to settle completely before deciding
    // whether this fresh CI owner needs enrollment. The password login can
    // briefly navigate through /desk/today before the server-side 2FA gate
    // redirects to setup.
    await page.goto("/desk/today");
    if (new URL(page.url()).pathname === "/desk/security/setup") {
      await completeTwoFactorSetup(page, ownerPassword);
    }
    await page.context().storageState({ path: "e2e/.auth/owner.json" });
    await page.close();
  }

  const customerEmail = process.env.TEST_CUSTOMER_EMAIL;
  const customerPassword = process.env.TEST_CUSTOMER_PASSWORD;
  if (customerEmail && customerPassword) {
    const page = await browser.newPage({ baseURL });
    await loginAs(page, customerEmail, customerPassword);
    await page.context().storageState({ path: "e2e/.auth/customer.json" });
    await page.close();
  }

  const adminEmail = process.env.TEST_ADMIN_EMAIL;
  const adminPassword = process.env.TEST_ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const page = await browser.newPage({ baseURL });
    try {
      await loginAs(page, adminEmail, adminPassword);
    } catch (error) {
      // CI-only diagnosis of browser fixture readiness. Never log passwords.
      console.error("ADMIN E2E LOGIN", page.url(),
        await page.locator('[role="alert"]').allTextContents());
      throw error;
    }
    await page.goto("/desk/today");
    if (new URL(page.url()).pathname === "/desk/security/setup") {
      await completeTwoFactorSetup(page, adminPassword);
    }
    await page.context().storageState({ path: "e2e/.auth/admin.json" });
    await page.close();
  }

  const staffEmail = process.env.TEST_STAFF_EMAIL;
  const staffPassword = process.env.TEST_STAFF_PASSWORD;
  if (staffEmail && staffPassword) {
    const page = await browser.newPage({ baseURL });
    await loginAs(page, staffEmail, staffPassword);
    await page.context().storageState({ path: "e2e/.auth/staff.json" });
    await page.close();
  }

  await browser.close();
  await seedAccessibilityFixtures();
}

// AR-10 §3: most detail pages used to be manual-only in the accessibility
// inventory because their ids are generated per run. On the throwaway CI
// database, create one small deterministic graph (a customer with an active
// rental, a quote, a bill, a job, a message thread with synthetic text, an
// appliance, a part, a purchase order, a tax period, and the records their
// sibling pages need) and write the ids to e2e/.fixtures.json; the route
// inventory's automated fixtures reference them as {key}. Fixed "ci-a11y-"
// ids + upserts keep reruns idempotent. Any failure is logged loudly and
// leaves the file unwritten, so the affected scans skip instead of visiting
// a template URL.
async function seedAccessibilityFixtures(): Promise<void> {
  const customerEmail = process.env.TEST_CUSTOMER_EMAIL;
  if (process.env.CI !== "true" || !customerEmail || !process.env.DATABASE_URL) return;
  const target = new URL(process.env.DATABASE_URL);
  if (target.hostname !== "localhost" || target.pathname !== "/appliance_desk_test") return;
  try {
    const { prisma } = await import("../src/lib/prisma");
    const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } });
    const customer = await prisma.customer.findFirstOrThrow({
      where: { user: { email: { equals: customerEmail, mode: "insensitive" } } },
      include: { serviceAddresses: true },
    });
    const agreement = await prisma.rentalAgreement.findFirstOrThrow({
      where: { customerId: customer.id, status: "ACTIVE" },
    });
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { customerId: customer.id, status: "PAID" },
      orderBy: { createdAt: "asc" },
    });
    const address = customer.serviceAddresses[0];
    const now = new Date();

    await prisma.supplier.upsert({
      where: { id: "ci-a11y-supplier" },
      create: { id: "ci-a11y-supplier", name: "CI Accessibility Supplier", email: "ci-a11y-supplier@example.test" },
      update: {},
    });
    await prisma.partRecord.upsert({
      where: { id: "ci-a11y-part" },
      create: { id: "ci-a11y-part", modelNumber: "CI-A11Y-WASHER", partNumber: "CI-A11Y-PART-1", partName: "CI accessibility drive belt", quantityOnHand: 4 },
      update: {},
    });
    await prisma.purchaseOrder.upsert({
      where: { id: "ci-a11y-po" },
      create: { id: "ci-a11y-po", supplierId: "ci-a11y-supplier", status: "ORDERED", orderedAt: now, createdByUserId: owner.id },
      update: {},
    });
    await prisma.purchase.upsert({
      where: { operationKey: "ci-a11y-purchase" },
      create: {
        id: "ci-a11y-purchase", operationKey: "ci-a11y-purchase", payloadHash: "ci-a11y-payload",
        supplierId: "ci-a11y-supplier", purchasedOn: now, subtotalCents: 12000,
        sellerTaxKind: "NONE", createdByUserId: owner.id, taxRevisionAt: now,
      },
      update: {},
    });
    await prisma.lead.upsert({
      where: { id: "ci-a11y-lead" },
      create: {
        id: "ci-a11y-lead", contactName: "CI Accessibility Lead", phone: "303-555-0100",
        email: "ci-a11y-lead@example.test", status: "NEW",
        notes: "Synthetic accessibility fixture.",
      },
      update: {},
    });
    await prisma.estimate.upsert({
      where: { id: "ci-a11y-estimate" },
      create: {
        id: "ci-a11y-estimate", customerId: customer.id, status: "SENT",
        title: "CI accessibility quote", sentAt: now, createdByUserId: owner.id,
        validUntil: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
      update: {},
    });
    await prisma.maintenanceRequest.upsert({
      where: { id: "ci-a11y-maintenance" },
      create: {
        id: "ci-a11y-maintenance", customerId: customer.id, applianceId: "ci-security-appliance",
        serviceAddressId: address?.id, problem: "Synthetic accessibility-check repair request: the washer hums.",
        status: "SUBMITTED",
      },
      update: {},
    });
    await prisma.deposit.upsert({
      where: { id: "ci-a11y-deposit" },
      create: { id: "ci-a11y-deposit", agreementId: agreement.id, amountCents: 15000 },
      update: {},
    });
    await prisma.complianceFiling.upsert({
      where: { obligationKey_periodKey: { obligationKey: "fed.4562", periodKey: "2026" } },
      create: {
        id: "ci-a11y-filing", obligationKey: "fed.4562", periodKey: "2026", state: "UPCOMING",
        dueOn: new Date("2027-04-15T00:00:00Z"), actOn: new Date("2027-03-01T00:00:00Z"),
      },
      update: {},
    });
    await prisma.businessPaperwork.upsert({
      where: { id: "ci-a11y-paperwork" },
      create: { id: "ci-a11y-paperwork", title: "CI accessibility paperwork", groupName: "CI fixtures", status: "TO_DO" },
      update: {},
    });
    await prisma.customerNotice.upsert({
      where: { dedupeKey: "ci-a11y-notice" },
      create: {
        id: "ci-a11y-notice", customerId: customer.id, agreementId: agreement.id,
        kind: "PAYMENT_REMINDER", dedupeKey: "ci-a11y-notice",
        subject: "Synthetic accessibility-check notice",
        body: "Synthetic accessibility-check notice body.", status: "FAILED",
      },
      update: {},
    });
    await prisma.safetyIncident.upsert({
      where: { id: "ci-a11y-incident" },
      create: {
        id: "ci-a11y-incident", applianceId: "ci-security-appliance",
        description: "Synthetic accessibility-check safety incident.", markedByUserId: owner.id,
        decision: "PENDING",
      },
      update: {},
    });
    await prisma.invoice.upsert({
      where: { id: "ci-a11y-sale" },
      create: {
        id: "ci-a11y-sale", customerId: customer.id, saleKind: "SHOP_SALE", saleLocation: "PICKUP",
        status: "PAID", subtotalCents: 5000, taxCents: 365, amountDueCents: 5365, amountPaidCents: 5365,
      },
      update: {},
    });
    await prisma.taxFilingAccount.upsert({
      where: { id: "ci-a11y-tax-account" },
      create: { id: "ci-a11y-tax-account", name: "CI accessibility sales tax account", kind: "SALES_RETURN", frequency: "MONTHLY" },
      update: {},
    });
    await prisma.taxFilingPeriod.upsert({
      where: { id: "ci-a11y-tax-period" },
      create: {
        id: "ci-a11y-tax-period", filingAccountId: "ci-a11y-tax-account",
        periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-09-30T00:00:00Z"),
        dueOn: new Date("2026-10-20T00:00:00Z"), status: "OPEN",
      },
      update: {},
    });
    await prisma.taxFilingAccount.upsert({
      where: { id: "ci-a11y-usetax-account" },
      create: { id: "ci-a11y-usetax-account", name: "CI accessibility use tax account", kind: "USE_TAX_RETURN", frequency: "MONTHLY" },
      update: {},
    });
    await prisma.taxFilingPeriod.upsert({
      where: { id: "ci-a11y-usetax-period" },
      create: {
        id: "ci-a11y-usetax-period", filingAccountId: "ci-a11y-usetax-account",
        periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-09-30T00:00:00Z"),
        dueOn: new Date("2026-10-20T00:00:00Z"), status: "OPEN",
      },
      update: {},
    });
    await prisma.telecomAccount.upsert({
      where: { id: "ci-a11y-telecom" },
      create: {
        id: "ci-a11y-telecom", provider: "twilio", environment: "TEST",
        externalAccountId: "CI-A11Y-ACCOUNT", label: "CI accessibility telecom",
      },
      update: {},
    });
    await prisma.businessPhoneNumber.upsert({
      where: { id: "ci-a11y-number" },
      create: {
        id: "ci-a11y-number", accountId: "ci-a11y-telecom", address: "+13035550199",
        providerNumberId: "CI-A11Y-PN", isPrimary: true,
      },
      update: {},
    });
    await prisma.contactPoint.upsert({
      where: { environment_channel_address: { environment: "TEST", channel: "SMS", address: "+13035550100" } },
      create: { id: "ci-a11y-contact", environment: "TEST", channel: "SMS", address: "+13035550100" },
      update: {},
    });
    await prisma.communicationThread.upsert({
      where: { id: "ci-a11y-thread" },
      create: {
        id: "ci-a11y-thread", accountId: "ci-a11y-telecom", businessNumberId: "ci-a11y-number",
        externalContactPointId: "ci-a11y-contact", customerId: customer.id, status: "OPEN",
      },
      update: {},
    });
    try {
      const { encryptCommunicationContent, hashCommunicationContent } = await import(
        "../src/domains/messaging/communications-content"
      );
      const body = "Synthetic accessibility-check message.";
      await prisma.communicationMessage.upsert({
        where: { id: "ci-a11y-message" },
        create: {
          id: "ci-a11y-message", threadId: "ci-a11y-thread", accountId: "ci-a11y-telecom",
          direction: "INBOUND", bodyEncrypted: encryptCommunicationContent(body),
          bodyHash: hashCommunicationContent(body), occurredAt: now,
        },
        update: {},
      });
    } catch (error) {
      console.error("Accessibility fixture message skipped (thread still created):", error);
    }

    fs.writeFileSync(
      "e2e/.fixtures.json",
      JSON.stringify(
        {
          customerId: customer.id,
          agreementId: agreement.id,
          invoiceId: invoice.id,
          estimateId: "ci-a11y-estimate",
          leadId: "ci-a11y-lead",
          maintenanceId: "ci-a11y-maintenance",
          threadId: "ci-a11y-thread",
          applianceId: "ci-security-appliance",
          partId: "ci-a11y-part",
          purchaseOrderId: "ci-a11y-po",
          purchaseId: "ci-a11y-purchase",
          supplierId: "ci-a11y-supplier",
          depositId: "ci-a11y-deposit",
          filingId: "ci-a11y-filing",
          paperworkId: "ci-a11y-paperwork",
          noticeId: "ci-a11y-notice",
          incidentId: "ci-a11y-incident",
          saleId: "ci-a11y-sale",
          taxPeriodId: "ci-a11y-tax-period",
          taxAccountId: "ci-a11y-tax-account",
          useTaxPeriodId: "ci-a11y-usetax-period",
        },
        null,
        2,
      ),
    );
    console.log("Wrote e2e/.fixtures.json with the accessibility fixture ids.");
  } catch (error) {
    console.error("Accessibility fixture seeding FAILED — fixture routes will skip:", error);
  }
}
