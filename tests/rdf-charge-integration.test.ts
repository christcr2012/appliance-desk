import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  RDF_LINE_DESCRIPTION,
  dispatchRdfCharge,
  prepareRdfChargeInTx,
} from "@/domains/tax/rdf-charges";
import { attachRdfInvoiceLineInTx } from "@/domains/billing/webhooks-base";

const stripeFake = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({ invoiceItems: { create: stripeFake.create } }),
}));

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

type Fixture = Awaited<ReturnType<typeof createFixture>>;
async function createFixture(options: {
  subscription?: boolean;
  payMyself?: boolean;
  status?: "ACTIVE" | "ENDED";
  prepaid?: boolean;
} = {}) {
  const token = randomUUID().replaceAll("-", "");
  const userId = "rdf3-user-" + token;
  const customerId = "rdf3-customer-" + token;
  const addressId = "rdf3-address-" + token;
  const agreementId = "rdf3-agreement-" + token;
  const jobId = "rdf3-job-" + token;
  const recordId = "rdf3-record-" + token;
  const subscriptionId = options.subscription ? "sub_rdf3_" + token : null;
  await prisma.user.create({
    data: {
      id: userId, email: token + "@rdf3.example.test",
      role: "OWNER", passwordHash: "not-a-login", name: "RDF 3 fixture",
    },
  });
  await prisma.customer.create({
    data: {
      id: customerId, userId, referralCode: "RDF3" + token.slice(0, 12),
      stripeCustomerId: options.subscription ? "cus_rdf3_" + token : null,
    },
  });
  await prisma.serviceAddress.create({
    data: {
      id: addressId, customerId, state: "CO",
      city: "Greeley", zip: "80631", line1: "1 Fixture Rd",
    },
  });
  await prisma.rentalAgreement.create({
    data: {
      id: agreementId, customerId, serviceAddressId: addressId,
      status: options.status ?? "ACTIVE",
      stripeSubscriptionId: subscriptionId,
      paidInFullInAdvance: options.prepaid ?? false,
    },
  });
  await prisma.job.create({
    data: {
      id: jobId, type: "DELIVERY", status: "COMPLETED",
      agreementId, customerId, serviceAddressId: addressId,
    },
  });
  const rate = await prisma.retailDeliveryFeeRate.create({
    data: {
      effectiveOn: new Date(Date.UTC(2026, 6, 1) + (parseInt(token.slice(0, 7), 16) % 86_400_000)),
      amountCents: 31, enteredByUserId: userId,
    },
  });
  await prisma.retailDeliveryFeeRecord.create({
    data: {
      rateId: rate.id,
      id: recordId, saleKey: "agreement:" + agreementId,
      firstJobId: jobId, agreementId, status: "READY",
      deliveredOn: new Date("2026-08-03T12:00:00.000Z"),
      saleOn: new Date("2026-08-01T12:00:00.000Z"),
      collectedFromCustomer: !options.payMyself,
      amountCents: 31,
    },
  });
  return {
    token, userId, customerId, addressId, agreementId,
    jobId, recordId, subscriptionId, rateId: rate.id,
  };
}

async function cleanup(fixture: Fixture) {
  const op = await prisma.providerOperation.findUnique({
    where: { idempotencyKey: "rdf-" + fixture.recordId },
    select: { id: true },
  });
  await prisma.retailDeliveryFeeRecord.deleteMany({ where: { id: fixture.recordId } });
  await prisma.providerOperation.deleteMany({
    where: { subjectType: "RetailDeliveryFeeRecord", subjectId: fixture.recordId },
  });
  await prisma.auditLog.deleteMany({
    where: { OR: [
      { entityType: "RetailDeliveryFeeRecord", entityId: fixture.recordId },
      ...(op ? [{ entityType: "ProviderOperation", entityId: op.id }] : []),
    ] },
  });
  await prisma.invoice.deleteMany({ where: { agreementId: fixture.agreementId } });
  await prisma.retailDeliveryFeeRate.delete({ where: { id: fixture.rateId } });
  await prisma.job.deleteMany({ where: { id: fixture.jobId } });
  await prisma.rentalAgreement.delete({ where: { id: fixture.agreementId } });
  await prisma.serviceAddress.delete({ where: { id: fixture.addressId } });
  await prisma.customer.delete({ where: { id: fixture.customerId } });
  await prisma.user.delete({ where: { id: fixture.userId } });
}
async function withFixture(
  options: Parameters<typeof createFixture>[0],
  action: (f: Fixture) => Promise<void>,
) {
  const fixture = await createFixture(options);
  try {
    await action(fixture);
  } finally {
    await cleanup(fixture);
  }
}

describe.skipIf(!enabled)("T-6C3 delivery fee customer charge, real PostgreSQL", () => {
  const previousFlag = process.env.RDF_CUSTOMER_CHARGING_ENABLED;
  beforeEach(() => {
    process.env.RDF_CUSTOMER_CHARGING_ENABLED = "true";
    stripeFake.create.mockReset();
  });
  afterEach(() => {
    if (previousFlag === undefined) delete process.env.RDF_CUSTOMER_CHARGING_ENABLED;
    else process.env.RDF_CUSTOMER_CHARGING_ENABLED = previousFlag;
  });

  it("local line untaxed exactly once, with persisted totals and replay", async () => {
    await withFixture({}, async f => {
      const first = await prisma.$transaction(tx => prepareRdfChargeInTx(tx, f.recordId));
      expect(first.kind).toBe("LOCAL");
      const second = await prisma.$transaction(tx => prepareRdfChargeInTx(tx, f.recordId));
      expect(second.kind).toBe("NONE");
      const invoices = await prisma.invoice.findMany({
        where: { agreementId: f.agreementId },
        include: { lineItems: true },
      });
      expect(invoices).toHaveLength(1);
      expect(invoices[0]).toMatchObject({
        status: "OPEN", subtotalCents: 31, taxCents: 0,
        amountDueCents: 31, amountPaidCents: 0,
      });
      expect(invoices[0]!.lineItems).toEqual([
        expect.objectContaining({
          kind: "RETAIL_DELIVERY_FEE", description: RDF_LINE_DESCRIPTION,
          amountCents: 31,
        }),
      ]);
      const record = await prisma.retailDeliveryFeeRecord.findUniqueOrThrow({
        where: { id: f.recordId },
      });
      expect(record.invoiceLineId).toBe(invoices[0]!.lineItems[0]!.id);
    });
  });

  it("no next bill issues a manual-only standalone invoice for an ended agreement", async () => {
    await withFixture({ status: "ENDED" }, async f => {
      const res = await prisma.$transaction(tx => prepareRdfChargeInTx(tx, f.recordId));
      expect(res.kind).toBe("LOCAL");
      const invoice = await prisma.invoice.findFirstOrThrow({
        where: { agreementId: f.agreementId },
      });
      expect(invoice.stripeInvoiceId).toBeNull();
      expect(invoice.issuedAt).toBeInstanceOf(Date);
      expect(invoice.dueDate).toBeInstanceOf(Date);
      expect(invoice.amountDueCents).toBe(31);
    });
  });

  it("never rewrites paid/final invoices and instead creates a standalone invoice", async () => {
    await withFixture({ prepaid: true }, async f => {
      const old = await prisma.invoice.create({
        data: {
          agreementId: f.agreementId, customerId: f.customerId,
          status: "PAID", amountDueCents: 4000, amountPaidCents: 4000,
          subtotalCents: 4000, issuedAt: new Date("2026-08-01"),
          lineItems: { create: { kind: "RENTAL", description: "Prepaid rental", amountCents: 4000 } },
        },
      });
      await prisma.$transaction(tx => prepareRdfChargeInTx(tx, f.recordId));
      const original = await prisma.invoice.findUniqueOrThrow({
        where: { id: old.id }, include: { lineItems: true },
      });
      expect(original).toMatchObject({ status: "PAID", amountDueCents: 4000, amountPaidCents: 4000 });
      expect(original.lineItems).toHaveLength(1);
      const standalone = await prisma.invoice.findFirstOrThrow({
        where: { agreementId: f.agreementId, id: { not: old.id } },
      });
      expect(standalone.amountDueCents).toBe(31);
    });
  });

  it("provider timeout stays UNKNOWN and does not send a second invoice item", async () => {
    await withFixture({ subscription: true }, async f => {
      const res = await prisma.$transaction(tx => prepareRdfChargeInTx(tx, f.recordId));
      expect(res.kind).toBe("PROVIDER");
      if (res.kind !== "PROVIDER") return;
      stripeFake.create.mockRejectedValue(Object.assign(new Error("provider timeout"), {
        type: "StripeConnectionError",
      }));
      await dispatchRdfCharge(res.operationId);
      await dispatchRdfCharge(res.operationId);
      const op = await prisma.providerOperation.findUniqueOrThrow({
        where: { id: res.operationId },
      });
      expect(op.status).toBe("UNKNOWN");
      expect(op.attempts).toBe(1);
      expect(stripeFake.create).toHaveBeenCalledTimes(1);
    });
  });

  it("callback before response attaches and reconciles the same provider item", async () => {
    await withFixture({ subscription: true }, async f => {
      const res = await prisma.$transaction(tx => prepareRdfChargeInTx(tx, f.recordId));
      expect(res.kind).toBe("PROVIDER");
      if (res.kind !== "PROVIDER") return;
      let resolveProvider: ((val: { id: string }) => void) | undefined;
      let called: (() => void) | undefined;
      const calledPromise = new Promise<void>(resolve => { called = resolve; });
      stripeFake.create.mockImplementation(() => {
        called?.();
        return new Promise(resolve => { resolveProvider = resolve; });
      });
      const dispatch = dispatchRdfCharge(res.operationId);
      await calledPromise;
      const invoice = await prisma.invoice.create({
        data: {
          agreementId: f.agreementId, customerId: f.customerId,
          status: "OPEN", stripeInvoiceId: "in_rdf3_" + f.token,
          subtotalCents: 31, amountDueCents: 31,
        },
      });
      const localLine = await prisma.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id, kind: "RETAIL_DELIVERY_FEE",
          description: RDF_LINE_DESCRIPTION, amountCents: 31,
        },
      });
      const params = stripeFake.create.mock.calls[0]?.[0];
      expect(params.metadata.rdf_record_id).toBe(f.recordId);
      expect(params.tax_rates).toEqual([]);
      const line = {
        description: RDF_LINE_DESCRIPTION, amount: 31,
        metadata: { rdf_record_id: f.recordId },
        parent: { invoice_item_details: { invoice_item: "ii_rdf3_" + f.token } },
      } as unknown as Stripe.InvoiceLineItem;
      await prisma.$transaction(tx => attachRdfInvoiceLineInTx(
        tx, line, localLine.id, f.agreementId, invoice.id,
      ));
      resolveProvider?.({ id: "ii_rdf3_" + f.token });
      await dispatch;
      const [record, op] = await Promise.all([
        prisma.retailDeliveryFeeRecord.findUniqueOrThrow({ where: { id: f.recordId } }),
        prisma.providerOperation.findUniqueOrThrow({ where: { id: res.operationId } }),
      ]);
      expect(record.invoiceLineId).toBe(localLine.id);
      expect(op.status).toBe("SUCCEEDED");
      expect(op.providerObjectId).toBe("ii_rdf3_" + f.token);
      expect(stripeFake.create).toHaveBeenCalledTimes(1);
    });
  });

  it("pay myself never creates a customer line or provider operation", async () => {
    await withFixture({ payMyself: true, subscription: true }, async f => {
      const result = await prisma.$transaction(tx => prepareRdfChargeInTx(tx, f.recordId));
      expect(result.kind).toBe("NONE");
      expect(await prisma.invoice.count({ where: { agreementId: f.agreementId } })).toBe(0);
      expect(await prisma.providerOperation.count({
        where: { subjectId: f.recordId },
      })).toBe(0);
    });
  });

  it("charging remains disabled until separately authorized", async () => {
    await withFixture({}, async f => {
      delete process.env.RDF_CUSTOMER_CHARGING_ENABLED;
      const result = await prisma.$transaction(tx => prepareRdfChargeInTx(tx, f.recordId));
      expect(result.kind).toBe("NONE");
      expect(await prisma.invoice.count({ where: { agreementId: f.agreementId } })).toBe(0);
    });
  });
});

