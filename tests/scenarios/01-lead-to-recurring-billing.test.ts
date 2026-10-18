// PLAN scenario 1 (BATCH-F WU-F3): a lead becomes a customer, a reviewed order is signed and paid, the delivery is
// completed and recurring billing starts exactly once. Real domain functions on the disposable Postgres; Stripe and
// email are faked at their client boundary. No real provider acceptance is claimed.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const tag = randomUUID().replaceAll("-", "");
const provider = vi.hoisted(() => ({ params: null as Stripe.SubscriptionCreateParams | null, calls: 0 }));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    products: { create: async () => ({ id: `prod_s1_${tag}` }) },
    subscriptions: {
      create: async (params: Stripe.SubscriptionCreateParams) => {
        provider.params = params;
        provider.calls++;
        return { id: `sub_s1_${tag}`, latest_invoice: `in_s1_${tag}` };
      },
    },
    invoices: {
      retrieve: async () => ({
        id: `in_s1_${tag}`, livemode: false, billing_reason: "subscription_create", currency: "usd",
        customer: provider.params?.customer, status: "open",
        parent: { subscription_details: { subscription: `sub_s1_${tag}` } },
      }),
      listLineItems: async () => ({
        has_more: false,
        data: (provider.params?.add_invoice_items ?? []).map((row, i) => ({
          id: `il_s1_${tag}_${i}`, livemode: false, invoice: `in_s1_${tag}`, amount: row.price_data?.unit_amount, metadata: row.metadata,
        })),
      }),
    },
  }),
}));
const mail = vi.hoisted(() => ({ sent: [] as string[] }));
vi.mock("@/lib/email", () => ({
  sendEmail: async (message: { to: string }) => {
    mail.sent.push(message.to);
    return { sent: true };
  },
}));
let owner = "";
vi.mock("@/lib/auth", () => ({
  auth: {
    api: { getSession: async () => ({ user: { id: owner, role: "OWNER", archivedAt: null } }) },
    // Conversion creates a credential login; a stand-in hasher keeps real password code out of the scenario.
    $context: Promise.resolve({ password: { hash: async (password: string) => `scenario-hash:${password.length}` } }),
  },
}));
vi.mock("@/domains/security/two-factor", () => ({ twoFactorEnrollmentRequired: async () => false }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { createLead, convertLeadToCustomer } from "@/domains/leads";
import { leadFormSchema } from "@/domains/leads/schema";
import { sendForSignature, signAgreement } from "@/domains/agreements";
import { recordSigningBusinessReview } from "@/domains/billing/signing-business-review";
import { prepareSigningPaymentAttempt } from "@/domains/billing/signing-payment-attempts";
import { recordManualSigningPayment } from "@/domains/billing/signing-payment-manual";
import { signingFirstInvoiceItem } from "@/domains/billing/signing-first-invoice-application";
import { startRecurringBillingForAgreement } from "@/domains/billing/checkout";
import { completeJob, updateJobStatus } from "@/domains/jobs";
import { createSyntheticW22V2Order } from "../helpers/w22-v2-order";
import { purgeScenarioQueues } from "../helpers/scenario-order";

const scenarioStartedAt = new Date();
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" && ["localhost", "127.0.0.1"].includes(url.hostname);
const day = businessDateKey(new Date());

describe.skipIf(!enabled)("scenario 1: lead to recurring billing", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let leadId = "";

  beforeAll(async () => {
    owner = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
  });
  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    await cleanup?.();
  });

  it("carries a property-manager lead through signing, payment, delivery and one subscription", async () => {
    // 1. The public form creates a scored lead with consent and one request row per machine type.
    const type = await prisma.applianceType.findFirstOrThrow();
    const input = leadFormSchema.parse({
      accountType: "business", isPropertyManager: true, companyName: `Scenario One ${tag}`, contactName: "Scenario One Manager",
      phone: "5551230001", email: `scenario1-${tag}@test.invalid`, applianceTypeIds: [type.id], quantity: 4,
      desiredTerm: "12-month", city: "Greeley", zip: "80631", consent: true,
    });
    const lead = await createLead(input);
    leadId = lead.id;
    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { applianceRequests: true } });
    expect(stored.status).toBe("NEW");
    expect(stored.consentedAt).toBeInstanceOf(Date);
    expect(stored.applianceRequests.length).toBeGreaterThan(0);

    // 2. The owner converts it: one new customer account, the lead is CONVERTED, a second convert is refused.
    const converted = await convertLeadToCustomer(owner, leadId);
    expect(converted.isNewAccount).toBe(true);
    const customerId = converted.customer.id;
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).status).toBe("CONVERTED");
    await expect(convertLeadToCustomer(owner, leadId)).rejects.toThrow();
    expect(await prisma.customer.count({ where: { id: customerId } })).toBe(1);

    // 3. A reviewed, frozen order for that customer (synthetic tax-ready address, mandatory-charge review and reserve).
    const fixture = await createSyntheticW22V2Order({ customerId });
    cleanup = fixture.cleanup;
    const agreementId = fixture.ids[0];
    await recordSigningBusinessReview(owner, {
      agreementId, expectedOrderFingerprint: fixture.orderFingerprint, decision: "APPROVED", effectiveFromKey: day, confirmedOnKey: day,
      taxAdviserReference: "Synthetic CPA advice for isolated test only", legalAdviserReference: "Synthetic attorney advice for isolated test only",
      termsReference: "Synthetic complete signing and refund terms", reason: "Synthetic owner attestation; no actual professional approval", acknowledged: true,
    });

    // 4. Signing: the customer signs; delivery cannot start before the money is actually received.
    const signature = await sendForSignature(owner, agreementId);
    await signAgreement(signature.id, { signerName: "Scenario One Manager", signerEmail: `scenario1-${tag}@test.invalid`, ipAddress: null });
    const job = await prisma.job.findFirstOrThrow({ where: { agreementId, type: "DELIVERY" } });
    expect(job.scheduledAt).toBeNull();
    await expect(updateJobStatus(owner, job.id, "IN_PROGRESS")).rejects.toThrow(/actually received/);

    // 5. A check is recorded once (a replay is a no-op) and creates the receipt, reserve and signing credit.
    const attempt = await prepareSigningPaymentAttempt(agreementId, "MANUAL", owner);
    const payment = { agreementId, attemptId: attempt.id, actingUserId: owner, method: "check" as const, reference: `S1-${tag}`, receivedOn: day, confirmedReceived: true };
    const first = await recordManualSigningPayment(payment);
    const replay = await recordManualSigningPayment(payment);
    expect([first.replayed, replay.replayed]).toEqual([false, true]);
    expect(first.amountCents).toBe(28631);
    const deposit = await prisma.deposit.findFirstOrThrow({ where: { agreementId } });
    expect(deposit.sourceReceiptId).toBe(first.receiptId);
    const credit = await prisma.signingDownPaymentCredit.findUniqueOrThrow({ where: { agreementId } });
    expect(credit.amountCents).toBe(6000);
    expect(signingFirstInvoiceItem(credit, `prod_s1_${tag}`).price_data!.unit_amount).toBe(-6000);

    // 6. Delivery: custody is assigned and completed; the first invoice starts the one subscription with the credit.
    const agreement = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId }, include: { lines: true } });
    await prisma.customer.update({ where: { id: customerId }, data: { stripeCustomerId: `cus_s1_${tag}`, stripeDefaultPaymentMethodId: `pm_s1_${tag}` } });
    expect((await updateJobStatus(owner, job.id, "IN_PROGRESS")).status).toBe("IN_PROGRESS");
    const results = [];
    for (let i = 0; i < 2; i++) {
      const machine = await prisma.appliance.create({ data: { assetNumber: `S1-${tag}-${i}`, applianceTypeId: type.id, status: "RESERVED" } });
      await prisma.applianceAssignment.create({ data: { rentalLineId: agreement.lines[0].id, applianceId: machine.id } });
      await prisma.jobAppliance.create({ data: { jobId: job.id, applianceId: machine.id } });
      results.push({ applianceId: machine.id, result: "DELIVERED" as const });
    }
    const fresh = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    const completion = { jobId: job.id, expectedVersion: fresh.version, completionKey: `s1-complete-${tag}`, performedOn: businessDateFromKey(day), completionNotes: null, results };
    await completeJob(owner, completion);
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } })).firstDeliveredOn).not.toBeNull();
    expect(provider.calls).toBe(1);
    expect(provider.params?.add_invoice_items?.[0].price_data?.unit_amount).toBe(-6000);
    expect((await prisma.signingFirstInvoiceApplication.findUniqueOrThrow({ where: { agreementId } })).amountCents).toBe(6000);

    // 7. Replays create no second subscription, no second application and no second delivery record.
    expect((await completeJob(owner, completion)).replayed).toBe(true);
    await startRecurringBillingForAgreement(agreementId);
    expect(provider.calls).toBe(1);
    expect(await prisma.signingFirstInvoiceApplication.count({ where: { agreementId } })).toBe(1);
    expect(await prisma.applianceAssignment.count({ where: { rentalLineId: agreement.lines[0].id, applianceId: { in: results.map((r) => r.applianceId) } } })).toBe(2);

    // 8. The history is on the record: the owner's actions left audit rows tied to this agreement.
    expect(await prisma.auditLog.count({ where: { entityId: agreementId } })).toBeGreaterThan(0);
  });
});
