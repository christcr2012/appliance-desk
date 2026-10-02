import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { __setStripeClientForTests } from "@/lib/stripe";
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

function event(id: string, invoiceId: string, subscriptionId: string): Stripe.Event {
  return {
    id,
    type: "invoice.paid",
    data: {
      object: {
        id: invoiceId,
        parent: { subscription_details: { subscription: subscriptionId } },
      },
    },
  } as unknown as Stripe.Event;
}

function invoicePayment(
  id: string,
  invoiceId: string,
  paymentIntentId: string,
  amountPaid: number,
  paidAt: number,
): Stripe.InvoicePayment {
  return {
    id,
    object: "invoice_payment",
    amount_paid: amountPaid,
    amount_requested: amountPaid,
    created: paidAt,
    currency: "usd",
    invoice: invoiceId,
    is_default: true,
    livemode: false,
    payment: { type: "payment_intent", payment_intent: paymentIntentId },
    status: "paid",
    status_transitions: { paid_at: paidAt, canceled_at: null },
  } as Stripe.InvoicePayment;
}

describe.skipIf(!enabled)("Stripe receipt review regressions — real Postgres", () => {
  const tag = randomUUID();
  const subscriptionId = `sub_review_${tag}`;
  const invoices = new Map<string, Stripe.Invoice>();
  let userId: string;
  let customerId: string;
  let addressId: string;
  let agreementId: string;
  let lineId: string;
  let applianceTypeId: string;

  beforeAll(async () => {
    const applianceType = await prisma.applianceType.create({
      data: {
        name: `Stripe review ${tag}`,
        slug: `stripe-review-${tag}`,
        monthlyPriceCents: 4_000,
      },
    });
    applianceTypeId = applianceType.id;
    const user = await prisma.user.create({
      data: {
        email: `stripe-review-${tag}@example.test`,
        name: "Stripe Receipt Review",
        role: "CUSTOMER",
        emailVerified: true,
      },
    });
    userId = user.id;
    const customer = await prisma.customer.create({
      data: { userId, referralCode: `SR-${tag}`.slice(0, 20) },
    });
    customerId = customer.id;
    const address = await prisma.serviceAddress.create({
      data: {
        customerId,
        line1: "141 Review Way",
        city: "Denver",
        zip: "80202",
      },
    });
    addressId = address.id;
    const agreement = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        stripeSubscriptionId: subscriptionId,
      },
    });
    agreementId = agreement.id;
    const line = await prisma.rentalLine.create({
      data: {
        agreementId,
        label: "Washer",
        monthlyPriceCents: 4_000,
        listPriceCents: 4_000,
      },
    });
    lineId = line.id;

    __setStripeClientForTests({
      invoices: {
        retrieve: async (id: string) => invoices.get(id)!,
      },
      paymentIntents: {
        retrieve: async (id: string) =>
          ({
            id,
            payment_method: { id: `pm_${id}`, type: "card" },
            latest_charge: {
              id: `ch_${id}`,
              created: id.includes("second") ? 1_800_000_200 : 1_800_000_100,
            },
          }) as unknown as Stripe.PaymentIntent,
      },
    } as unknown as Stripe);
  });

  afterAll(async () => {
    __setStripeClientForTests(null);
    await prisma.payment.deleteMany({ where: { invoice: { agreementId } } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.receipt.deleteMany({ where: { customerId } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { agreementId } } });
    await prisma.invoice.deleteMany({ where: { agreementId } });
    await prisma.webhookEvent.deleteMany({
      where: { id: { in: [`evt_over_${tag}`, `evt_multi_${tag}`] } },
    });
    await prisma.rentalLine.delete({ where: { id: lineId } });
    await prisma.rentalAgreement.delete({ where: { id: agreementId } });
    await prisma.serviceAddress.delete({ where: { id: addressId } });
    await prisma.customer.delete({ where: { id: customerId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.applianceType.delete({ where: { id: applianceTypeId } });
  });

  it("splits a Stripe overpayment into invoice allocation plus receipt-provenanced credit", async () => {
    const invoiceId = `in_over_${tag}`;
    const paidAt = 1_800_000_000;
    invoices.set(
      invoiceId,
      {
        id: invoiceId,
        status: "paid",
        subtotal: 4_000,
        total_taxes: [],
        amount_due: 4_000,
        amount_paid: 4_500,
        period_start: paidAt - 2_592_000,
        period_end: paidAt,
        due_date: null,
        parent: { subscription_details: { subscription: subscriptionId } },
        status_transitions: { paid_at: paidAt },
        payments: {
          object: "list",
          data: [invoicePayment(`inpay_over_${tag}`, invoiceId, `pi_over_${tag}`, 4_500, paidAt)],
          has_more: false,
          url: `/v1/invoices/${invoiceId}/payments`,
        },
        lines: {
          object: "list",
          data: [{ description: "Washer", amount: 4_000 }],
          has_more: false,
          url: `/v1/invoices/${invoiceId}/lines`,
        },
      } as unknown as Stripe.Invoice,
    );

    await processStripeWebhookEvent(event(`evt_over_${tag}`, invoiceId, subscriptionId));

    const localInvoice = await prisma.invoice.findUniqueOrThrow({
      where: { stripeInvoiceId: invoiceId },
      include: { payments: true },
    });
    expect(localInvoice.status).toBe("PAID");
    expect(localInvoice.amountPaidCents).toBe(4_000);
    expect(localInvoice.payments).toHaveLength(1);
    expect(localInvoice.payments[0].amountCents).toBe(4_000);

    const receipt = await prisma.receipt.findUniqueOrThrow({
      where: { id: localInvoice.payments[0].receiptId! },
    });
    expect(receipt.amountCents).toBe(4_500);
    expect(receipt.stripeChargeId).toBe(`ch_pi_over_${tag}`);

    const credit = await prisma.customerCredit.findFirstOrThrow({
      where: {
        sourceType: "RECEIPT_OVERPAYMENT",
        sourceId: receipt.id,
        side: null,
      },
    });
    expect(credit.amountCents).toBe(500);
    expect(credit.remainingCents).toBe(500);
  });

  it("keeps two paid InvoicePayments as two receipts with their own provider identities", async () => {
    const invoiceId = `in_multi_${tag}`;
    const paidAt = 1_800_001_000;
    invoices.set(
      invoiceId,
      {
        id: invoiceId,
        status: "paid",
        subtotal: 4_000,
        total_taxes: [],
        amount_due: 4_000,
        amount_paid: 4_000,
        period_start: paidAt - 2_592_000,
        period_end: paidAt,
        due_date: null,
        parent: { subscription_details: { subscription: subscriptionId } },
        status_transitions: { paid_at: paidAt },
        payments: {
          object: "list",
          data: [
            invoicePayment(`inpay_first_${tag}`, invoiceId, `pi_first_${tag}`, 1_500, paidAt - 60),
            invoicePayment(`inpay_second_${tag}`, invoiceId, `pi_second_${tag}`, 2_500, paidAt),
          ],
          has_more: false,
          url: `/v1/invoices/${invoiceId}/payments`,
        },
        lines: {
          object: "list",
          data: [{ description: "Washer", amount: 4_000 }],
          has_more: false,
          url: `/v1/invoices/${invoiceId}/lines`,
        },
      } as unknown as Stripe.Invoice,
    );

    await processStripeWebhookEvent(event(`evt_multi_${tag}`, invoiceId, subscriptionId));

    const localInvoice = await prisma.invoice.findUniqueOrThrow({
      where: { stripeInvoiceId: invoiceId },
      include: { payments: { include: { receipt: true } } },
    });
    expect(localInvoice.status).toBe("PAID");
    expect(localInvoice.amountPaidCents).toBe(4_000);
    expect(localInvoice.payments.map((payment) => payment.amountCents).sort()).toEqual([1_500, 2_500]);

    const receipts = localInvoice.payments.map((payment) => payment.receipt!);
    expect(new Set(receipts.map((receipt) => receipt.id)).size).toBe(2);
    expect(receipts.map((receipt) => receipt.amountCents).sort()).toEqual([1_500, 2_500]);
    expect(new Set(receipts.map((receipt) => receipt.stripeChargeId))).toEqual(
      new Set([`ch_pi_first_${tag}`, `ch_pi_second_${tag}`]),
    );
    expect(
      await prisma.customerCredit.count({
        where: { sourceType: "RECEIPT_OVERPAYMENT", sourceId: { in: receipts.map((r) => r.id) } },
      }),
    ).toBe(0);
  });
});
