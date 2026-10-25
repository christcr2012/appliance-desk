import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createShopSale, cancelShopSale, returnShopSale } from "@/domains/sales";
import { recordManualPayment } from "@/domains/billing";
import { resolvePendingRdfRecords } from "@/domains/tax/rdf-records";
import { processReadyRdfCharges } from "@/domains/tax/rdf-charges";
import { recordedRetailSales } from "@/domains/tax/rdf-sales-evidence";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { seedTaxReadyContext } from "./helpers/tax-ready";

// Batch M M-1C: Colorado's retail delivery fee on a delivered shop sale (goods, not rentals).
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";
const key = () => `rdfsale-${randomUUID()}`;

describe.skipIf(!enabled)("delivery fee on delivered shop sales (real Postgres)", () => {
  const tag = randomUUID().slice(0, 8);
  const userId = `rdfs-user-${tag}`;
  const customerId = `rdfs-cust-${tag}`;
  const coAddress = `rdfs-co-${tag}`;
  const neAddress = `rdfs-ne-${tag}`;
  const accountId = `rdfs-acct-${tag}`;
  let ownerId: string;
  let tax1: Awaited<ReturnType<typeof seedTaxReadyContext>>;
  let originalSettings: Record<string, unknown>;
  let previousShopLocations: string[] = [];
  let rateId: string | null = null;
  const created = new Set<string>();
  const today = () => businessDateFromKey(businessDateKey(new Date()))!;
  const settings = (data: Record<string, unknown>) => prisma.businessSettings.update({ where: { id: "singleton" }, data });
  const addRate = async () => { rateId = (await prisma.retailDeliveryFeeRate.create({ data: { effectiveOn: today(), amountCents: 37, enteredByUserId: ownerId } })).id; };
  const purge = async () => {
    const recs = await prisma.retailDeliveryFeeRecord.findMany({ where: { invoiceId: { in: [...created] } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityType: "RetailDeliveryFeeRecord", entityId: { in: recs.map((r) => r.id) } } });
    await prisma.retailDeliveryFeeRecord.deleteMany({ where: { id: { in: recs.map((r) => r.id) } } });
  };
  const dropRate = async () => { await purge(); if (rateId) await prisma.retailDeliveryFeeRate.delete({ where: { id: rateId } }); rateId = null; };
  const part = async () => (await prisma.partRecord.create({ data: { modelNumber: `RDFS-${tag}-${randomUUID().slice(0, 6)}`, partNumber: tag, partName: "Dryer hose", quantityOnHand: 1000, sellable: true, retailPriceCents: 1000 } })).id;
  const sell = async (partId: string, address: string | null) => {
    const r = await createShopSale(ownerId, address
      ? { operationKey: key(), customerId, location: "DELIVERED", serviceAddressId: address, items: [{ partRecordId: partId, quantity: 1, unitPriceCents: 5000 }] }
      : { operationKey: key(), customerId: null, location: "PICKUP", items: [{ partRecordId: partId, quantity: 1, unitPriceCents: 5000 }] });
    created.add(r.invoiceId);
    return r;
  };
  const records = (invoiceId: string) => prisma.retailDeliveryFeeRecord.findMany({ where: { invoiceId } });

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    originalSettings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { shortTermLeaseElection: true, rdfThresholdCents: true, rdfThresholdCrossedOn: true, rdfHandling: true, rdfCpaConfirmedOn: true } });
    await prisma.user.create({ data: { id: userId, email: `${tag}-rdfs@example.test`, name: "Fee Customer", role: "CUSTOMER", emailVerified: true } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `R${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: coAddress, customerId, line1: "1 Fee Rd", city: "Greeley", state: "CO", zip: "80631" } });
    await prisma.serviceAddress.create({ data: { id: neAddress, customerId, line1: "2 Fee Rd", city: "Kimball", state: "NE", zip: "69145" } });
    tax1 = await seedTaxReadyContext(coAddress, { rateMilliPercent: 8000 });
    await seedTaxReadyContext(neAddress, { rateMilliPercent: 8000 });
    // The Colorado address is taxed by the state; the shop (for the pickup case) is taxed by the same state area.
    await prisma.taxJurisdiction.update({ where: { id: tax1.jurisdictionId }, data: { level: "STATE" } });
    previousShopLocations = (await prisma.addressTaxLocation.findMany({ where: { forBusinessLocation: true, isCurrent: true }, select: { id: true } })).map((r) => r.id);
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: previousShopLocations } }, data: { isCurrent: false } });
    await prisma.addressTaxLocation.create({ data: { id: `rdfs-shop-${tag}`, forBusinessLocation: true, isCurrent: true, status: "VERIFIED", source: "MANUAL", lookedUpAt: new Date(), jurisdictions: { create: [{ jurisdictionId: tax1.jurisdictionId }] } } });
    await prisma.taxFilingAccount.create({ data: { id: accountId, name: `Fee test ${tag}`, kind: "SALES_RETURN", frequency: "MONTHLY", jurisdictions: { connect: { id: tax1.jurisdictionId } } } });
    await settings({ shortTermLeaseElection: "COLLECT_ON_RENTALS", rdfThresholdCents: 0, rdfThresholdCrossedOn: new Date("2020-01-01T12:00:00Z"), rdfHandling: "COLLECT_FROM_CUSTOMER", rdfCpaConfirmedOn: new Date("2026-01-01T12:00:00Z") });
    process.env.RDF_CUSTOMER_CHARGING_ENABLED = "true";
    await addRate();
    // One counted pickup sale so current-year Colorado retail sales are above the (zero) test threshold.
    await sell(await part(), null);
  });

  afterAll(async () => {
    delete process.env.RDF_CUSTOMER_CHARGING_ENABLED;
    await dropRate();
    await prisma.taxFilingAccount.deleteMany({ where: { id: accountId } });
    await prisma.addressTaxLocation.deleteMany({ where: { id: `rdfs-shop-${tag}` } }).catch(() => undefined);
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: previousShopLocations } }, data: { isCurrent: true } });
    await settings(originalSettings);
  });

  it("collects one separate, untaxed fee line on a delivered sale, once, and a retry changes nothing", async () => {
    const p = await part();
    const sale = await sell(p, coAddress);
    // $50.00 goods + $0.37 fee; sales tax (8%) is only on the goods.
    expect(sale).toMatchObject({ subtotalCents: 5037, taxCents: 400, amountDueCents: 5437, replayed: false });
    const [record] = await records(sale.invoiceId);
    expect(record).toMatchObject({ saleKey: `retail:${sale.invoiceId}`, status: "READY", amountCents: 37, collectedFromCustomer: true, agreementId: null, firstJobId: null });
    const line = await prisma.invoiceLineItem.findUniqueOrThrow({ where: { id: record!.invoiceLineId! } });
    expect(line).toMatchObject({ kind: "RETAIL_DELIVERY_FEE", amountCents: 37, description: "Colorado retail delivery fee", invoiceId: sale.invoiceId });
    expect((await prisma.invoiceTaxLine.findMany({ where: { invoiceId: sale.invoiceId, invoiceLineItemId: line.id } }))).toHaveLength(0);

    const again = await createShopSale(ownerId, { operationKey: (await prisma.invoice.findUniqueOrThrow({ where: { id: sale.invoiceId }, select: { saleOperationKey: true } })).saleOperationKey!, customerId, location: "DELIVERED", serviceAddressId: coAddress, items: [{ partRecordId: p, quantity: 1, unitPriceCents: 5000 }] });
    expect(again).toMatchObject({ invoiceId: sale.invoiceId, replayed: true });
    expect(await records(sale.invoiceId)).toHaveLength(1);
    // The rental charger never touches a shop sale's record.
    expect(await processReadyRdfCharges(50)).toMatchObject({ blocked: 0 });
  });

  it("when charging is switched off, or the business pays it, the fee is still counted but nothing is added for the customer", async () => {
    process.env.RDF_CUSTOMER_CHARGING_ENABLED = "false";
    const off = await sell(await part(), coAddress);
    process.env.RDF_CUSTOMER_CHARGING_ENABLED = "true";
    expect(off).toMatchObject({ subtotalCents: 5000, amountDueCents: 5400 });
    expect((await records(off.invoiceId))[0]).toMatchObject({ status: "READY", amountCents: 37, collectedFromCustomer: false, invoiceLineId: null });

    await settings({ rdfHandling: "PAY_MYSELF" });
    const own = await sell(await part(), coAddress);
    await settings({ rdfHandling: "COLLECT_FROM_CUSTOMER" });
    expect(own).toMatchObject({ amountDueCents: 5400 });
    expect((await records(own.invoiceId))[0]).toMatchObject({ status: "READY", collectedFromCustomer: false, invoiceLineId: null });
  });

  it("a pickup, or a delivery outside Colorado, owes no fee", async () => {
    const pickup = await sell(await part(), null);
    expect(await records(pickup.invoiceId)).toHaveLength(0);
    const out = await sell(await part(), neAddress);
    expect(out.amountDueCents).toBe(5400);
    expect((await records(out.invoiceId))[0]).toMatchObject({ status: "NOT_DUE", amountCents: null });
  });

  it("shop sales count as Colorado retail sales (pickup yes, delivery outside Colorado no)", async () => {
    const year = Number(businessDateKey(new Date()).slice(0, 4));
    const total = await prisma.$transaction((tx) => recordedRetailSales(tx, year));
    expect(total).toBeGreaterThanOrEqual(5000);
  });

  it("taking a paid sale back refunds the fee with everything else and the fee stops counting; cancelling an unpaid sale does the same", async () => {
    const sale = await sell(await part(), coAddress);
    await recordManualPayment(customerId, ownerId, { amountCents: sale.amountDueCents, method: "cash", invoiceId: sale.invoiceId, refuseOverpayment: true });
    const back = await returnShopSale(ownerId, sale.invoiceId, "Changed mind");
    expect(back.refundedCents).toBe(5437);
    const refund = await prisma.refund.findFirstOrThrow({ where: { invoiceId: sale.invoiceId } });
    const [record] = await records(sale.invoiceId);
    expect(record).toMatchObject({ status: "NOT_DUE", customerRefundRef: refund.id });
    expect(record!.customerRefundedAt).not.toBeNull();
    expect(await returnShopSale(ownerId, sale.invoiceId, "Changed mind")).toMatchObject({ alreadyReturned: true });

    const unpaid = await sell(await part(), coAddress);
    await cancelShopSale(ownerId, unpaid.invoiceId, "Customer cancelled");
    expect((await records(unpaid.invoiceId))[0]).toMatchObject({ status: "NOT_DUE", collectedFromCustomer: false, customerRefundRef: null });
  });

  it("an exemption certificate revoked earlier the same day no longer hides the fee (checked at the real sale moment)", async () => {
    const exemption = await prisma.customerTaxExemption.create({
      data: { customerId, reason: "RESALE", jurisdictionIds: [tax1.jurisdictionId], validFrom: new Date(Date.now() - 2 * 86_400_000), revokedAt: new Date(Date.now() - 1000), verifiedByUserId: ownerId },
    });
    try {
      const sale = await sell(await part(), coAddress);
      expect((await records(sale.invoiceId))[0]).toMatchObject({ status: "READY", amountCents: 37 });
    } finally {
      await prisma.customerTaxExemption.delete({ where: { id: exemption.id } });
    }
  });

  it("with no fee amount entered the sale still goes through; entering it later finishes the record and the business pays it", async () => {
    await dropRate();
    const sale = await sell(await part(), coAddress);
    expect(sale.amountDueCents).toBe(5400);
    expect((await records(sale.invoiceId))[0]).toMatchObject({ status: "PENDING_RATE", amountCents: null, invoiceLineId: null });
    await addRate();
    await resolvePendingRdfRecords(new Date(), 100);
    expect((await records(sale.invoiceId))[0]).toMatchObject({ status: "READY", amountCents: 37, collectedFromCustomer: false, invoiceLineId: null });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: sale.invoiceId } })).amountDueCents).toBe(5400);
  });
});
