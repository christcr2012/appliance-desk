// PLAN scenario 13 (BATCH-F WU-F3): one receipt for four appliances is recorded without seller tax, so use tax is owed to the
// city. The month closes, the File now steps carry the same totals as the filing packet, the owner records the filing with the
// state's confirmation, and the audit pack for that month lists every serial with the same tax. Integer cents throughout.
// The business tax location and the lease election are borrowed for the test and put back afterwards. Disposable database only.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/domains/messaging/owner-alerts", () => ({ sendOwnerAlert: vi.fn(async () => {}) }));
vi.mock("@/lib/session", () => ({ requireRole: vi.fn(async () => ({ user: { id: "test-owner", role: "OWNER" } })) }));
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { getPurchaseDetail, recordPurchase } from "@/domains/purchasing/purchases";
import { getApplianceTaxProof, buildAuditPack, auditPackCsv } from "@/domains/tax/tax-proof";
import { loadFilingPacket } from "@/domains/tax/filing-packet";
import { markPeriodFiled } from "@/domains/tax/filing";
import { buildUseTaxFileNow } from "@/domains/tax/use-tax-file-now";
import { purgeScenarioQueues } from "../helpers/scenario-order";
const scenarioStartedAt = new Date();

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
const day = (s: string) => businessDateFromKey(s)!;
const tag = randomUUID().replaceAll("-", "");
const ownerId = `sc13-owner-${tag}`;
const typeId = `sc13-type-${tag}`;
const supplierId = `sc13-supplier-${tag}`;
const jurId = `sc13-jur-${tag}`;
const accountId = `sc13-account-${tag}`;
const locationId = `sc13-location-${tag}`;

describe.skipIf(!enabled)("scenario 13: purchase receipt to use tax, filing and the audit pack", () => {
  let oldLocations: string[] = [];
  let oldElection: "UNDECIDED" | "PAY_ON_ACQUISITION" | "COLLECT_ON_RENTALS" | null = null;
  let oldRetention = 7;
  const purchaseIds: string[] = [];
  const periodIds: string[] = [];
  const prices = [40000, 25000, 20000, 15000];
  const serials = prices.map((_, i) => `SC13-${i}-${tag}`);

  beforeAll(async () => {
    oldLocations = (await prisma.addressTaxLocation.findMany({ where: { forBusinessLocation: true, isCurrent: true }, select: { id: true } })).map((r) => r.id);
    const settings = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { shortTermLeaseElection: true, recordRetentionYears: true } });
    oldElection = settings?.shortTermLeaseElection ?? null;
    oldRetention = settings?.recordRetentionYears ?? 7;
    await prisma.user.create({ data: { id: ownerId, email: `sc13-${tag}@example.test`, name: "SC13 Owner", role: "OWNER" } });
    await prisma.applianceType.create({ data: { id: typeId, name: "SC13 washer", slug: `sc13-${tag}`, monthlyPriceCents: 1500 } });
    await prisma.supplier.create({ data: { id: supplierId, name: `Scenario Supplier ${tag}` } });
    await prisma.businessSettings.upsert({ where: { id: "singleton" }, create: { shortTermLeaseElection: "PAY_ON_ACQUISITION" }, update: { shortTermLeaseElection: "PAY_ON_ACQUISITION", recordRetentionYears: 7 } });
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: oldLocations } }, data: { isCurrent: false } });
    await prisma.taxFilingAccount.create({ data: { id: accountId, name: `Scenario use tax ${tag}`, kind: "USE_TAX_RETURN", basis: "ACCRUAL", firstPeriodStart: day("2026-01-01") } });
    await prisma.taxJurisdiction.create({ data: { id: jurId, code: `S13-${tag.slice(0, 6)}`, name: "Scenario city", level: "CITY", administration: "SELF_COLLECTED", reviewStatus: "REVIEWED", useTaxFilingAccountId: accountId } });
    await prisma.taxRateVersion.create({ data: { jurisdictionId: jurId, rateMilliPercent: 5000, effectiveFrom: day("2026-01-01"), source: "MANUAL" } });
    await prisma.addressTaxLocation.create({ data: { id: locationId, forBusinessLocation: true, isCurrent: true, status: "VERIFIED", source: "MANUAL", lookedUpAt: day("2026-09-01"), jurisdictions: { create: [{ jurisdictionId: jurId }] } } });
  });
  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    const purchases = await prisma.purchase.findMany({ where: { id: { in: purchaseIds } }, select: { appliances: { select: { id: true } } } });
    const applianceIds = purchases.flatMap((p) => p.appliances.map((a) => a.id));
    await prisma.taxFilingAmendment.deleteMany({ where: { periodId: { in: periodIds } } });
    await prisma.purchaseUseTax.deleteMany({ where: { sourceType: "APPLIANCE", sourceId: { in: applianceIds } } });
    await prisma.taxFilingPeriod.deleteMany({ where: { id: { in: periodIds } } });
    await prisma.purchaseDocument.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
    await prisma.assetNumberCounter.deleteMany({ where: { prefix: { in: ["SC13"] } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.addressTaxLocation.deleteMany({ where: { id: locationId } });
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: oldLocations } }, data: { isCurrent: true } });
    await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId: jurId } });
    await prisma.taxJurisdiction.deleteMany({ where: { id: jurId } });
    await prisma.taxFilingAccount.deleteMany({ where: { id: accountId } });
    if (oldElection !== null) await prisma.businessSettings.update({ where: { id: "singleton" }, data: { shortTermLeaseElection: oldElection, recordRetentionYears: oldRetention } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("four appliances on one receipt owe 5% use tax each; the return, File now steps, filing and audit pack all agree", async () => {
    // 1. One receipt, four appliances, no seller tax: the owner answers "no tax was charged".
    const result = await recordPurchase(ownerId, {
      operationKey: `form-${randomUUID()}`, supplierId, purchasedOn: day("2026-08-12"), reference: `R-13-${tag.slice(0, 6)}`, taxAnswer: "NO", sellerTaxCents: 0, otherChargesCents: 0,
      documents: [], appliances: prices.map((priceCents, i) => ({ applianceTypeId: typeId, serialNumber: serials[i], priceCents })),
    });
    purchaseIds.push(result.purchaseId);
    expect(result.appliances).toHaveLength(4);
    expect(result.subtotalCents).toBe(100000);
    expect(result.receiptTotalCents).toBe(100000);
    const rows = await prisma.purchaseUseTax.findMany({ where: { sourceType: "APPLIANCE", sourceId: { in: result.appliances.map((a) => a.id) } }, orderBy: { useTaxDueCents: "desc" } });
    expect(rows.map((r) => r.useTaxDueCents)).toEqual([2000, 1250, 1000, 750]);
    expect(rows.reduce((s, r) => s + r.useTaxDueCents, 0)).toBe(5000);
    expect((await getPurchaseDetail(result.purchaseId))!.appliances.every((a) => a.step.kind === "USE_TAX_ON_RETURN")).toBe(true);

    // 2. The month closes into a return period; the packet carries the same totals.
    const period = await prisma.taxFilingPeriod.create({ data: { filingAccountId: accountId, periodStart: day("2026-08-01"), periodEnd: day("2026-08-31"), dueOn: day("2026-09-20") } });
    periodIds.push(period.id);
    const loaded = await loadFilingPacket(period.id, day("2026-09-22"));
    if (loaded.status !== "READY") throw new Error(loaded.problems.join(" "));
    const packet = loaded.packet;
    expect(packet.useTax).toEqual([expect.objectContaining({ jurisdictionId: jurId, purchaseCents: 100000, useTaxCents: 5000 })]);
    expect(packet.totals.taxCents).toBe(5000);

    // 3. File now: the ordered steps repeat exactly those numbers, and nothing is submitted for the owner.
    const steps = buildUseTaxFileNow(packet);
    const allItems = steps.flatMap((s) => s.items);
    expect(allItems.find((i) => i.label.startsWith("Line 1,"))!.value).toBe("$1,000.00");
    expect(allItems.some((i) => i.value === "$50.00")).toBe(true);
    expect(await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: period.id } })).toMatchObject({ status: "OPEN" });

    // 4. The owner files on the state's site and records the confirmation; the amount paid must be the calculated amount.
    const confirmation = `SC13-${tag.slice(0, 8)}`;
    await markPeriodFiled(ownerId, { periodId: period.id, filedOn: day("2026-09-22"), paidOn: day("2026-09-22"), confirmationNumber: confirmation, amountPaidCents: packet.totals.remitIfOnTimeCents });
    expect((await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: period.id } })).status).toBe("FILED");
    const filed = await prisma.purchaseUseTax.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
    expect(filed.map((r) => r.status)).toEqual(["FILED", "FILED", "FILED", "FILED"]);
    await expect(markPeriodFiled(ownerId, { periodId: period.id, filedOn: day("2026-09-22"), paidOn: day("2026-09-22"), confirmationNumber: "AGAIN" })).rejects.toThrow(/already filed/);

    // 5. The audit pack for August lists every serial with the same tax, a spreadsheet with them all, and each appliance's proof says filed.
    const pack = await buildAuditPack("2026-08-01", "2026-08-31");
    const mine = pack.rows.filter((r) => serials.includes(r.serial ?? ""));
    expect(mine.map((r) => r.serial).sort()).toEqual([...serials].sort());
    expect(mine.map((r) => r.priceCents).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([...prices].sort((a, b) => a - b));
    expect(mine.reduce((s, r) => s + r.useTaxReportedCents, 0)).toBe(5000);
    expect(mine.reduce((s, r) => s + (r.priceCents ?? 0), 0)).toBe(100000);
    const csv = auditPackCsv(pack);
    for (const serial of serials) expect(csv).toContain(serial);
    for (const appliance of result.appliances) {
      const proof = (await getApplianceTaxProof(appliance.id))!;
      expect(proof.step.kind).toBe("USE_TAX_FILED");
      expect(proof.useTaxRows[0]!.confirmationNumber).toBe(confirmation);
    }
  });
});
