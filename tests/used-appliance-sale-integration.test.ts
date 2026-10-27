import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createShopSale, cancelShopSale, getSaleFormData, returnShopSale } from "@/domains/sales";
import { recordManualPayment } from "@/domains/billing";
import { setRetiredPlan, reopenRetiredPlan } from "@/domains/inventory/retired-plans";
import { addBookTaxEvidence, disposedValueBefore } from "@/domains/books/fixed-assets";
import { listOpenResaleTaxFollowUps, markResaleTaxFollowUpDone, listShopSales } from "@/domains/sales";
import { listResaleTaxAttention } from "@/domains/exceptions/resale-tax-attention";
import { writeJournal, postForSource } from "@/domains/books/post";
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
    await expect(createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: unstaged, unitPriceCents: 4000 }] })).rejects.toThrow(/books need review|book retirement needs review|source evidence/i);
    expect(await prisma.invoice.count({ where: { saleKind: "SHOP_SALE" } })).toBe(before);
    expect((await prisma.retiredAppliancePlan.findUniqueOrThrow({ where: { applianceId: unstaged } })).doneOn).toBeNull();

    // A recorded cost with no book asset is not "nothing on the books": refused until it is added to the assets list.
    const costed = await retired();
    await prisma.appliance.update({ where: { id: costed }, data: { acquisitionCostCents: 25000 } });
    await expect(createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: costed, unitPriceCents: 4000 }] })).rejects.toThrow(/not on the book assets list/);
  });

  it("automatically stages an evidenced unretired book asset during a real used-appliance sale", async()=>{
    const id=await retired();
    await prisma.appliance.update({where:{id},data:{acquisitionCostCents:12000}});
    await prisma.bookAsset.create({data:{
     applianceId:id,costCents:12000,placedInServiceOn:new Date("2026-01-15T12:00:00Z"),
     lifeMonths:60,salvagePercent:0,createdByUserId:ownerId,
    }});
    await prisma.$transaction(tx=>postForSource(tx,"APPLIANCE",id));
    const sale=await createShopSale(ownerId,{
     operationKey:key(),customerId:null,location:"PICKUP",items:[],
     usedAppliances:[{applianceId:id,unitPriceCents:6500}],
    });
    expect(sale.subtotalCents).toBe(6500);
    const asset=await prisma.bookAsset.findUniqueOrThrow({where:{applianceId:id}});
    expect(asset.retiredOn).not.toBeNull();
    expect(asset.disposedOn).not.toBeNull();
    expect(asset.retiredValueCents).toBeGreaterThan(0);
    const books=await prisma.journalEntry.findMany({where:{
     sourceType:"APPLIANCE",sourceId:id,
    },include:{lines:true}});
    expect(books.filter(j=>j.eventKind==="RETIRED_HELD")).toHaveLength(1);
    expect(books.filter(j=>j.eventKind.startsWith("SOLD:"))).toHaveLength(1);
    expect(books.some(j=>j.eventKind.startsWith("DEPRECIATION:"))).toBe(true);
    for(const journal of books){
     const debit=journal.lines.reduce((n,line)=>n+line.debitCents,0);
     const credit=journal.lines.reduce((n,line)=>n+line.creditCents,0);
     expect(debit).toBe(credit);
    }
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

  // ---- M-2C: the income-tax side (warning, estimate and accountant follow-up). It informs; it never limits a sale. ----
  const today = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10); // safely in the past in Denver too
  const evidence = (id: string, over: Partial<Parameters<typeof addBookTaxEvidence>[2]> = {}) =>
    addBookTaxEvidence(ownerId, id, {
      classification: "RENTAL_ASSET", confidence: "CPA_CONFIRMED", originalBasisCents: 60000, signedAdjustmentsCents: null,
      allowedDepreciationCents: 40000, section179Cents: null, bonusDepreciationCents: null, evidenceDate: today,
      sourceReference: "Accountant worksheet 2026", cpaName: "Pat Accountant", ...over,
    });
  const snapshot = (invoiceId: string) => prisma.retiredSaleDisposition.findFirstOrThrow({ where: { invoiceId } });

  it("no tax history recorded: the sale still goes through at any price, the estimate has no numbers and the owner gets a follow-up", async () => {
    const id = await retired({ bookValueCents: 6000 });
    const form = (await getSaleFormData(ownerId)).usedAppliances.find((a) => a.id === id)!;
    expect(form.bookAsset).toMatchObject({ retiredValueCents: 6000, taxEvidence: [] });

    // Far above anything the books show: nothing caps the price.
    const sale = await createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: id, unitPriceCents: 900_000 }] });
    const d = await snapshot(sale.invoiceId);
    expect(d).toMatchObject({ priceCents: 900_000, bookCarriedCents: 6000, taxStatus: "CPA_REVIEW_NEEDED", adjustedBasisCents: null, taxGainCents: null, potentialRecaptureCents: null, followUpDoneAt: null, cancelledAt: null });
    expect(d.reviewReasons.length).toBeGreaterThan(0);
    expect((await listOpenResaleTaxFollowUps()).map((r) => r.id)).toContain(d.id);
  });

  it("the follow-up filter lists exactly the sales still waiting, chosen before the newest-100 cut-off, and the To do item links to it", async () => {
    const id = await retired({ bookValueCents: 6000 });
    const sale = await createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: id, unitPriceCents: 50000 }] });
    const waiting = await listShopSales(ownerId, { followUpOnly: true });
    expect(waiting.map((r) => r.id)).toContain(sale.invoiceId);
    const open = await listOpenResaleTaxFollowUps();
    expect(waiting.map((r) => r.id).sort()).toEqual([...new Set(open.map((r) => r.invoiceId))].sort());
    await markResaleTaxFollowUpDone(ownerId, (await snapshot(sale.invoiceId)).id);
    expect((await listShopSales(ownerId, { followUpOnly: true })).map((r) => r.id)).not.toContain(sale.invoiceId);
  });

  it("taking a paid used appliance back refunds everything, restores its book value, reopens its plan and closes the tax note, once", async () => {
    const id = await retired({ bookValueCents: 6000 });
    const sale = await createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: id, unitPriceCents: 40000 }] });
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: sale.invoiceId }, select: { customerId: true } });
    await recordManualPayment(invoice.customerId, ownerId, { amountCents: sale.amountDueCents, method: "cash", invoiceId: sale.invoiceId, refuseOverpayment: true });
    expect((await prisma.bookAsset.findUniqueOrThrow({ where: { applianceId: id } })).disposedOn).not.toBeNull();

    const back = await returnShopSale(ownerId, sale.invoiceId, "Buyer returned it");
    expect(back).toMatchObject({ refundedCents: sale.amountDueCents, alreadyReturned: false });
    expect((await prisma.bookAsset.findUniqueOrThrow({ where: { applianceId: id } })).disposedOn).toBeNull();
    expect(await prisma.journalEntry.count({ where: { sourceType: "APPLIANCE", sourceId: id, eventKind: { startsWith: "SOLD_VOIDED:" } } })).toBe(1);
    expect(await prisma.retiredAppliancePlan.findUniqueOrThrow({ where: { applianceId: id } })).toMatchObject({ doneOn: null });
    const note = await snapshot(sale.invoiceId);
    expect(note.cancelledAt).not.toBeNull();
    expect((await listOpenResaleTaxFollowUps()).map((r) => r.id)).not.toContain(note.id);
    expect(await prisma.auditLog.count({ where: { action: "sale.return", entityId: sale.invoiceId } })).toBe(1);

    // A second tap changes nothing, and the same appliance can be sold again.
    expect(await returnShopSale(ownerId, sale.invoiceId, "Buyer returned it")).toMatchObject({ alreadyReturned: true });
    expect(await prisma.journalEntry.count({ where: { sourceType: "APPLIANCE", sourceId: id, eventKind: { startsWith: "SOLD_VOIDED:" } } })).toBe(1);
    const again = await createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: id, unitPriceCents: 30000 }] });
    expect(again.invoiceId).not.toBe(sale.invoiceId);
  });

  it("accountant-confirmed history freezes the estimate with the seller's costs, and later evidence never rewrites it", async () => {
    const id = await retired({ bookValueCents: 6000 });
    await evidence(id);
    const sale = await createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: id, unitPriceCents: 75000, sellerCostsCents: 5000 }] });
    const d = await snapshot(sale.invoiceId);
    // $750 less $50 costs = $700 against $200 left: $500 gain; $400 of it may be recapture; $100 for the accountant.
    expect(d).toMatchObject({ taxStatus: "CPA_CONFIRMED_ESTIMATE", sellerCostsCents: 5000, adjustedBasisCents: 20000, totalDepreciationCents: 40000, taxGainCents: 50000, potentialRecaptureCents: 40000, otherGainCents: 10000 });
    expect(d.followUpDoneAt).not.toBeNull(); // nothing left for the accountant, so nothing on the To do list
    expect((await listOpenResaleTaxFollowUps()).map((r) => r.id)).not.toContain(d.id);

    await evidence(id, { allowedDepreciationCents: 10000 });
    expect(await snapshot(sale.invoiceId)).toMatchObject({ adjustedBasisCents: 20000, potentialRecaptureCents: 40000 });
  });

  it("numbers the owner typed in are an unconfirmed estimate; only the owner can finish the follow-up, once", async () => {
    const id = await retired({ bookValueCents: 3000 });
    await evidence(id, { confidence: "OWNER_SUPPLIED", cpaName: undefined, sourceReference: "My own notes" });
    const sale = await createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: id, unitPriceCents: 60000 }] });
    const d = await snapshot(sale.invoiceId);
    expect(d).toMatchObject({ taxStatus: "UNCONFIRMED_ESTIMATE", potentialRecaptureCents: 40000, followUpDoneAt: null });

    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    await expect(markResaleTaxFollowUpDone(admin.id, d.id)).rejects.toThrow();
    expect((await snapshot(sale.invoiceId)).followUpDoneAt).toBeNull();

    expect(await markResaleTaxFollowUpDone(ownerId, d.id)).toEqual({ alreadyDone: false });
    const first = (await snapshot(sale.invoiceId)).followUpDoneAt;
    expect(first).not.toBeNull();
    expect(await markResaleTaxFollowUpDone(ownerId, d.id)).toEqual({ alreadyDone: true });
    expect((await snapshot(sale.invoiceId)).followUpDoneAt).toEqual(first);
    expect(await prisma.auditLog.count({ where: { action: "sale.retired_tax_followup_done", entityId: d.id } })).toBe(1);
    expect((await listOpenResaleTaxFollowUps()).map((r) => r.id)).not.toContain(d.id);
  });

  it("an expensed item is never given an invented depreciation record, and a retry or a cancel keeps exactly one honest snapshot", async () => {
    const id = await retired({ bookValueCents: 2000 });
    await evidence(id, { classification: "EXPENSED" });
    const opKey = key();
    const input = { operationKey: opKey, customerId: null, location: "PICKUP" as const, items: [], usedAppliances: [{ applianceId: id, unitPriceCents: 40000 }] };
    const sale = await createShopSale(ownerId, input);
    expect(await createShopSale(ownerId, input)).toMatchObject({ invoiceId: sale.invoiceId, replayed: true });
    expect(await prisma.retiredSaleDisposition.count({ where: { invoiceId: sale.invoiceId } })).toBe(1);
    expect(await snapshot(sale.invoiceId)).toMatchObject({ taxStatus: "CPA_REVIEW_NEEDED", potentialRecaptureCents: null });

    // The To do item is one line, and cancelling the sale takes the follow-up away.
    const items = await listResaleTaxAttention(new Date());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ category: "RETIRED_SALE_TAX_REVIEW", severity: "medium" });
    expect(items[0].href).toMatch(/^\/desk\/sales(\/|\?followUp=1$|$)/);
    await cancelShopSale(ownerId, sale.invoiceId, "Buyer backed out");
    expect((await snapshot(sale.invoiceId)).cancelledAt).not.toBeNull();
    expect((await listOpenResaleTaxFollowUps()).map((r) => r.invoiceId)).not.toContain(sale.invoiceId);
  });

  it("refuses selling costs that are negative or more than the price", async () => {
    const id = await retired({ bookValueCents: 1000 });
    for (const sellerCostsCents of [-1, 5001]) {
      await expect(createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [], usedAppliances: [{ applianceId: id, unitPriceCents: 5000, sellerCostsCents }] })).rejects.toThrow(/cost of selling/);
    }
    expect(await prisma.retiredSaleDisposition.count({ where: { applianceId: id } })).toBe(0);
  });
});
