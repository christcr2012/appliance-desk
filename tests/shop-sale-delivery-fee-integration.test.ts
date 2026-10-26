import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createShopSale, cancelShopSale, returnShopSale } from "@/domains/sales";
import { recordManualPayment } from "@/domains/billing";
import { resolvePendingRdfRecords } from "@/domains/tax/rdf-records";
import { processReadyRdfCharges } from "@/domains/tax/rdf-charges";
import { recordedRetailSales } from "@/domains/tax/rdf-sales-evidence";
import { approveRdfSwitch } from "@/domains/tax/rdf-switches";
import { rdfHandlingLockedSince } from "@/domains/tax/rdf-handling-lock";
import { saveTaxPolicyChoiceInTx } from "@/domains/tax/policy-choices";
import { saveTaxSettings } from "@/domains/tax/setup";
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
  let ruleVersionId: string | null = null;
  let thresholdRuleVersionId: string | null = null;
  const created = new Set<string>();
  const today = () => businessDateFromKey(businessDateKey(new Date()))!;
  const settings = (data: Record<string, unknown>) => prisma.businessSettings.update({ where: { id: "singleton" }, data });
  // TFA-1: the fee amount is a dated OWNER rule version (37 cents from
  // today), not a RetailDeliveryFeeRate row.
  const addRate = async () => {
    ruleVersionId = (await prisma.legalRuleVersion.create({ data: {
      id: `rdfs-rule-${tag}`, ruleKey: "co.rdf.amount", value: 37,
      effectiveFrom: today(), origin: "OWNER", provisional: false,
      createdByUserId: ownerId,
    } })).id;
  };
  const purge = async () => {
    const recs = await prisma.retailDeliveryFeeRecord.findMany({ where: { invoiceId: { in: [...created] } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityType: "RetailDeliveryFeeRecord", entityId: { in: recs.map((r) => r.id) } } });
    await prisma.retailDeliveryFeeRecord.deleteMany({ where: { id: { in: recs.map((r) => r.id) } } });
  };
  const dropRate = async () => { await purge(); if (ruleVersionId) await prisma.legalRuleVersion.delete({ where: { id: ruleVersionId } }); ruleVersionId = null; };
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
    await settings({ shortTermLeaseElection: "COLLECT_ON_RENTALS", rdfThresholdCrossedOn: new Date("2020-01-01T12:00:00Z"), rdfHandling: "COLLECT_FROM_CUSTOMER", rdfCpaConfirmedOn: new Date("2026-01-01T12:00:00Z") });
    // TFA-1: the small-seller limit is a dated rule. The seeded rule is
    // 50,000,000 cents; a zero OWNER version makes every sale exceed it, so
    // the fee applies (the 2020 crossing date above covers the grace period).
    thresholdRuleVersionId = (await prisma.legalRuleVersion.create({ data: {
      id: `rdfs-threshold-${tag}`, ruleKey: "co.rdf.qualified_threshold", value: 0,
      effectiveFrom: businessDateFromKey("2026-01-01")!, origin: "OWNER",
      provisional: false, createdByUserId: ownerId,
    } })).id;
    process.env.RDF_CUSTOMER_CHARGING_ENABLED = "true";
    await addRate();
    // One counted pickup sale so current-year Colorado retail sales are above the (zero) test threshold.
    await sell(await part(), null);
  });

  afterAll(async () => {
    delete process.env.RDF_CUSTOMER_CHARGING_ENABLED;
    await dropRate();
    if (thresholdRuleVersionId) await prisma.legalRuleVersion.delete({ where: { id: thresholdRuleVersionId } });
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
    expect(line).toMatchObject({ kind: "RETAIL_DELIVERY_FEE", amountCents: 37, description: "Retail delivery fees", invoiceId: sale.invoiceId });
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

  it("taking a paid sale back keeps the delivery fee (it is still owed) and refunds the rest; cancelling an unpaid sale voids the fee", async () => {
    const sale = await sell(await part(), coAddress);
    await recordManualPayment(customerId, ownerId, { amountCents: sale.amountDueCents, method: "cash", invoiceId: sale.invoiceId, refuseOverpayment: true });
    const back = await returnShopSale(ownerId, sale.invoiceId, "Changed mind");
    // TFA-2 §6.5: $54.37 paid, the $0.37 fee is kept, $54.00 comes back.
    expect(back.refundedCents).toBe(5400);
    const [record] = await records(sale.invoiceId);
    expect(record).toMatchObject({ status: "READY", amountCents: 37, collectedFromCustomer: true, customerRefundRef: null });
    expect(record!.customerRefundedAt).toBeNull();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "sale.return", entityType: "Invoice", entityId: sale.invoiceId } });
    expect((audit.newValue as { deliveryFeeKeptCents?: number }).deliveryFeeKeptCents).toBe(37);
    expect(await returnShopSale(ownerId, sale.invoiceId, "Changed mind")).toMatchObject({ alreadyReturned: true });

    const unpaid = await sell(await part(), coAddress);
    await cancelShopSale(ownerId, unpaid.invoiceId, "Customer cancelled");
    expect((await records(unpaid.invoiceId))[0]).toMatchObject({ status: "NOT_DUE", collectedFromCustomer: false, customerRefundRef: null });
  });

  it("a replacement sale (an exchange) gets no second delivery fee", async () => {
    const original = await sell(await part(), coAddress);
    const replacement = await createShopSale(ownerId, {
      operationKey: key(), customerId, location: "DELIVERED", serviceAddressId: coAddress,
      items: [{ partRecordId: await part(), quantity: 1, unitPriceCents: 5000 }],
      replacementOfInvoiceId: original.invoiceId,
    });
    created.add(replacement.invoiceId);
    expect(replacement.amountDueCents).toBe(5400);
    expect((await records(replacement.invoiceId))[0]).toMatchObject({ status: "NOT_DUE", amountCents: null });
    expect(await prisma.invoiceLineItem.findMany({
      where: { invoiceId: replacement.invoiceId, kind: "RETAIL_DELIVERY_FEE" },
    })).toHaveLength(0);
    // A replacement pointing at a sale that is not this customer's is refused.
    await expect(createShopSale(ownerId, {
      operationKey: key(), customerId, location: "DELIVERED", serviceAddressId: coAddress,
      items: [{ partRecordId: await part(), quantity: 1, unitPriceCents: 5000 }],
      replacementOfInvoiceId: `rdfs-missing-${tag}`,
    })).rejects.toThrow(/Couldn't find the sale this one replaces/);
  });

  it("an unapproved switch holds the customer line (owed, not billed) until the owner approves it", async () => {
    const sw = await prisma.retailDeliveryFeeSwitch.create({
      data: { kind: "START", startsOn: today() },
    });
    try {
      const held = await sell(await part(), coAddress);
      expect(held.amountDueCents).toBe(5400);
      expect((await records(held.invoiceId))[0]).toMatchObject({ status: "READY", amountCents: 37, collectedFromCustomer: false, invoiceLineId: null });

      await approveRdfSwitch(ownerId, sw.id);
      const charged = await sell(await part(), coAddress);
      expect(charged.amountDueCents).toBe(5437);
      expect((await records(charged.invoiceId))[0]).toMatchObject({ status: "READY", amountCents: 37, collectedFromCustomer: true });
    } finally {
      await prisma.retailDeliveryFeeSwitch.delete({ where: { id: sw.id } });
    }
  });

  it("once the fee applies to a sale, who pays it is locked on both save paths", async () => {
    const lockedSince = await prisma.$transaction((tx) => rdfHandlingLockedSince(tx));
    expect(lockedSince).toBeInstanceOf(Date);
    await expect(prisma.$transaction((tx) =>
      saveTaxPolicyChoiceInTx(tx, ownerId, "rdfHandling", "PAY_MYSELF"),
    )).rejects.toThrow(/can't change now/);
    const current = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { updatedAt: true, shortTermLeaseElection: true, shortTermLeaseElectionNote: true, rdfHandling: true, rdfCpaConfirmedOn: true, autoApplyOfficialRateChanges: true, autoRateChangeMaxMilliPercent: true },
    });
    await expect(saveTaxSettings(ownerId, {
      shortTermLeaseElection: current.shortTermLeaseElection,
      shortTermLeaseElectionNote: current.shortTermLeaseElectionNote,
      rdfHandling: "PAY_MYSELF",
      rdfThresholdCents: 0,
      rdfCpaConfirmedOn: current.rdfCpaConfirmedOn,
      autoApplyOfficialRateChanges: current.autoApplyOfficialRateChanges,
      autoRateChangeMaxMilliPercent: current.autoRateChangeMaxMilliPercent,
      businessLocation: null,
    }, current.updatedAt)).rejects.toThrow(/can't change now/);
    // Saving the SAME choice is not a change and still works.
    await prisma.$transaction((tx) => saveTaxPolicyChoiceInTx(tx, ownerId, "rdfHandling", "COLLECT_FROM_CUSTOMER"));
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
    // TFA-1: the seeded amount versions cover every 2026 sale, so "no fee
    // amount entered" means hiding them for this sale. They are restored in
    // the finally below; this file runs in the serial shared-settings project.
    const hidden = await prisma.legalRuleVersion.findMany({
      where: { ruleKey: "co.rdf.amount", undoneAt: null },
      select: { id: true },
    });
    try {
      await prisma.legalRuleVersion.updateMany({
        where: { id: { in: hidden.map((r) => r.id) } },
        data: { undoneAt: new Date() },
      });
      const sale = await sell(await part(), coAddress);
      expect(sale.amountDueCents).toBe(5400);
      expect((await records(sale.invoiceId))[0]).toMatchObject({ status: "PENDING_RATE", amountCents: null, invoiceLineId: null });
      await addRate();
      await resolvePendingRdfRecords(new Date(), 100);
      expect((await records(sale.invoiceId))[0]).toMatchObject({ status: "READY", amountCents: 37, collectedFromCustomer: false, invoiceLineId: null });
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: sale.invoiceId } })).amountDueCents).toBe(5400);
    } finally {
      await prisma.legalRuleVersion.updateMany({
        where: { id: { in: hidden.map((r) => r.id) } },
        data: { undoneAt: null },
      });
    }
  });
});
