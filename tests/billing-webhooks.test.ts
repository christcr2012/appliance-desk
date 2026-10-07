import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { __setStripeClientForTests } from "@/lib/stripe";
import { getAccountingTransactions } from "@/domains/reports/accounting-export";
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";
import { seedTaxReadyContext } from "./helpers/tax-ready";

const RUN_ID = Math.random().toString(36).slice(2, 10);

let applianceTypeId: string;
let userId: string;
let customerId: string;
let serviceAddressId: string;
let agreementId: string;
let lineId: string;
let fakeInvoicesById: Record<string, Record<string, unknown>>;
let taxFixture: Awaited<ReturnType<typeof seedTaxReadyContext>>;
const STRIPE_TAX_RATE_ID = `txr_billing_${RUN_ID}`;

function fakeEvent(id: string, type: string, object: unknown): Stripe.Event {
  return { id, type, data: { object } } as unknown as Stripe.Event;
}

beforeAll(async () => {
  const applianceType = await prisma.applianceType.create({
    data: {
      name: `Billing Test Type ${RUN_ID}`,
      slug: `billing-test-type-${RUN_ID}`,
      monthlyPriceCents: 5000,
    },
  });
  applianceTypeId = applianceType.id;

  const user = await prisma.user.create({
    data: {
      email: `billing-test-${RUN_ID}@example.test`,
      name: "Billing Test Customer",
      role: "CUSTOMER",
      emailVerified: true,
    },
  });
  userId = user.id;

  const customer = await prisma.customer.create({
    data: {
      userId: user.id,
      referralCode: `BILL${RUN_ID}`.slice(0, 20).toUpperCase(),
    },
  });
  customerId = customer.id;

  const serviceAddress = await prisma.serviceAddress.create({
    data: {
      customerId: customer.id,
      line1: "100 Test St",
      city: "Denver",
      zip: "80201",
    },
  });
  serviceAddressId = serviceAddress.id;
  taxFixture = await seedTaxReadyContext(serviceAddress.id, { rateMilliPercent: 7300 });
  await prisma.taxRateVersion.update({
    where: { id: taxFixture.rateVersionId },
    data: { stripeTaxRateId: STRIPE_TAX_RATE_ID },
  });

  const agreement = await prisma.rentalAgreement.create({
    data: {
      customerId: customer.id,
      serviceAddressId: serviceAddress.id,
      status: "ACTIVE",
      depositCents: 15000,
      damageWaiverCents: 0,
      taxRateMilliPercent: 7300,
    },
  });
  agreementId = agreement.id;

  const line = await prisma.rentalLine.create({
    data: {
      agreementId: agreement.id,
      label: "Washer",
      monthlyPriceCents: 4000,
      listPriceCents: 4000,
    },
  });
  lineId = line.id;

  fakeInvoicesById = {
    in_fake_1: {
      id: "in_fake_1",
      status: "paid",
      subtotal: 4000,
      total_taxes: [{ amount: 292 }],
      amount_due: 19292,
      amount_paid: 19292,
      period_start: 1735689600,
      period_end: 1738368000,
      due_date: null,
      parent: { subscription_details: { subscription: "sub_fake_1" } },
      payments: {
        data: [
          {
            payment: {
              type: "payment_intent",
              payment_intent: "pi_fake_1",
            },
          },
        ],
      },
      lines: {
        data: [
          {
            description: "Washer",
            amount: 4000,
            taxes: [
              {
                amount: 292,
                taxable_amount: 4000,
                tax_rate_details: { tax_rate: STRIPE_TAX_RATE_ID },
              },
            ],
          },
          { description: "Security deposit", amount: 15000 },
        ],
      },
    },
    in_fake_failed_1: {
      id: "in_fake_failed_1",
      status: "open",
      subtotal: 4000,
      total_taxes: [{ amount: 292 }],
      amount_due: 4292,
      amount_paid: 0,
      period_start: 1738368000,
      period_end: 1741046400,
      due_date: null,
      parent: { subscription_details: { subscription: "sub_fake_1" } },
      payments: {
        data: [
          {
            payment: {
              type: "payment_intent",
              payment_intent: "pi_fake_failed",
            },
          },
        ],
      },
      lines: {
        data: [
          {
            description: "Washer",
            amount: 4000,
            taxes: [
              {
                amount: 292,
                taxable_amount: 4000,
                tax_rate_details: { tax_rate: STRIPE_TAX_RATE_ID },
              },
            ],
          },
        ],
      },
    },
    in_fake_ach_pending: {
      id: "in_fake_ach_pending",
      status: "open",
      subtotal: 4000,
      total_taxes: [{ amount: 292 }],
      amount_due: 4292,
      amount_paid: 0,
      period_start: 1738368000,
      period_end: 1741046400,
      due_date: null,
      parent: { subscription_details: { subscription: "sub_fake_1" } },
      payments: {
        data: [
          {
            payment: {
              type: "payment_intent",
              payment_intent: "pi_fake_ach",
            },
          },
        ],
      },
      lines: {
        data: [
          {
            description: "Washer",
            amount: 4000,
            taxes: [
              {
                amount: 292,
                taxable_amount: 4000,
                tax_rate_details: { tax_rate: STRIPE_TAX_RATE_ID },
              },
            ],
          },
        ],
      },
    },
  };

  __setStripeClientForTests({
    invoices: {
      retrieve: async (id: string) =>
        fakeInvoicesById[id] as unknown as Stripe.Invoice,
    },
    paymentIntents: {
      retrieve: async (id: string) =>
        ({
          id,
          payment_method: { id: `pm_from_${id}`, type: "card" },
          latest_charge: null,
        }) as unknown as Stripe.PaymentIntent,
    },
    setupIntents: {
      retrieve: async (id: string) =>
        ({ payment_method: `pm_from_${id}` }) as unknown as Stripe.SetupIntent,
    },
  } as unknown as Stripe);
});

afterAll(async () => {
  __setStripeClientForTests(null);
  await prisma.payment.deleteMany({ where: { invoice: { agreementId } } });
  await prisma.invoiceTaxLine.deleteMany({ where: { invoice: { agreementId } } });
  await prisma.invoiceLineItem.deleteMany({
    where: { invoice: { agreementId } },
  });
  await prisma.invoice.deleteMany({ where: { agreementId } });
  await prisma.deposit.deleteMany({ where: { agreementId } });
  await prisma.receipt.deleteMany({ where: { customerId } });
  await prisma.customerCredit.deleteMany({ where: { customerId } });
  await prisma.webhookEvent.deleteMany({
    where: {
      id: {
        in: [
          "evt_checkout_1",
          "evt_checkout_1_retry",
          "evt_failed_1",
          "evt_failed_1_recovered",
          "evt_ach_checkout",
          "evt_ach_paid",
          "evt_setup_1",
          "evt_payment_pending",
          "evt_payment_paid",
          "evt_async_succeeded",
          "evt_async_failed",
        ],
      },
    },
  });
  await prisma.auditLog.deleteMany({ where: { entityId: agreementId } });
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.rentalLine.delete({ where: { id: lineId } });
  await prisma.rentalAgreement.delete({ where: { id: agreementId } });
  await taxFixture.cleanup();
  await prisma.serviceAddress.delete({ where: { id: serviceAddressId } });
  await prisma.customer.delete({ where: { id: customerId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.applianceType.delete({ where: { id: applianceTypeId } });
});

describe("processStripeWebhookEvent — checkout.session.completed", () => {
  it("creates the first invoice, one receipt/allocation, line items and deposit; advances billing state", async () => {
    const event = fakeEvent("evt_checkout_1", "checkout.session.completed", {
      mode: "subscription",
      invoice: "in_fake_1",
      metadata: { agreementId },
    });

    await processStripeWebhookEvent(event);

    const invoice = await prisma.invoice.findUnique({
      where: { stripeInvoiceId: "in_fake_1" },
      include: { lineItems: true, payments: true, taxLines: true },
    });
    expect(invoice).not.toBeNull();
    expect(invoice!.status).toBe("PAID");
    expect(invoice!.customerId).toBe(customerId);
    expect(invoice!.amountPaidCents).toBe(19292);
    expect(invoice!.payments).toHaveLength(1);
    expect(invoice!.payments[0].receiptId).not.toBeNull();

    const receipt = await prisma.receipt.findUniqueOrThrow({
      where: { id: invoice!.payments[0].receiptId! },
    });
    expect(receipt).toMatchObject({
      customerId,
      source: "STRIPE",
      amountCents: 19292,
      method: "card",
    });

    const cashRows = (await getAccountingTransactions()).filter(
      (row) => row.customerName === "Billing Test Customer",
    );
    expect(cashRows).toHaveLength(1);
    expect(cashRows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(19292);

    expect(invoice!.taxCents).toBe(292);
    const rentalLine = invoice!.lineItems.find((item) => item.kind === "RENTAL");
    expect(rentalLine?.amountCents).toBe(4000);
    expect(rentalLine?.rentalLineId).toBe(lineId);
    expect(invoice!.lineItems.find((item) => item.kind === "DEPOSIT")?.amountCents).toBe(15000);
    expect(invoice!.lineItems.find((item) => item.kind === "TAX")?.amountCents).toBe(292);
    expect(invoice!.taxLines).toEqual([
      expect.objectContaining({
        invoiceLineItemId: rentalLine?.id,
        jurisdictionId: taxFixture.jurisdictionId,
        rateVersionId: taxFixture.rateVersionId,
        category: "RENTAL",
        taxableCents: 4000,
        exemptCents: 0,
        taxCents: 292,
        source: "STRIPE",
      }),
    ]);
    expect(invoice!.payments[0].status).toBe("succeeded");
    expect(invoice!.payments[0].method).toBe("card");

    const deposit = await prisma.deposit.findFirst({ where: { agreementId } });
    expect(deposit?.amountCents).toBe(15000);
    const updatedAgreement = await prisma.rentalAgreement.findUniqueOrThrow({
      where: { id: agreementId },
    });
    expect(updatedAgreement.stripeSubscriptionId).toBe("sub_fake_1");
    expect(updatedAgreement.nextBillingDate?.getTime()).toBe(1738368000 * 1000);
  });

  it("is idempotent — replaying the same event id does not create a second invoice, receipt or deposit", async () => {
    const event = fakeEvent("evt_checkout_1", "checkout.session.completed", {
      mode: "subscription",
      invoice: "in_fake_1",
      metadata: { agreementId },
    });
    await processStripeWebhookEvent(event);
    expect(await prisma.invoice.count({ where: { agreementId } })).toBe(1);
    expect(await prisma.receipt.count({ where: { customerId } })).toBe(1);
    expect(await prisma.deposit.count({ where: { agreementId } })).toBe(1);
  });

  it("ignores an event with no agreementId in its metadata", async () => {
    const event = fakeEvent("evt_checkout_1_retry", "checkout.session.completed", {
      mode: "subscription",
      invoice: "in_fake_unrelated",
      metadata: {},
    });
    await expect(processStripeWebhookEvent(event)).resolves.not.toThrow();
    expect(
      await prisma.invoice.findUnique({
        where: { stripeInvoiceId: "in_fake_unrelated" },
      }),
    ).toBeNull();
  });
});

describe("processStripeWebhookEvent — invoice.payment_failed", () => {
  it("creates a DELINQUENT invoice and failed attempt but no receipt", async () => {
    const receiptsBefore = await prisma.receipt.count({ where: { customerId } });
    const event = fakeEvent("evt_failed_1", "invoice.payment_failed", {
      id: "in_fake_failed_1",
      parent: { subscription_details: { subscription: "sub_fake_1" } },
    });
    await processStripeWebhookEvent(event);

    const invoice = await prisma.invoice.findUnique({
      where: { stripeInvoiceId: "in_fake_failed_1" },
      include: { payments: true, lineItems: true, taxLines: true },
    });
    expect(invoice?.status).toBe("DELINQUENT");
    expect(invoice?.payments[0]?.status).toBe("failed");
    expect(invoice?.payments[0]?.receiptId).toBeNull();
    expect(invoice?.lineItems.filter((item) => item.kind === "RENTAL")).toHaveLength(1);
    expect(invoice?.lineItems.filter((item) => item.kind === "TAX")).toHaveLength(1);
    expect(invoice?.taxLines).toEqual([
      expect.objectContaining({
        jurisdictionId: taxFixture.jurisdictionId,
        rateVersionId: taxFixture.rateVersionId,
        taxableCents: 4000,
        taxCents: 292,
        source: "STRIPE",
      }),
    ]);
    expect(await prisma.receipt.count({ where: { customerId } })).toBe(receiptsBefore);
    expect(await prisma.deposit.count({ where: { agreementId } })).toBe(1);
  });

  it("invoice.paid for the same Stripe invoice after failure updates it to PAID", async () => {
    fakeInvoicesById.in_fake_failed_1 = {
      ...fakeInvoicesById.in_fake_failed_1,
      status: "paid",
      amount_paid: 4292,
      payments: {
        data: [
          {
            payment: {
              type: "payment_intent",
              payment_intent: "pi_fake_failed_retry",
            },
          },
        ],
      },
      lines: {
        data: [
          {
            description: "Washer",
            amount: 4000,
            taxes: [
              {
                amount: 292,
                taxable_amount: 4000,
                tax_rate_details: { tax_rate: STRIPE_TAX_RATE_ID },
              },
            ],
          },
        ],
      },
    };
    const event = fakeEvent("evt_failed_1_recovered", "invoice.paid", {
      id: "in_fake_failed_1",
      parent: { subscription_details: { subscription: "sub_fake_1" } },
    });
    await processStripeWebhookEvent(event);

    const invoice = await prisma.invoice.findUnique({
      where: { stripeInvoiceId: "in_fake_failed_1" },
      include: { payments: true, lineItems: true, taxLines: true },
    });
    expect(invoice?.status).toBe("PAID");
    expect(invoice?.amountPaidCents).toBe(4292);
    expect(invoice?.lineItems.filter((item) => item.kind === "RENTAL")).toHaveLength(1);
    expect(invoice?.lineItems.filter((item) => item.kind === "TAX")).toHaveLength(1);
    expect(invoice?.taxLines).toHaveLength(1);
    expect(invoice?.payments).toHaveLength(2);
    expect(invoice?.payments.some((payment) => payment.status === "failed")).toBe(true);
    expect(invoice?.payments.some((payment) => payment.status === "succeeded")).toBe(true);
    expect(invoice?.payments.find((payment) => payment.status === "succeeded")?.receiptId).not.toBeNull();
    expect(
      await prisma.invoice.count({ where: { stripeInvoiceId: "in_fake_failed_1" } }),
    ).toBe(1);
  });
});

describe("pending ACH invoice settlement", () => {
  it("records nothing while Stripe still shows the invoice open", async () => {
    const event = fakeEvent("evt_ach_checkout", "checkout.session.completed", {
      mode: "subscription",
      invoice: "in_fake_ach_pending",
      metadata: { agreementId },
    });
    await processStripeWebhookEvent(event);
    expect(
      await prisma.invoice.findUnique({
        where: { stripeInvoiceId: "in_fake_ach_pending" },
      }),
    ).toBeNull();
  });

  it("records it once invoice.paid arrives", async () => {
    fakeInvoicesById.in_fake_ach_pending = {
      ...fakeInvoicesById.in_fake_ach_pending,
      status: "paid",
      amount_paid: 4292,
    };
    const event = fakeEvent("evt_ach_paid", "invoice.paid", {
      id: "in_fake_ach_pending",
      parent: { subscription_details: { subscription: "sub_fake_1" } },
    });
    await processStripeWebhookEvent(event);
    const invoice = await prisma.invoice.findUnique({
      where: { stripeInvoiceId: "in_fake_ach_pending" },
      include: { payments: true },
    });
    expect(invoice?.status).toBe("PAID");
    expect(invoice?.amountPaidCents).toBe(4292);
    expect(invoice?.payments[0]?.receiptId).not.toBeNull();
  });
});

describe("checkout.session.completed — setup mode", () => {
  it("saves the payment method for later billing without creating an invoice", async () => {
    const event = fakeEvent("evt_setup_1", "checkout.session.completed", {
      mode: "setup",
      setup_intent: "seti_fake_1",
      metadata: { agreementId },
    });
    await processStripeWebhookEvent(event);
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
    });
    expect(customer.stripeDefaultPaymentMethodId).toBe("pm_from_seti_fake_1");
    expect(
      await prisma.invoice.findMany({
        where: { agreementId, amountPaidCents: 0 },
      }),
    ).toHaveLength(0);
  });
});

describe("checkout.session.completed — payment mode", () => {
  it("captures payment method but records no charge while payment_status is unpaid", async () => {
    const event = fakeEvent("evt_payment_pending", "checkout.session.completed", {
      mode: "payment",
      payment_intent: "pi_fake_pending",
      payment_status: "unpaid",
      metadata: { agreementId },
    });
    await processStripeWebhookEvent(event);
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
    });
    expect(customer.stripeDefaultPaymentMethodId).toBe("pm_from_pi_fake_pending");
    expect(
      await prisma.invoice.findFirst({
        where: {
          agreementId,
          payments: {
            some: { stripePaymentIntentId: "pi_fake_pending" },
          },
        },
      }),
    ).toBeNull();
  });

  it("records the paid signing deposit through one receipt allocation", async () => {
    const event = fakeEvent("evt_payment_paid", "checkout.session.completed", {
      mode: "payment",
      payment_intent: "pi_fake_paid_signing",
      payment_status: "paid",
      metadata: { agreementId },
    });
    await processStripeWebhookEvent(event);
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
    });
    expect(customer.stripeDefaultPaymentMethodId).toBe("pm_from_pi_fake_paid_signing");
    const invoice = await prisma.invoice.findFirst({
      where: {
        agreementId,
        payments: {
          some: { stripePaymentIntentId: "pi_fake_paid_signing" },
        },
      },
      include: { lineItems: true, payments: true },
    });
    expect(invoice).not.toBeNull();
    expect(invoice!.status).toBe("PAID");
    expect(invoice!.amountPaidCents).toBe(15000);
    expect(invoice!.lineItems).toHaveLength(1);
    expect(invoice!.lineItems[0].kind).toBe("DEPOSIT");
    expect(invoice!.payments[0].status).toBe("succeeded");
    expect(invoice!.payments[0].receiptId).not.toBeNull();
  });
});

describe("checkout.session.async_payment_succeeded / _failed", () => {
  it("async success records a delayed signing debit once", async () => {
    const event = fakeEvent(
      "evt_async_succeeded",
      "checkout.session.async_payment_succeeded",
      {
        payment_intent: "pi_fake_ach_signing",
        metadata: { agreementId },
      },
    );
    await processStripeWebhookEvent(event);
    const invoice = await prisma.invoice.findFirst({
      where: {
        agreementId,
        payments: {
          some: { stripePaymentIntentId: "pi_fake_ach_signing" },
        },
      },
      include: { lineItems: true, payments: true },
    });
    expect(invoice?.status).toBe("PAID");
    expect(invoice?.lineItems[0]?.kind).toBe("DEPOSIT");
    expect(invoice?.payments[0]?.receiptId).not.toBeNull();
  });

  it("async failure records no cash, only an audit trail", async () => {
    const event = fakeEvent(
      "evt_async_failed",
      "checkout.session.async_payment_failed",
      {
        payment_intent: "pi_fake_ach_signing_failed",
        metadata: { agreementId },
      },
    );
    await processStripeWebhookEvent(event);
    expect(
      await prisma.invoice.findFirst({
        where: {
          agreementId,
          payments: {
            some: { stripePaymentIntentId: "pi_fake_ach_signing_failed" },
          },
        },
      }),
    ).toBeNull();
    expect(
      await prisma.auditLog.findFirst({
        where: {
          entityId: agreementId,
          action: "billing.signing_payment_failed",
        },
      }),
    ).not.toBeNull();
  });
});
