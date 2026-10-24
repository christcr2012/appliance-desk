import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createShopSale, cancelShopSale, getSaleFormData } from "@/domains/sales";
import { setRetiredPlan, reopenRetiredPlan } from "@/domains/inventory/retired-plans";
import { disposedValueBefore } from "@/domains/books/fixed-assets";
import { writeJournal } from "@/domains/books/post";
import { balancedPlan } from "@/domains/books/posting-rules";
import { seedTaxReadyContext } from "./helpers/tax-ready";

// Batch M, M-2C on real Postgres: selling a retired appliance posts one sale, takes its book value off the books once,
// finishes its "Sell it" plan, and cancelling the sale puts everything back.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";
const key = () => `sale-${randomUUID()}`;

describe.skipIf(!enabled)("selling a retired appliance on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  const shopJurisdictionId = `uas-shop-${tag}`;
  const shopLocationId = `uas-shop-loc-${tag}`;
  const typeId = `uas-type-${tag}`;
  let ownerId: string;
  let previousShopLocations: string[] = [];
  let savedBooksStart: Date | null = null;
  const createdAppliances: string[] = [];

  /** A retired appliance with a plan; `bookValueCents > 0` also gives it a retired book asset holding that value. */
  const retired = async (opts: { choice?: "SELL" | "SCRAP"; bookValueCents?: number } = {}) => {
    const id = `uas-app-${tag}-${createdAppliances.length}`;
    createdAppliances.push(id);
    await prisma.appliance.create({ data: { id, assetNumber: `UAS-${tag}-${createdAppliances.length}`, applianceTypeId: typeId, status: "RETIRED", manufacturer: "Maytag", model: "MVWB", serialNumber: `S${createdAppliances.length}` } });
    await setRetiredPlan(ownerId, id, { choice: opts.choice ?? "SELL" });
    if (opts.bookValueCents) {
      const retiredOn = new Date("2026-09-30T12:00:00Z");
      await prisma.bookAsset.create({
        data: { applianceId: id, costCents: 12000, placedInServiceOn: new Date("2026-01-15T12:00:00Z"), lifeMonths: 60, salvagePercent: 0, retiredOn, retirementIntent: "SELL", retiredValueCents: opts.bookValueCents, createdByUserId: ownerId },
      });
      await prisma.$transaction(async (tx) => {
        const plan = balancedPlan(retiredOn, "Retired rental appliance held pending final disposition", [
          { role: "RETIRED_PENDING_DISPOSITION", debitCents: opts.bookValueCents!, creditCents: 0 },
          { role: "RENTAL_EQUIPMENT", debitCents: 0, creditCents: opts.bookValueCents! },
        ])!;
        await writeJournal(tx, "APPLIANCE", id, "RETIRED_HELD", plan, { applianceId: id });
      });
    }
    return id;
  };

  const netByRole = async (applianceId: string) => {
    const lines = await prisma.journalLine.findMany({
      where: { entry: { sourceType: "APPLIANCE", sourceId: applianceId } },
      select: { debitCents: true, creditCents: true, ledgerAccount: { select: { systemRole: true } } },
    });
    const out: Record<string, number> = {};
    for (const l of lines) out[l.ledgerAccount.systemRole!] = (out[l.ledgerAccount.systemRole!] ?? 0) + l.debitCents - l.creditCents;
    return out;
  };

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.applianceType.create({ data: { id: typeId, name: `Used Sale Type ${tag}`, slug: `used-sale-type-${tag}` } });
    previousShopLocations = (await prisma.addressTaxLocation.findMany({ where: { forBusinessLocation: true, isCurrent: true }, select: { id: true } })).map((r) => r.id);
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: previousShopLocations } }, data: { isCurrent: false } });
    await prisma.taxJurisdiction.create({ data: { id: shopJurisdictionId, code: `UAS-${tag}`, name: "Used Shop City", level: "CITY", administration: "STATE_COLLECTED", reviewStatus: "REVIEWED" } });
    await prisma.taxRateVersion.create({ data: { jurisdictionId: shopJurisdictionId, rateMilliPercent: 5000, effectiveFrom: new Date("2020-01-01T07:00:00Z"), source: "MANUAL" } });
    for (const category of ["MERCHANDISE", "USED_APPLIANCE_SALE"] as const) {
      await prisma.taxabilityRule.create({ data: { jurisdictionId: shopJurisdictionId, category, taxability: "TAXABLE", reason: "test" } });
    }
    await prisma.addressTaxLocation.create({
      data: { id: shopLocationId, forBusinessLocation: true, isCurrent: true, status: "VERIFIED", source: "MANUAL", lookedUpAt: new Date(), jurisdictions: { create: [{ jurisdictionId: shopJurisdictionId }] } },
    });
    savedBooksStart = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).booksStartDate;
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { booksStartDate: new Date("2026-01-01T07:00:00Z") } });
    void seedTaxReadyContext;
  });

  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { booksStartDate: savedBooksStart } });
    await prisma.addressTaxLocation.update({ where: { id: shopLocationId }, data: { isCurrent: false } });
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: previousShopLocations } }, data: { isCurrent: true } });
  });

  it("sells a Sell-it appliance once: income on the invoice, plan finished, book value removed exactly once", async () => {
    const id = await retired({ bookValueCents: 6000 });
    const form = await getSaleFormData(ownerId);
    expect(form.usedAppliances.map((a) => a.id)).toContain(id);

    const sale = await createShopSale(ownerId, { operationKey: key(), customerId: null, walkInName: "Pat", location: "PICKUP", items: [], usedAppliances: [{ applianceId: id, unitPriceCents: 20000 }] });
    expect(sale).toMatchObject({ subtotalCents: 20000, taxCents: 1000, amountDueCents: 21000 });

    const line = await prisma.invoiceLineItem.findFirstOrThrow({ where: { invoiceId: sale.invoiceId } });
    expect(line).toMatchObject({ kind: "USED_APPLIANCE", amountCents: 20000, quantity: 1, applianceId: id });
    const taxLine = await prisma.invoiceTaxLine.findFirstOrThrow({ where: { invoiceId: sale.invoiceId } });
    expect(taxLine.category).toBe("USED_APPLIANCE_SALE");

    const plan = await prisma.retiredAppliancePlan.findUniqueOrThrow({ where: { applianceId: id } });
    expect(plan.doneOn).not.toBeNull();
    expect(plan.doneNote).toMatch(/Sold on invoice/);

    // The held book value (6000) is cleared by one entry; nothing else moves; the original cost is not expensed again.
    const net = await netByRole(id);
    expect(net.RETIRED_PENDING_DISPOSITION).toBe(0);
    expect(net.BOOK_VALUE_OF_APPLIANCES_SOLD).toBe(6000);
    expect(net.RENTAL_EQUIPMENT).toBe(-6000);
    expect(await prisma.journalEntry.count({ where: { sourceType: "APPLIANCE", sourceId: id, eventKind: { startsWith: "SOLD:" } } })).toBe(1);
    expect((await prisma.bookAsset.findUniqueOrThrow({ where: { applianceId: id } })).disposedOn).not.toBeNull();

    // Gone from the picker; a second sale of the same appliance is refused.
    expect((await getSaleFormData(ownerId)).usedAppliances.map((a) => a.id)).not.toContain(id);
    await expect(createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: id, unitPriceCents: 100 }] })).rejects.toThrow(/already marked done|already on a sale/);

    // A retry of the same request changes nothing.
    const again = await createShopSale(ownerId, { operationKey: (await prisma.invoice.findUniqueOrThrow({ where: { id: sale.invoiceId } })).saleOperationKey!, customerId: null, walkInName: "Pat", location: "PICKUP", items: [], usedAppliances: [{ applianceId: id, unitPriceCents: 20000 }] });
    expect(again).toMatchObject({ invoiceId: sale.invoiceId, replayed: true });
    expect(await prisma.journalEntry.count({ where: { sourceType: "APPLIANCE", sourceId: id, eventKind: { startsWith: "SOLD:" } } })).toBe(1);
  });

  it("cancelling the sale restores the book value and opens the plan again, and the appliance can be sold again", async () => {
    const id = await retired({ bookValueCents: 4000 });
    const sale = await createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: id, unitPriceCents: 3000 }] });
    expect((await netByRole(id)).BOOK_VALUE_OF_APPLIANCES_SOLD).toBe(4000);

    // A finished plan tied to a live sale cannot be reopened by hand: the sale must be cancelled so the books follow.
    await expect(reopenRetiredPlan(ownerId, id, "changed my mind")).rejects.toThrow(/Cancel that sale first/);
    const tomorrow = new Date(Date.now() + 2 * 86_400_000);
    expect((await disposedValueBefore(prisma, tomorrow)).get(id)).toBe(4000);

    await cancelShopSale(ownerId, sale.invoiceId, "Buyer changed their mind");
    expect((await disposedValueBefore(prisma, tomorrow)).get(id)).toBe(0); // sold then cancelled nets to nothing
    const net = await netByRole(id);
    expect(net.BOOK_VALUE_OF_APPLIANCES_SOLD).toBe(0);
    expect(net.RETIRED_PENDING_DISPOSITION).toBe(4000); // held again, as before the sale
    const plan = await prisma.retiredAppliancePlan.findUniqueOrThrow({ where: { applianceId: id } });
    expect(plan.doneOn).toBeNull();
    expect(plan.reopenReason).toMatch(/cancelled/);
    expect((await prisma.bookAsset.findUniqueOrThrow({ where: { applianceId: id } })).disposedOn).toBeNull();
    expect((await getSaleFormData(ownerId)).usedAppliances.map((a) => a.id)).toContain(id);

    const second = await createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: id, unitPriceCents: 5000 }] });
    expect(second.invoiceId).not.toBe(sale.invoiceId);
    expect((await netByRole(id)).BOOK_VALUE_OF_APPLIANCES_SOLD).toBe(4000);
  });

  it("an appliance with nothing on the books can still be sold (no book entry), and loss or gain is just price against book value", async () => {
    const id = await retired();
    const sale = await createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: id, unitPriceCents: 1500 }] });
    expect(sale.subtotalCents).toBe(1500);
    expect(await prisma.journalEntry.count({ where: { sourceType: "APPLIANCE", sourceId: id } })).toBe(0);
  });

  it("refuses anything that is not a retired appliance with an open Sell-it plan, and an unstaged book retirement", async () => {
    const scrap = await retired({ choice: "SCRAP" });
    await expect(createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: scrap, unitPriceCents: 1000 }] })).rejects.toThrow(/“Sell it” plan/);
    const active = `uas-active-${tag}`;
    createdAppliances.push(active);
    await prisma.appliance.create({ data: { id: active, assetNumber: `UAS-A-${tag}`, applianceTypeId: typeId, status: "AVAILABLE" } });
    await expect(createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: active, unitPriceCents: 1000 }] })).rejects.toThrow(/“Sell it” plan/);
    await expect(createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: scrap, unitPriceCents: 0 }] })).rejects.toThrow(/price/);

    // Capitalised but book retirement not staged: refused, and nothing was saved.
    const unstaged = await retired();
    await prisma.bookAsset.create({ data: { applianceId: unstaged, costCents: 9000, placedInServiceOn: new Date("2026-01-15T12:00:00Z"), lifeMonths: 60, salvagePercent: 0, createdByUserId: ownerId } });
    const before = await prisma.invoice.count({ where: { saleKind: "SHOP_SALE" } });
    await expect(createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: unstaged, unitPriceCents: 4000 }] })).rejects.toThrow(/Stage this appliance's book retirement/);
    expect(await prisma.invoice.count({ where: { saleKind: "SHOP_SALE" } })).toBe(before);
    expect((await prisma.retiredAppliancePlan.findUniqueOrThrow({ where: { applianceId: unstaged } })).doneOn).toBeNull();

    // A recorded cost with no book asset is not "nothing on the books": refused until it is added to the assets list.
    const costed = await retired();
    await prisma.appliance.update({ where: { id: costed }, data: { acquisitionCostCents: 25000 } });
    await expect(createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: costed, unitPriceCents: 4000 }] })).rejects.toThrow(/not on the book assets list/);
  });

  it("books the sale income together with the book-value entry, and the sold appliance carries no value afterwards", async () => {
    const id = await retired({ bookValueCents: 7000 });
    const sale = await createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: id, unitPriceCents: 5000 }] });
    expect(await prisma.journalEntry.count({ where: { sourceType: "INVOICE", sourceId: sale.invoiceId, eventKind: "INVOICE_RECOGNIZED" } })).toBe(1);
    const row = await prisma.bookAsset.findUniqueOrThrow({ where: { applianceId: id } });
    expect(row.disposedOn).not.toBeNull();
    await cancelShopSale(ownerId, sale.invoiceId, "Customer backed out");
    expect(await prisma.journalEntry.count({ where: { sourceType: "INVOICE", sourceId: sale.invoiceId, eventKind: "INVOICE_VOIDED" } })).toBe(1);
  });
});
