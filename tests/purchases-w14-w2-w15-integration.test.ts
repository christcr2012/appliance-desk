import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/domains/messaging/owner-alerts", () => ({ sendOwnerAlert: vi.fn(async () => {}) }));
vi.mock("@/lib/session", () => ({ requireRole: vi.fn(async () => ({ user: { id: "test-owner", role: "OWNER" } })) }));
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import {
  PurchaseConflictError, getPurchaseDetail, recordPurchase, removePurchaseDocument,
  updatePurchaseTaxAnswer, type RecordPurchaseInput,
} from "@/domains/purchasing/purchases";
import { createPurchaseOrder, markPurchaseOrderOrdered, receivePurchaseOrderLines } from "@/domains/purchasing";
import { loadReceiptTaxSteps, updateReceiptTaxAnswer } from "@/domains/purchasing/receipt-tax";
import { listAcquisitionTaxAttention } from "@/domains/tax/acquisition-attention";
import { buildAuditPack, auditPackCsv, getApplianceTaxProof } from "@/domains/tax/tax-proof";
import { saveRecordRetentionYears } from "@/domains/tax/retention";
import { loadFilingPacket } from "@/domains/tax/filing-packet";
import { detectTaxFilingAmendments, markPeriodFiled } from "@/domains/tax/filing";
import { canUploadPhoto } from "@/domains/uploads";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true"
  && ["localhost", "127.0.0.1"].includes(url.hostname)
  && url.pathname === "/appliance_desk_test";
const day = (s: string) => businessDateFromKey(s)!;
const tag = randomUUID().replaceAll("-", "");
const ownerId = "pw-owner-" + tag;
const adminId = "pw-admin-" + tag;
const typeId = "pw-type-" + tag;
const dryerTypeId = "pw-dryer-" + tag;
const supplierId = "pw-supplier-" + tag;
const jurId = "pw-jur-" + tag;
const accountId = "pw-account-" + tag;
const locationId = "pw-location-" + tag;
const key = () => "form-" + randomUUID();

describe.skipIf(!enabled)("W-14 + W-2 + W-15 purchases, next step and audit pack on real PostgreSQL", () => {
  let oldLocations: string[] = [];
  let oldElection: "UNDECIDED" | "PAY_ON_ACQUISITION" | "COLLECT_ON_RENTALS" | null = null;
  let oldRetention = 7;
  const purchaseIds: string[] = [];
  const periodIds: string[] = [];
  const orderIds: string[] = [];

  const base = (extra: Partial<RecordPurchaseInput> = {}): RecordPurchaseInput => ({
    operationKey: key(), supplierId, purchasedOn: day("2026-09-18"), taxAnswer: "NO", sellerTaxCents: 0, otherChargesCents: 0,
    documents: [], appliances: [{ applianceTypeId: typeId, priceCents: 10000 }], ...extra,
  });
  async function record(actor: string, input: RecordPurchaseInput) {
    const result = await recordPurchase(actor, input);
    purchaseIds.push(result.purchaseId);
    return result;
  }

  beforeAll(async () => {
    oldLocations = (await prisma.addressTaxLocation.findMany({ where: { forBusinessLocation: true, isCurrent: true }, select: { id: true } })).map((r) => r.id);
    const settings = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { shortTermLeaseElection: true, recordRetentionYears: true } });
    oldElection = settings?.shortTermLeaseElection ?? null;
    oldRetention = settings?.recordRetentionYears ?? 7;
    await prisma.user.createMany({ data: [
      { id: ownerId, email: "o-" + tag + "@example.test", name: "Owner", role: "OWNER" },
      { id: adminId, email: "a-" + tag + "@example.test", name: "Admin", role: "ADMIN" },
    ] });
    await prisma.applianceType.createMany({ data: [
      { id: typeId, name: "Pwash", slug: "pwash-" + tag, monthlyPriceCents: 1500 },
      { id: dryerTypeId, name: "Pwdry", slug: "pdry-" + tag, monthlyPriceCents: 1500 },
    ] });
    await prisma.supplier.create({ data: { id: supplierId, name: "Acme Appliance " + tag } });
    await prisma.businessSettings.upsert({
      where: { id: "singleton" }, create: { shortTermLeaseElection: "PAY_ON_ACQUISITION" }, update: { shortTermLeaseElection: "PAY_ON_ACQUISITION", recordRetentionYears: 7 },
    });
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: oldLocations } }, data: { isCurrent: false } });
    await prisma.taxFilingAccount.create({ data: { id: accountId, name: "Purchases tax " + tag, kind: "USE_TAX_RETURN", basis: "ACCRUAL", firstPeriodStart: day("2026-01-01") } });
    await prisma.taxJurisdiction.create({ data: { id: jurId, code: "PW-" + tag.slice(0, 6), name: "Purchase test jurisdiction", level: "CITY",
      administration: "SELF_COLLECTED", reviewStatus: "REVIEWED", useTaxFilingAccountId: accountId } });
    await prisma.taxRateVersion.create({ data: { jurisdictionId: jurId, rateMilliPercent: 5000, effectiveFrom: day("2026-01-01"), source: "MANUAL" } });
    await prisma.addressTaxLocation.create({ data: { id: locationId, forBusinessLocation: true, isCurrent: true, status: "VERIFIED", source: "MANUAL",
      lookedUpAt: day("2026-09-01"), jurisdictions: { create: [{ jurisdictionId: jurId }] } } });
  });

  afterAll(async () => {
    const purchases = await prisma.purchase.findMany({ where: { id: { in: purchaseIds } }, select: { id: true, appliances: { select: { id: true } } } });
    const applianceIds = purchases.flatMap((p) => p.appliances.map((a) => a.id));
    const receipts = await prisma.purchaseOrderReceiptOperation.findMany({ where: { purchaseOrderId: { in: orderIds } }, select: { id: true } });
    await prisma.taxFilingAmendment.deleteMany({ where: { periodId: { in: periodIds } } });
    await prisma.purchaseUseTax.deleteMany({ where: { OR: [
      { sourceType: "APPLIANCE", sourceId: { in: applianceIds } },
      ...receipts.map((r) => ({ sourceType: "PURCHASE_ORDER_LINE", sourceId: { startsWith: r.id + ":" } })),
    ] } });
    await prisma.taxFilingPeriod.deleteMany({ where: { id: { in: periodIds } } });
    const docs = await prisma.purchaseDocument.findMany({ where: { purchaseId: { in: purchaseIds } }, select: { photoId: true } });
    await prisma.purchaseDocument.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
    await prisma.photo.deleteMany({ where: { id: { in: docs.map((d) => d.photoId) } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
    await prisma.purchaseOrderReceiptTax.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrderReceiptOperation.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrderLineItem.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [ownerId, adminId] } } });
    await prisma.assetNumberCounter.deleteMany({ where: { prefix: { in: ["PWAS", "PWDR"] } } });
    await prisma.applianceType.deleteMany({ where: { id: { in: [typeId, dryerTypeId] } } });
    await prisma.addressTaxLocation.deleteMany({ where: { id: locationId } });
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: oldLocations } }, data: { isCurrent: true } });
    await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId: jurId } });
    await prisma.taxJurisdiction.deleteMany({ where: { id: jurId } });
    await prisma.taxFilingAccount.deleteMany({ where: { id: accountId } });
    if (oldElection !== null) {
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: { shortTermLeaseElection: oldElection, recordRetentionYears: oldRetention } });
    }
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId] } } });
  });

  it("records one receipt as one purchase with each appliance linked, priced and sharing the tax to the cent", async () => {
    const result = await record(ownerId, base({
      reference: "R-100", taxAnswer: "YES_COLORADO", sellerTaxCents: 101, otherChargesCents: 2500,
      appliances: [
        { applianceTypeId: typeId, manufacturer: "Maytag", model: "W1", serialNumber: "SER-A-" + tag, priceCents: 40000 },
        { applianceTypeId: dryerTypeId, manufacturer: "Maytag", model: "D1", serialNumber: "SER-B-" + tag, priceCents: 25000 },
        { applianceTypeId: typeId, priceCents: 10000 },
      ],
    }));
    expect(result.appliances).toHaveLength(3);
    expect(result.subtotalCents).toBe(75000);
    expect(result.receiptTotalCents).toBe(75000 + 101 + 2500);
    expect(result.appliances.reduce((s, a) => s + a.taxShareCents, 0)).toBe(101);
    const detail = (await getPurchaseDetail(result.purchaseId))!;
    expect(detail.appliances.map((a) => a.acquisitionCostCents)).toEqual([40000, 25000, 10000]);
    expect(detail.appliances.map((a) => a.acquisitionTaxPaidCents)).toEqual(result.appliances.map((a) => a.taxShareCents));
    expect(detail.appliances.every((a) => a.step.kind === "DONE_SELLER_TAX" || a.step.kind === "USE_TAX_ON_RETURN")).toBe(true);
    expect(new Set(result.appliances.map((a) => a.assetNumber)).size).toBe(3);
    const row = await prisma.appliance.findFirstOrThrow({ where: { serialNumber: "SER-A-" + tag } });
    expect(row.purchaseId).toBe(result.purchaseId);
    expect(row.purchaseDate).toEqual(day("2026-09-18"));
  });

  it("a repeated save replays the first result; a changed form with the same key is refused; nothing is duplicated", async () => {
    const input = base({ appliances: [{ applianceTypeId: typeId, priceCents: 5000, serialNumber: "SER-R-" + tag }] });
    const first = await record(ownerId, input);
    const again = await recordPurchase(ownerId, input);
    expect(again.replayed).toBe(true);
    expect(again.purchaseId).toBe(first.purchaseId);
    expect(again.appliances.map((a) => a.id)).toEqual(first.appliances.map((a) => a.id));
    await expect(recordPurchase(ownerId, { ...input, appliances: [{ applianceTypeId: typeId, priceCents: 5001, serialNumber: "SER-R-" + tag }] }))
      .rejects.toBeInstanceOf(PurchaseConflictError);
    expect(await prisma.appliance.count({ where: { serialNumber: "SER-R-" + tag } })).toBe(1);
    const simultaneous = base({ appliances: [{ applianceTypeId: typeId, priceCents: 700, serialNumber: "SER-S-" + tag }] });
    const results = await Promise.allSettled([recordPurchase(ownerId, simultaneous), recordPurchase(ownerId, simultaneous)]);
    for (const r of results) if (r.status === "fulfilled") purchaseIds.push(r.value.purchaseId);
    expect(await prisma.appliance.count({ where: { serialNumber: "SER-S-" + tag } })).toBe(1);
  });

  it("saves everything or nothing: a duplicate serial or bad row leaves no purchase, appliance or tax row behind", async () => {
    await record(ownerId, base({ appliances: [{ applianceTypeId: typeId, priceCents: 100, serialNumber: "SER-D-" + tag }] }));
    const before = { purchases: await prisma.purchase.count(), appliances: await prisma.appliance.count(), audits: await prisma.auditLog.count({ where: { userId: ownerId } }) };
    await expect(recordPurchase(ownerId, base({ appliances: [
      { applianceTypeId: typeId, priceCents: 200 }, { applianceTypeId: typeId, priceCents: 300, serialNumber: "ser-d-" + tag }] })))
      .rejects.toThrow(/already in inventory/);
    await expect(recordPurchase(ownerId, base({ appliances: [
      { applianceTypeId: typeId, priceCents: 200 }, { applianceTypeId: "missing-type", priceCents: 300 }] })))
      .rejects.toThrow(/no longer exists/);
    expect({ purchases: await prisma.purchase.count(), appliances: await prisma.appliance.count(), audits: await prisma.auditLog.count({ where: { userId: ownerId } }) }).toEqual(before);
  });

  it("only the owner answers the tax question; an admin records the purchase as 'check the receipt later' and it lands on To do", async () => {
    await expect(recordPurchase(adminId, base({ taxAnswer: "NO" }))).rejects.toThrow(/Only the owner/);
    const result = await record(adminId, base({ taxAnswer: "LATER", reference: "R-ADMIN", appliances: [
      { applianceTypeId: typeId, priceCents: 1000 }, { applianceTypeId: typeId, priceCents: 2000 }] }));
    expect(result.appliances.every((a) => a.step.kind === "CHECK_RECEIPT_LATER")).toBe(true);
    const todo = (await listAcquisitionTaxAttention(new Date())).filter((i) => i.href === "/desk/purchases/" + result.purchaseId);
    expect(todo).toHaveLength(1);
    expect(todo[0]!.title).toContain("2 appliances");
    expect(todo[0]!.primaryAction?.href).toBe("/desk/purchases/" + result.purchaseId);
    expect(todo[0]!.dueOn).toBeInstanceOf(Date);
  });

  it("another state's tax is saved as 'ask your CPA' with its note, calculates nothing, and creates a CPA To do", async () => {
    const result = await record(ownerId, base({ taxAnswer: "YES_OTHER_STATE", sellerTaxCents: 700, otherState: "Utah" }));
    const [a] = result.appliances;
    expect(a!.step.kind).toBe("CPA_OTHER_STATE");
    expect(await prisma.purchaseUseTax.count({ where: { sourceType: "APPLIANCE", sourceId: a!.id } })).toBe(0);
    const appliance = await prisma.appliance.findUniqueOrThrow({ where: { id: a!.id } });
    expect(appliance.acquisitionSellerNote).toContain("Utah");
    const todo = (await listAcquisitionTaxAttention(new Date())).find((i) => i.href === "/desk/purchases/" + result.purchaseId);
    expect(todo?.title).toContain("Utah");
  });

  it("re-answering a purchase updates every appliance; a stale page and an admin are refused", async () => {
    const result = await record(adminId, base({ taxAnswer: "LATER", appliances: [
      { applianceTypeId: typeId, priceCents: 10000 }, { applianceTypeId: typeId, priceCents: 10000 }] }));
    const stored = await prisma.purchase.findUniqueOrThrow({ where: { id: result.purchaseId } });
    await expect(updatePurchaseTaxAnswer(adminId, { purchaseId: result.purchaseId, expectedTaxRevisionAt: stored.taxRevisionAt, taxAnswer: "NO", sellerTaxCents: 0 }))
      .rejects.toThrow(/Only the owner/);
    const after = await updatePurchaseTaxAnswer(ownerId, { purchaseId: result.purchaseId, expectedTaxRevisionAt: stored.taxRevisionAt, taxAnswer: "NO", sellerTaxCents: 0 });
    expect(after.appliances.every((a) => a.step.kind === "USE_TAX_ON_RETURN")).toBe(true);
    expect(after.appliances.every((a) => a.step.headline.includes("$5.00"))).toBe(true);
    await expect(updatePurchaseTaxAnswer(ownerId, { purchaseId: result.purchaseId, expectedTaxRevisionAt: stored.taxRevisionAt, taxAnswer: "YES_COLORADO", sellerTaxCents: 200 }))
      .rejects.toThrow(/Someone updated/);
  });

  it("editing a tax answer after the return was filed keeps the filed rows and opens the amendment", async () => {
    const result = await record(ownerId, base({ purchasedOn: day("2026-08-12"), taxAnswer: "NO", appliances: [{ applianceTypeId: typeId, priceCents: 10000 }] }));
    const period = await prisma.taxFilingPeriod.create({ data: { filingAccountId: accountId, periodStart: day("2026-08-01"), periodEnd: day("2026-08-31"), dueOn: day("2026-09-20") } });
    periodIds.push(period.id);
    const packet = await loadFilingPacket(period.id, day("2026-09-22"));
    if (packet.status !== "READY") throw new Error(packet.problems.join(" "));
    await markPeriodFiled(ownerId, { periodId: period.id, filedOn: day("2026-09-22"), paidOn: day("2026-09-22"), confirmationNumber: "PW-" + tag.slice(0, 8),
      amountPaidCents: packet.packet.totals.remitIfOnTimeCents, amountDifferentReason: "Test evidence" });
    const stored = await prisma.purchase.findUniqueOrThrow({ where: { id: result.purchaseId } });
    const proofBefore = (await getApplianceTaxProof(result.appliances[0]!.id))!;
    expect(proofBefore.step.kind).toBe("USE_TAX_FILED");
    expect(proofBefore.useTaxRows[0]!.confirmationNumber).toBe("PW-" + tag.slice(0, 8));
    await updatePurchaseTaxAnswer(ownerId, { purchaseId: result.purchaseId, expectedTaxRevisionAt: stored.taxRevisionAt, taxAnswer: "YES_COLORADO", sellerTaxCents: 200 });
    const row = await prisma.purchaseUseTax.findFirstOrThrow({ where: { sourceType: "APPLIANCE", sourceId: result.appliances[0]!.id } });
    expect(row.status).toBe("FILED");
    expect(row.useTaxDueCents).toBe(300);
    expect(await detectTaxFilingAmendments(day("2026-10-20"))).toBeGreaterThanOrEqual(1);
    expect(await prisma.taxFilingAmendment.count({ where: { periodId: period.id, status: "OPEN" } })).toBe(1);
  });

  it("parts: the receiving form asks the same question; an admin defers it and the owner answers later", async () => {
    const order = await createPurchaseOrder(ownerId, { supplierId, lines: [{ description: "Washer pump " + tag, quantity: 4, unitCostCents: 2500, unitCostKnown: true }] } as never);
    orderIds.push(order.id);
    await markPurchaseOrderOrdered(ownerId, order.id);
    const lineId = (await prisma.purchaseOrderLineItem.findFirstOrThrow({ where: { purchaseOrderId: order.id } })).id;
    await expect(receivePurchaseOrderLines(adminId, { purchaseOrderId: order.id, operationKey: key().slice(0, 60), lines: [{ lineId, quantity: 2, unitCostCents: null }], tax: { answer: "NO", sellerTaxCents: 0 } }))
      .rejects.toThrow(/Only the owner/);
    await receivePurchaseOrderLines(adminId, { purchaseOrderId: order.id, operationKey: key().slice(0, 60), lines: [{ lineId, quantity: 2, unitCostCents: null }], tax: { answer: "LATER", sellerTaxCents: 0 } });
    let [step] = await loadReceiptTaxSteps(prisma, null, new Date()).then((all) => all.filter((s) => s.purchaseOrderId === order.id));
    expect(step!.kind).toBe("CHECK_RECEIPT_LATER");
    const todo = (await listAcquisitionTaxAttention(new Date())).find((i) => i.href === "/desk/purchase-orders/" + order.id);
    expect(todo?.title).toContain("receipt");
    await updateReceiptTaxAnswer(ownerId, { receiptTaxId: step!.receiptTaxId, expectedRevisionAt: step!.revisionAt, tax: { answer: "NO", sellerTaxCents: 0 } });
    [step] = await loadReceiptTaxSteps(prisma, null, new Date()).then((all) => all.filter((s) => s.purchaseOrderId === order.id));
    expect(step!.kind).toBe("USE_TAX_ON_RETURN");
    expect(step!.amountCents).toBe(250);
    await expect(updateReceiptTaxAnswer(ownerId, { receiptTaxId: step!.receiptTaxId, expectedRevisionAt: new Date(0), tax: { answer: "NO", sellerTaxCents: 0 } })).rejects.toThrow(/Someone updated|Review existing/);
  });

  it("the audit pack lists appliances and parts in the date range with tax, return and receipt, and its spreadsheet matches", async () => {
    const result = await record(ownerId, base({ purchasedOn: day("2026-03-03"), reference: "R-AUD", taxAnswer: "YES_COLORADO", sellerTaxCents: 500,
      appliances: [{ applianceTypeId: typeId, priceCents: 10000, serialNumber: "SER-AUD-" + tag }] }));
    const photo = await prisma.photo.create({ data: { url: "https://example.test/private/" + tag, altText: "Receipt" } });
    await prisma.purchaseDocument.create({ data: { purchaseId: result.purchaseId, photoId: photo.id, kind: "RECEIPT", pageOrder: 1 } });
    const pack = await buildAuditPack("2026-03-01", "2026-03-31");
    const row = pack.rows.find((r) => r.serial === "SER-AUD-" + tag)!;
    expect(row).toMatchObject({ kind: "Appliance", receiptNumber: "R-AUD", priceCents: 10000, sellerTaxPaidCents: 500, useTaxReportedCents: 0 });
    expect(row.receipts[0]!.href).toBe("/api/photos/" + photo.id);
    expect(pack.rows.every((r) => r.purchasedOn! >= day("2026-03-01") && r.purchasedOn! < day("2026-04-01"))).toBe(true);
    const csv = auditPackCsv(pack);
    expect(csv).toContain("SER-AUD-" + tag);
    expect(csv).toContain("100.00");
    const parts = await buildAuditPack("2020-01-01", "2030-12-31");
    expect(parts.rows.some((r) => r.kind === "Part" && r.item.includes("Washer pump " + tag))).toBe(true);
  });

  it("a receipt page a filed return relies on is never removable; the only page is kept for the retention period", async () => {
    const filedPurchase = (await prisma.purchaseUseTax.findFirstOrThrow({ where: { status: "FILED", sourceType: "APPLIANCE" }, orderBy: { createdAt: "desc" } }));
    const filedAppliance = await prisma.appliance.findUniqueOrThrow({ where: { id: filedPurchase.sourceId }, select: { purchaseId: true } });
    const p1 = await prisma.photo.create({ data: { url: "https://example.test/private/f-" + tag, altText: "Receipt" } });
    const doc = await prisma.purchaseDocument.create({ data: { purchaseId: filedAppliance.purchaseId!, photoId: p1.id, kind: "RECEIPT", pageOrder: 1 } });
    await expect(removePurchaseDocument(ownerId, doc.id)).rejects.toThrow(/filed tax return/);
    await expect(prisma.photo.delete({ where: { id: p1.id } })).rejects.toThrow();
    const fresh = await record(ownerId, base({ purchasedOn: day("2026-10-01") }));
    const p2 = await prisma.photo.create({ data: { url: "https://example.test/private/n-" + tag, altText: "Receipt" } });
    const only = await prisma.purchaseDocument.create({ data: { purchaseId: fresh.purchaseId, photoId: p2.id, kind: "RECEIPT", pageOrder: 1 } });
    await expect(removePurchaseDocument(ownerId, only.id)).rejects.toThrow(/records are kept 7 years/);
    const p3 = await prisma.photo.create({ data: { url: "https://example.test/private/m-" + tag, altText: "Wrong page" } });
    const extra = await prisma.purchaseDocument.create({ data: { purchaseId: fresh.purchaseId, photoId: p3.id, kind: "RECEIPT", pageOrder: 2 } });
    await removePurchaseDocument(ownerId, extra.id);
    expect(await prisma.photo.count({ where: { id: p3.id } })).toBe(0);
  });

  it("the retention setting starts at 7 years, is owner-only, bounded, audited and compare-and-set", async () => {
    await expect(saveRecordRetentionYears(adminId, 8, 7)).rejects.toThrow();
    await expect(saveRecordRetentionYears(ownerId, 0, 7)).rejects.toThrow(/1 to 50/);
    await expect(saveRecordRetentionYears(ownerId, 51, 7)).rejects.toThrow(/1 to 50/);
    await saveRecordRetentionYears(ownerId, 10, 7);
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).recordRetentionYears).toBe(10);
    await expect(saveRecordRetentionYears(ownerId, 9, 7)).rejects.toThrow(/another session/);
    expect(await prisma.auditLog.count({ where: { userId: ownerId, action: "tax.record_retention.update" } })).toBe(1);
    await saveRecordRetentionYears(ownerId, 7, 10);
  });

  it("only owner and admin may upload purchase receipts, and only into a plausible folder", async () => {
    expect(await canUploadPhoto({ id: ownerId, role: "OWNER" }, "purchases/form-abc12345/receipt.pdf")).toBe(true);
    expect(await canUploadPhoto({ id: adminId, role: "ADMIN" }, "purchases/form-abc12345/receipt.pdf")).toBe(true);
    expect(await canUploadPhoto({ id: "s", role: "STAFF" }, "purchases/form-abc12345/receipt.pdf")).toBe(false);
    expect(await canUploadPhoto({ id: "c", role: "CUSTOMER" }, "purchases/form-abc12345/receipt.pdf")).toBe(false);
    expect(await canUploadPhoto({ id: ownerId, role: "OWNER" }, "purchases/x/receipt.pdf")).toBe(false);
    expect(await canUploadPhoto({ id: ownerId, role: "OWNER" }, "purchases/form-abc12345/sub/receipt.pdf")).toBe(false);
  });
});
