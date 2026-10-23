import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import {
  createPurchaseOrder, markPurchaseOrderOrdered, receivePurchaseOrderLines, recordPartUsage, reversePartMovement, updatePartSaleSettings,
} from "@/domains/purchasing";
import { applyPartMovementsInTx, findPartLedgerMismatches, resaleEffect, ResaleStockConflictError } from "@/domains/purchasing/ledger";
import { countPendingWithdrawalUseTax, recordPendingWithdrawalUseTax } from "@/domains/purchasing/withdrawal-tax";

const day = (value: string) => businessDateFromKey(value)!;

// Batch M, M-1A/M-1B: which units a movement uses, the moving-average resale cost, and use tax on withdrawals.
describe("resaleEffect (pure rules from design D-M1)", () => {
  const part = (balance: number, resaleUnits: number, resaleCostCents: number) => ({ balance, resaleUnits, resaleCostCents });

  it("a resale receipt adds resale units at cost; an ordinary one adds none", () => {
    expect(resaleEffect("RECEIPT", 4, part(0, 0, 0), { forResale: true, unitCostCents: 500 })).toEqual({ resaleUnits: 4, resaleCostCents: 2000 });
    expect(resaleEffect("RECEIPT", 4, part(0, 0, 0), { forResale: false, unitCostCents: 500 })).toEqual({ resaleUnits: 0, resaleCostCents: 0 });
    expect(resaleEffect("RECEIPT", 2, part(0, 0, 0), { forResale: true, unitCostCents: null })).toEqual({ resaleUnits: 2, resaleCostCents: 0 });
  });

  it("a sale takes resale units first, a use takes ordinary units first", () => {
    // 10 on hand, 4 of them resale at $20 total
    expect(resaleEffect("SALE", -3, part(10, 4, 2000))).toEqual({ resaleUnits: -3, resaleCostCents: -1500 });
    expect(resaleEffect("SALE", -6, part(10, 4, 2000))).toEqual({ resaleUnits: -4, resaleCostCents: -2000 });
    expect(resaleEffect("USAGE", -6, part(10, 4, 2000))).toEqual({ resaleUnits: 0, resaleCostCents: 0 });
    expect(resaleEffect("USAGE", -8, part(10, 4, 2000))).toEqual({ resaleUnits: -2, resaleCostCents: -1000 });
    expect(resaleEffect("ADJUSTMENT", -10, part(10, 4, 2000))).toEqual({ resaleUnits: -4, resaleCostCents: -2000 });
    expect(resaleEffect("RECOUNT", -7, part(10, 4, 2000))).toEqual({ resaleUnits: -1, resaleCostCents: -500 });
  });

  it("increases and salvage add ordinary units only", () => {
    expect(resaleEffect("ADJUSTMENT", 3, part(10, 4, 2000))).toEqual({ resaleUnits: 0, resaleCostCents: 0 });
    expect(resaleEffect("SALVAGE", 3, part(10, 4, 2000))).toEqual({ resaleUnits: 0, resaleCostCents: 0 });
  });

  it("rounds the average half up and the last units take exactly what remains", () => {
    // 3 units for 100 cents: one unit is 33.33 -> 33; two are 66.67 -> 67; all three take the full 100
    expect(resaleEffect("SALE", -1, part(3, 3, 100)).resaleCostCents).toBe(-33);
    expect(resaleEffect("SALE", -2, part(3, 3, 100)).resaleCostCents).toBe(-67);
    expect(resaleEffect("SALE", -3, part(3, 3, 100)).resaleCostCents).toBe(-100);
    // 2 units for 5 cents: one unit is 2.5 -> 3
    expect(resaleEffect("SALE", -1, part(2, 2, 5)).resaleCostCents).toBe(-3);
  });
});

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";
const key = () => `resale-${randomUUID()}`;

describe.skipIf(!enabled)("resale stock on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  const newPart = async () =>
    (await prisma.partRecord.create({ data: { modelNumber: `RS-${tag}-${randomUUID()}`, partNumber: tag, partName: "Resale fixture", quantityOnHand: 0 } })).id;
  const part = (id: string) => prisma.partRecord.findUniqueOrThrow({ where: { id } });

  async function receive(ownerId: string, supplierId: string, partRecordId: string, quantity: number, unitCostCents: number, forResale: boolean) {
    const po = await createPurchaseOrder(ownerId, { supplierId, lines: [{ partRecordId, description: "Fixture", quantity, unitCostCents, forResale }] });
    await markPurchaseOrderOrdered(ownerId, po.id);
    const line = await prisma.purchaseOrderLineItem.findFirstOrThrow({ where: { purchaseOrderId: po.id } });
    expect(line.forResale).toBe(forResale);
    await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey: key(), lines: [{ lineId: line.id, quantity, unitCostCents: null }] });
    return line.id;
  }

  it("keeps resale units and cost true through receipts, sales, uses, undo and retries; the $5/$10 example owes tax on $10", async () => {
    const jurisdictionId = "rs-jur-" + tag;
    const accountId = "rs-acct-" + tag;
    const locationId = "rs-loc-" + tag;
    const ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    const supplierId = (await prisma.supplier.create({ data: { name: `Resale ${tag}` } })).id;
    const existing = await prisma.addressTaxLocation.findMany({ where: { forBusinessLocation: true, isCurrent: true }, select: { id: true } });
    const settings = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { shortTermLeaseElection: true } });
    const partId = await newPart();
    try {
      // Tax setup is NOT ready yet: using resale stock still changes stock and waits for the daily catch-up.
      await prisma.businessSettings.upsert({ where: { id: "singleton" }, create: { shortTermLeaseElection: "PAY_ON_ACQUISITION" }, update: { shortTermLeaseElection: "PAY_ON_ACQUISITION" } });
      await prisma.addressTaxLocation.updateMany({ where: { id: { in: existing.map((x) => x.id) } }, data: { isCurrent: false } });

      // A $5 batch bought for resale, then sold out entirely.
      await receive(ownerId, supplierId, partId, 2, 500, true);
      expect(await part(partId)).toMatchObject({ quantityOnHand: 2, resaleUnitsOnHand: 2, resaleCostOnHandCents: 1000 });
      await prisma.$transaction((tx) => applyPartMovementsInTx(tx, ownerId, key(), [{ partRecordId: partId, kind: "SALE", quantityDelta: -2, unitCostCents: null }]));
      expect(await part(partId)).toMatchObject({ quantityOnHand: 0, resaleUnitsOnHand: 0, resaleCostOnHandCents: 0 });

      // A $10 batch bought for resale; using one is a withdrawal worth exactly $10, not $7.50.
      await receive(ownerId, supplierId, partId, 3, 1000, true);
      const retryKey = key();
      await recordPartUsage(ownerId, partId, 1, { operationKey: retryKey });
      await recordPartUsage(ownerId, partId, 1, { operationKey: retryKey }); // retry: no second effect
      const used = await prisma.partStockMovement.findFirstOrThrow({ where: { partRecordId: partId, kind: "USAGE" } });
      expect(used).toMatchObject({ resaleUnits: -1, resaleCostCents: -1000 });
      expect(await part(partId)).toMatchObject({ quantityOnHand: 2, resaleUnitsOnHand: 2, resaleCostOnHandCents: 2000 });
      expect(await prisma.purchaseUseTax.count({ where: { sourceType: "PART_WITHDRAWAL", sourceId: used.id } })).toBe(0);
      expect((await countPendingWithdrawalUseTax()).count).toBeGreaterThanOrEqual(1);

      // Tax setup becomes ready: the catch-up records the tax on $10.
      await prisma.taxFilingAccount.create({ data: { id: accountId, name: "Resale test " + tag, kind: "USE_TAX_RETURN", basis: "ACCRUAL" } });
      await prisma.taxJurisdiction.create({ data: { id: jurisdictionId, code: "RS-" + tag, name: "Resale City", level: "CITY", administration: "SELF_COLLECTED", reviewStatus: "REVIEWED", useTaxFilingAccountId: accountId } });
      await prisma.taxRateVersion.create({ data: { jurisdictionId, rateMilliPercent: 5000, effectiveFrom: day("2026-01-01"), source: "MANUAL" } });
      await prisma.addressTaxLocation.create({ data: { id: locationId, forBusinessLocation: true, isCurrent: true, status: "VERIFIED", source: "MANUAL", lookedUpAt: day("2026-09-01"), jurisdictions: { create: [{ jurisdictionId }] } } });
      const swept = await recordPendingWithdrawalUseTax(200);
      expect(swept.recorded).toBeGreaterThanOrEqual(1);
      const rows = await prisma.purchaseUseTax.findMany({ where: { sourceType: "PART_WITHDRAWAL", sourceId: used.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ purchaseAmountCents: 1000, vendorTaxCents: 0, useTaxDueCents: 50, status: "DUE" });

      // Undoing the use puts back exactly the resale unit and cost, and cancels the tax.
      await reversePartMovement(ownerId, used.id, key());
      expect(await part(partId)).toMatchObject({ quantityOnHand: 3, resaleUnitsOnHand: 3, resaleCostOnHandCents: 3000 });
      expect(await prisma.purchaseUseTax.findFirstOrThrow({ where: { sourceType: "PART_WITHDRAWAL", sourceId: used.id } })).toMatchObject({ useTaxDueCents: 0, status: "NOT_DUE" });

      // Using a unit while ordinary stock is also on hand takes the ordinary one first: no use tax.
      await receive(ownerId, supplierId, partId, 2, 700, false);
      await recordPartUsage(ownerId, partId, 2, { operationKey: key() });
      expect(await part(partId)).toMatchObject({ quantityOnHand: 3, resaleUnitsOnHand: 3, resaleCostOnHandCents: 3000 });
      const ordinary = await prisma.partStockMovement.findFirstOrThrow({ where: { partRecordId: partId, kind: "USAGE", resaleUnits: 0 } });
      expect(await prisma.purchaseUseTax.count({ where: { sourceType: "PART_WITHDRAWAL", sourceId: ordinary.id } })).toBe(0);

      // A sale never owes use tax, and takes resale units.
      await prisma.$transaction((tx) => applyPartMovementsInTx(tx, ownerId, key(), [{ partRecordId: partId, kind: "SALE", quantityDelta: -1, unitCostCents: null }]));
      const sale = await prisma.partStockMovement.findFirstOrThrow({ where: { partRecordId: partId, kind: "SALE", resaleCostCents: -1000 } });
      expect(await prisma.purchaseUseTax.count({ where: { sourceType: "PART_WITHDRAWAL", sourceId: sale.id } })).toBe(0);
      expect(await part(partId)).toMatchObject({ quantityOnHand: 2, resaleUnitsOnHand: 2, resaleCostOnHandCents: 2000 });

      expect(await findPartLedgerMismatches(prisma, [partId])).toEqual([]);
    } finally {
      await prisma.purchaseUseTax.deleteMany({ where: { sourceType: "PART_WITHDRAWAL", sourceId: { in: (await prisma.partStockMovement.findMany({ where: { partRecordId: partId }, select: { id: true } })).map((m) => m.id) } } });
      await prisma.addressTaxLocation.deleteMany({ where: { id: locationId } });
      await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId } });
      await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
      await prisma.taxFilingPeriod.deleteMany({ where: { filingAccountId: accountId } });
      await prisma.taxFilingAccount.deleteMany({ where: { id: accountId } });
      await prisma.addressTaxLocation.updateMany({ where: { id: { in: existing.map((x) => x.id) } }, data: { isCurrent: true } });
      if (settings) await prisma.businessSettings.update({ where: { id: "singleton" }, data: { shortTermLeaseElection: settings.shortTermLeaseElection } });
    }
  });

  it("a resale receipt creates no purchase use tax even when the owner says no seller tax was charged", async () => {
    const ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    const supplierId = (await prisma.supplier.create({ data: { name: `Resale tax ${tag}` } })).id;
    const partId = await newPart();
    const po = await createPurchaseOrder(ownerId, { supplierId, lines: [{ partRecordId: partId, description: "Fixture", quantity: 2, unitCostCents: 900, forResale: true }] });
    await markPurchaseOrderOrdered(ownerId, po.id);
    const line = await prisma.purchaseOrderLineItem.findFirstOrThrow({ where: { purchaseOrderId: po.id } });
    await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey: key(), lines: [{ lineId: line.id, quantity: 2, unitCostCents: null }], tax: { answer: "NO", sellerTaxCents: 0 } });
    const receipt = await prisma.purchaseOrderReceiptTax.findFirstOrThrow({ where: { purchaseOrderId: po.id } });
    expect(await prisma.purchaseUseTax.count({ where: { sourceType: "PURCHASE_ORDER_LINE", sourceId: { startsWith: receipt.receiptOperationId + ":" } } })).toBe(0);
  });

  it("refuses an undo that would leave more resale units than stock, and the database enforces the same limits", async () => {
    const ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    const partId = await newPart();
    // Ordinary stock added by hand, then a later recount lowers it below the resale count only via the rules, never past them.
    await prisma.$transaction((tx) => applyPartMovementsInTx(tx, ownerId, key(), [{ partRecordId: partId, kind: "ADJUSTMENT", quantityDelta: 5, unitCostCents: null }]));
    const added = await prisma.partStockMovement.findFirstOrThrow({ where: { partRecordId: partId, kind: "ADJUSTMENT" } });
    await prisma.partRecord.update({ where: { id: partId }, data: { resaleUnitsOnHand: 4, resaleCostOnHandCents: 400 } });
    await expect(prisma.$transaction((tx) => applyPartMovementsInTx(tx, ownerId, key(), [{ partRecordId: partId, kind: "REVERSAL", reversesMovementId: added.id, unitCostCents: null }])))
      .rejects.toBeInstanceOf(ResaleStockConflictError);
    expect((await part(partId)).quantityOnHand).toBe(5);
    await expect(prisma.partRecord.update({ where: { id: partId }, data: { resaleUnitsOnHand: 6 } })).rejects.toThrow();
    await expect(prisma.partRecord.update({ where: { id: partId }, data: { resaleCostOnHandCents: -1 } })).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE "PartStockMovement" SET "resaleUnits" = 1 WHERE "partRecordId" = ${partId}`).rejects.toThrow();
  });

  it("selling details need a price, are saved with an audit entry, and are owner/admin only", async () => {
    const ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    const partId = await newPart();
    await expect(updatePartSaleSettings(ownerId, partId, { sellable: true, retailPriceCents: null, defaultForResale: false })).rejects.toThrow(/price/);
    await expect(updatePartSaleSettings(ownerId, partId, { sellable: true, retailPriceCents: -5, defaultForResale: false })).rejects.toThrow(/between/);
    await updatePartSaleSettings(ownerId, partId, { sellable: true, retailPriceCents: 1250, defaultForResale: true });
    expect(await part(partId)).toMatchObject({ sellable: true, retailPriceCents: 1250, defaultForResale: true });
    expect(await prisma.auditLog.count({ where: { action: "part.sale_settings.update", entityId: partId } })).toBe(1);
    const customer = await prisma.user.findFirst({ where: { role: "CUSTOMER" } });
    if (customer) await expect(updatePartSaleSettings(customer.id, partId, { sellable: false, retailPriceCents: null, defaultForResale: false })).rejects.toThrow();
  });

  it("only a received purchase can be marked as bought for resale", async () => {
    const ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    const partId = await newPart();
    await expect(prisma.$transaction((tx) => applyPartMovementsInTx(tx, ownerId, key(), [{ partRecordId: partId, kind: "ADJUSTMENT", quantityDelta: 1, unitCostCents: null, forResale: true }])))
      .rejects.toThrow(/bought for resale/);
  });
});
