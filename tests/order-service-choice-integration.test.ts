import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { businessDateFromKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import {
  computeServiceChoiceOffers,
  readServiceChoicesForOrder,
  recordServiceChoicesInTx,
} from "@/domains/orders/service-choices";
import { recalculateLocalInvoiceTax } from "@/domains/tax/local-invoice";
import { seedTaxReadyContext } from "./helpers/tax-ready";

// FEETAX-1 (S6): the choice records save with the order, the bill's tax
// follows them, and one customer's choices never surface on another's
// order. Real Postgres, throwaway rows only.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("FEETAX-1 order service choices (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `osc-owner-${tag}`;
  const userA = `osc-user-a-${tag}`;
  const userB = `osc-user-b-${tag}`;
  const customerA = `osc-customer-a-${tag}`;
  const customerB = `osc-customer-b-${tag}`;
  const addressA = `osc-address-a-${tag}`;
  const orderA = `osc-order-a-${tag}`;
  const orderB = `osc-order-b-${tag}`;
  const agreementId = `osc-agreement-${tag}`;
  let taxFixture: Awaited<ReturnType<typeof seedTaxReadyContext>>;

  const offers = computeServiceChoiceOffers({
    deliveryPriceCents: 7500,
    pickupOnly: false,
    installationFeeCents: 4000,
    removalFeeCents: 0,
    haulAwayFeeCents: 2500,
    categories: ["WASHER", "DRYER_ELECTRIC"],
    selfInstallAllowedCategories: ["WASHER", "DRYER_ELECTRIC", "FRIDGE", "FREEZER"],
  });

  async function makeInvoice(): Promise<string> {
    const invoice = await prisma.invoice.create({
      data: {
        customerId: customerA,
        agreementId,
        status: "DRAFT",
        subtotalCents: 7500,
        taxCents: 0,
        amountDueCents: 7500,
        billingPeriodStart: businessDateFromKey("2026-10-01"),
        dueDate: businessDateFromKey("2026-10-01"),
        lineItems: {
          create: {
            kind: "DELIVERY_FEE",
            description: "Delivery",
            amountCents: 7500,
            quantity: 1,
          },
        },
      },
    });
    return invoice.id;
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-owner@example.test`, name: "OSC Owner", role: "OWNER", emailVerified: true },
        { id: userA, email: `${tag}-a@example.test`, name: "OSC A", role: "CUSTOMER", emailVerified: true },
        { id: userB, email: `${tag}-b@example.test`, name: "OSC B", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.createMany({
      data: [
        { id: customerA, userId: userA, referralCode: `OA${tag.slice(0, 16)}` },
        { id: customerB, userId: userB, referralCode: `OB${tag.slice(0, 16)}` },
      ],
    });
    await prisma.serviceAddress.create({
      data: { id: addressA, customerId: customerA, line1: "100 Test Ave", city: "Greeley", zip: "80631" },
    });
    await prisma.estimate.createMany({
      data: [
        { id: orderA, customerId: customerA, title: "OSC order A", deliveryOffer: [], createdByUserId: ownerId },
        { id: orderB, customerId: customerB, title: "OSC order B", deliveryOffer: [], createdByUserId: ownerId },
      ],
    });
    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId: customerA,
        serviceAddressId: addressA,
        sourceEstimateId: orderA,
        status: "ACTIVE",
        termMonths: 12,
        billingStartedAt: businessDateFromKey("2026-10-01"),
        lines: { create: { label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 } },
      },
    });
    // 10% rate; every category TAXABLE, and DELIVERY carries the
    // optional-and-separate answer EXEMPT.
    taxFixture = await seedTaxReadyContext(addressA, { rateMilliPercent: 10_000 });
    await prisma.taxabilityRule.update({
      where: { jurisdictionId_category: { jurisdictionId: taxFixture.jurisdictionId, category: "DELIVERY" } },
      data: { optionalSeparatedTreatment: "EXEMPT" },
    });
  });

  afterAll(async () => {
    await prisma.orderServiceChoice.deleteMany({ where: { orderId: { in: [orderA, orderB] } } });
    const invoices = await prisma.invoice.findMany({ where: { agreementId }, select: { id: true } });
    await prisma.invoiceTaxLine.deleteMany({ where: { invoiceId: { in: invoices.map((row) => row.id) } } });
    await prisma.invoice.deleteMany({ where: { agreementId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.estimate.deleteMany({ where: { id: { in: [orderA, orderB] } } });
    // The tax fixture's own cleanup removes the address's tax locations
    // and jurisdiction; it must run before the address itself goes.
    if (taxFixture) await taxFixture.cleanup();
    await prisma.serviceAddress.deleteMany({ where: { id: addressA } });
    await prisma.customer.deleteMany({ where: { id: { in: [customerA, customerB] } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [ownerId, userA, userB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, userA, userB] } } });
  });

  it("saves the choices with the order, with the server's prices, under the order transaction", async () => {
    const recorded = await prisma.$transaction((tx) =>
      recordServiceChoicesInTx(tx, {
        orderId: orderA,
        quoteVersion: 3,
        offers,
        selections: [
          { service: "DELIVERY", choice: "BY_BUSINESS" },
          { service: "INSTALLATION", choice: "CUSTOMER_DOES_IT" },
          { service: "HAUL_AWAY", choice: "NOT_NEEDED" },
        ],
        pickupOnly: false,
      }),
    );
    expect(recorded).toHaveLength(4); // REMOVAL defaulted to BY_BUSINESS.
    const rows = await prisma.orderServiceChoice.findMany({
      where: { orderId: orderA },
      orderBy: { service: "asc" },
    });
    // Rows come back in the enum's declared order, not alphabetically.
    expect(rows.map((row) => [row.service, row.choice, row.offeredPriceCents, row.alternativeShown, row.quoteVersion])).toEqual([
      ["DELIVERY", "BY_BUSINESS", 7500, true, 3],
      ["INSTALLATION", "CUSTOMER_DOES_IT", 4000, true, 3],
      ["REMOVAL", "BY_BUSINESS", 0, true, 3],
      ["HAUL_AWAY", "NOT_NEEDED", 2500, true, 3],
    ]);
  });

  it("refuses a do-it-yourself pick the screen never offered", async () => {
    const gasOffers = computeServiceChoiceOffers({
      deliveryPriceCents: 7500,
      pickupOnly: false,
      installationFeeCents: 4000,
      removalFeeCents: 0,
      haulAwayFeeCents: null,
      categories: ["DRYER_GAS"],
      selfInstallAllowedCategories: ["WASHER", "DRYER_ELECTRIC", "FRIDGE", "FREEZER"],
    });
    await expect(
      prisma.$transaction((tx) =>
        recordServiceChoicesInTx(tx, {
          orderId: orderB,
          quoteVersion: 1,
          offers: gasOffers,
          selections: [{ service: "INSTALLATION", choice: "CUSTOMER_DOES_IT" }],
          pickupOnly: false,
        }),
      ),
    ).rejects.toThrow(/no do-it-yourself option/);
    expect(await prisma.orderServiceChoice.count({ where: { orderId: orderB } })).toBe(0);
  });

  it("bills the delivery line untaxed only on proven optional choices", async () => {
    // A fresh draft invoice per case — recalculating settles the tax
    // state, so an invoice can only be recalculated once.
    // Proven optional (the first test's record): no tax on delivery.
    expect(await recalculateLocalInvoiceTax(ownerId, await makeInvoice())).toEqual({ ok: true, totalTaxCents: 0 });
    // Same order, but the alternative was never shown: taxed at 10%.
    await prisma.orderServiceChoice.update({
      where: { orderId_service: { orderId: orderA, service: "DELIVERY" } },
      data: { alternativeShown: false },
    });
    expect(await recalculateLocalInvoiceTax(ownerId, await makeInvoice())).toEqual({ ok: true, totalTaxCents: 750 });
    // No records at all (an old order): taxed, exactly as before this card.
    await prisma.orderServiceChoice.deleteMany({ where: { orderId: orderA } });
    expect(await recalculateLocalInvoiceTax(ownerId, await makeInvoice())).toEqual({ ok: true, totalTaxCents: 750 });
  });

  it("keeps each customer's choices on their own order", async () => {
    await prisma.$transaction((tx) =>
      recordServiceChoicesInTx(tx, {
        orderId: orderB,
        quoteVersion: 1,
        offers,
        selections: [{ service: "DELIVERY", choice: "CUSTOMER_DOES_IT" }],
        pickupOnly: false,
      }),
    );
    const forA = await readServiceChoicesForOrder(prisma, orderA);
    const forB = await readServiceChoicesForOrder(prisma, orderB);
    expect(forA.size).toBe(0);
    expect(forB.get("DELIVERY")?.choice).toBe("CUSTOMER_DOES_IT");
    expect(forB.get("INSTALLATION")?.choice).toBe("BY_BUSINESS");
  });
});
