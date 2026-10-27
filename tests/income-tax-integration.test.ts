import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { computeScheduleCYear, packetCsv, packetPdf } from "@/domains/compliance/schedule-c";
import { build4562Worksheet, build4797Worksheet } from "@/domains/compliance/worksheets";
import { estimateQuarterlyTax } from "@/domains/compliance/estimates";
import { getTaxYearFacts, saveTaxYearFacts } from "@/domains/compliance/tax-facts";
import { compute1099KTieOut } from "@/domains/compliance/k-reconciliation";

// Disposable CI Postgres only (same gate as the other integration tests).
const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const enabled =
  process.env.CI === "true" &&
  url !== null &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const day = (s: string) => businessDateFromKey(s)!;
const YEAR = 2024; // a year no other suite uses, so the books totals are this file's alone

describe.skipIf(!enabled)("CMP-2 income tax helpers", () => {
  const tag = randomUUID().slice(0, 8);
  let ownerId: string;
  let staffId: string;
  const typeId = `cmp2-type-${tag}`;
  const applianceWithEvidence = `cmp2-app1-${tag}`;
  const applianceNoEvidence = `cmp2-app2-${tag}`;
  const applianceSold = `cmp2-app3-${tag}`;
  const customerUser = `cmp2-u-${tag}`;
  const customer = `cmp2-c-${tag}`;
  const invoiceId = `cmp2-inv-${tag}`;
  const customAccountId = `cmp2-acct-${tag}`;
  const entryIds: string[] = [];
  const stripeIds: string[] = [];

  async function account(systemRole: string) {
    return prisma.ledgerAccount.findUniqueOrThrow({ where: { systemRole } });
  }

  async function journal(sourceId: string, lines: Array<{ accountId: string; debit: number; credit: number }>) {
    const entry = await prisma.journalEntry.create({
      data: {
        entryDate: day("2024-03-10"),
        periodKey: "2024-03",
        sourceType: "EXPENSE",
        sourceId,
        eventKind: "CMP2_TEST",
        memo: "CMP-2 test entry",
        lines: { create: lines.map((l) => ({ ledgerAccountId: l.accountId, debitCents: l.debit, creditCents: l.credit })) },
      },
    });
    entryIds.push(entry.id);
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    const staff = await prisma.user.create({
      data: { id: `cmp2-staff-${tag}`, email: `cmp2-staff-${tag}@example.test`, role: "STAFF" },
    });
    staffId = staff.id;
    await prisma.applianceType.create({ data: { id: typeId, name: `CMP2 Type ${tag}`, slug: `cmp2-type-${tag}` } });
    for (const [id, assetNumber] of [
      [applianceWithEvidence, `C2A-${tag}`],
      [applianceNoEvidence, `C2B-${tag}`],
      [applianceSold, `C2C-${tag}`],
    ] as const) {
      await prisma.appliance.create({
        data: { id, assetNumber, applianceTypeId: typeId, status: "RETIRED", manufacturer: "Maytag", model: "MVWB" },
      });
    }
    await prisma.user.create({ data: { id: customerUser, email: `${customerUser}@example.test`, role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customer, userId: customerUser, referralCode: `C2X${tag}`.toUpperCase() } });
    await prisma.invoice.create({ data: { id: invoiceId, customerId: customer, status: "PAID", amountDueCents: 0 } });
  });

  afterAll(async () => {
    await prisma.retiredSaleDisposition.deleteMany({ where: { applianceId: { in: [applianceWithEvidence, applianceNoEvidence, applianceSold] } } });
    await prisma.bookTaxEvidence.deleteMany({ where: { applianceId: { in: [applianceWithEvidence, applianceNoEvidence, applianceSold] } } });
    await prisma.bookAsset.deleteMany({ where: { applianceId: { in: [applianceWithEvidence, applianceNoEvidence, applianceSold] } } });
    await prisma.stripeBalanceTransaction.deleteMany({ where: { id: { in: stripeIds } } });
    await prisma.journalLine.deleteMany({ where: { entryId: { in: entryIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    await prisma.ledgerAccount.deleteMany({ where: { id: customAccountId } });
    await prisma.taxYearFacts.deleteMany({ where: { year: { in: [YEAR, 2030] } } });
    await prisma.invoice.deleteMany({ where: { id: invoiceId } });
    await prisma.customer.deleteMany({ where: { id: customer } });
    await prisma.appliance.deleteMany({ where: { id: { in: [applianceWithEvidence, applianceNoEvidence, applianceSold] } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.user.deleteMany({ where: { id: { in: [staffId, customerUser] } } });
  });

  it("Schedule C year totals land on the mapped lines; an unmapped account falls to 27a by name", async () => {
    const rental = await account("RENTAL_INCOME");
    const supplies = await account("EXPENSE_SUPPLIES");
    const bank = await account("BANK");
    await prisma.ledgerAccount.create({
      data: { id: customAccountId, name: `Odd expense ${tag}`, type: "EXPENSE", description: "CMP-2 test account" },
    });
    await journal(`cmp2-j1-${tag}`, [
      { accountId: bank.id, debit: 500000, credit: 0 },
      { accountId: rental.id, debit: 0, credit: 500000 },
    ]);
    await journal(`cmp2-j2-${tag}`, [
      { accountId: supplies.id, debit: 30000, credit: 0 },
      { accountId: bank.id, debit: 0, credit: 30000 },
    ]);
    await journal(`cmp2-j3-${tag}`, [
      { accountId: customAccountId, debit: 12345, credit: 0 },
      { accountId: bank.id, debit: 0, credit: 12345 },
    ]);
    const result = await computeScheduleCYear(YEAR);
    const line = (n: string) => result.lines.find((l) => l.line === n)!;
    expect(line("1").cents).toBe(500000);
    expect(line("22").cents).toBe(30000);
    expect(line("27a").cents).toBe(12345);
    expect(line("27a").accounts.map((a) => a.name)).toContain(`Odd expense ${tag}`);
    expect(result.totalIncomeCents).toBe(500000);
    expect(result.totalExpensesCents).toBe(42345);
    expect(result.netProfitCents).toBe(457655);
  });

  it("the packet CSV and PDF carry the same prepared numbers", async () => {
    await prisma.stripeBalanceTransaction.create({
      data: {
        id: `cmp2-txn-${tag}`, type: "charge", reportingCategory: "charge",
        amountCents: 100000, feeCents: 3000, netCents: 97000, currency: "usd",
        createdAtStripe: new Date("2024-01-15T10:00:00Z"), availableOn: new Date("2024-01-17T10:00:00Z"),
      },
    });
    stripeIds.push(`cmp2-txn-${tag}`);
    await saveTaxYearFacts(ownerId, YEAR, { form1099KGrossCents: 100000 });
    const packet = {
      year: YEAR,
      scheduleC: await computeScheduleCYear(YEAR),
      tieOut: await compute1099KTieOut(YEAR),
      worksheet4562: await build4562Worksheet(YEAR),
      worksheet4797: await build4797Worksheet(YEAR),
      homeOffice: false,
    };
    expect(packet.tieOut.differenceCents).toBe(0);
    const csv = packetCsv(packet);
    expect(csv).toContain(`Schedule C — ${YEAR}`);
    expect(csv).toContain("1099-K tie-out");
    const pdf = await packetPdf(packet);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("the 1099-K tie-out shows the difference once the typed amount disagrees", async () => {
    await saveTaxYearFacts(ownerId, YEAR, { form1099KGrossCents: 95000 });
    const tieOut = await compute1099KTieOut(YEAR);
    expect(tieOut.chargesCents).toBe(100000);
    expect(tieOut.reportedGrossCents).toBe(95000);
    expect(tieOut.differenceCents).toBe(5000);
  });

  it("the 4562 worksheet uses recorded tax evidence and flags assets without it", async () => {
    await prisma.bookAsset.create({
      data: { applianceId: applianceWithEvidence, costCents: 100000, placedInServiceOn: day("2024-03-01"), lifeMonths: 60, salvagePercent: 0, createdByUserId: ownerId },
    });
    await prisma.bookTaxEvidence.create({
      data: {
        applianceId: applianceWithEvidence, classification: "RENTAL_ASSET", confidence: "CPA_CONFIRMED",
        originalBasisCents: 100000, allowedDepreciationCents: 20000, section179Cents: 30000, bonusDepreciationCents: 10000,
        evidenceAsOf: day("2024-04-01"), sourceReference: "CPA worksheet", recordedByUserId: ownerId,
      },
    });
    await prisma.bookAsset.create({
      data: { applianceId: applianceNoEvidence, costCents: 50000, placedInServiceOn: day("2024-06-01"), lifeMonths: 60, salvagePercent: 0, createdByUserId: ownerId },
    });
    const worksheet = await build4562Worksheet(YEAR);
    const evidenced = worksheet.rows.find((r) => r.assetNumber === `C2A-${tag}`)!;
    expect(evidenced.section179Cents).toBe(30000);
    expect(evidenced.bonusCents).toBe(10000);
    expect(evidenced.needsReview).toBe(false);
    const bare = worksheet.rows.find((r) => r.assetNumber === `C2B-${tag}`)!;
    expect(bare.section179Cents).toBeNull();
    expect(bare.needsReview).toBe(true);
    expect(worksheet.totalCostCents).toBe(150000);
  });

  it("the 4797 worksheet reports the estimate frozen at sale time and skips cancelled sales", async () => {
    const base = {
      applianceId: applianceSold, invoiceId, priceCents: 25000, sellerCostsCents: 0, bookCarriedCents: 20000,
      taxStatus: "CPA_CONFIRMED_ESTIMATE", adjustedBasisCents: 20000, totalDepreciationCents: 80000,
      taxGainCents: 5000, potentialRecaptureCents: 5000, otherGainCents: 0, reviewReasons: [], createdByUserId: ownerId,
    };
    await prisma.retiredSaleDisposition.create({ data: { ...base, saleDate: day("2024-05-01") } });
    await prisma.retiredSaleDisposition.create({
      data: { ...base, saleDate: day("2024-06-01"), cancelledAt: new Date(), invoiceId: invoiceId, applianceId: applianceNoEvidence },
    }).catch(() => undefined); // unique (invoiceId, applianceId) differs, so this creates; cancelled rows are excluded below
    const worksheet = await build4797Worksheet(YEAR);
    const rows = worksheet.rows.filter((r) => r.assetNumber === `C2C-${tag}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.taxGainCents).toBe(5000);
    expect(rows[0]!.potentialRecaptureCents).toBe(5000);
    expect(worksheet.rows.some((r) => r.assetNumber === `C2B-${tag}`)).toBe(false);
  });

  it("quarterly estimates follow the safe harbor, and a missing prior year refuses a number", async () => {
    await saveTaxYearFacts(ownerId, 2030, { federalTaxCents: 400000, federalAgiCents: 9000000, coloradoTaxCents: 200000 });
    const federal = await estimateQuarterlyTax(2031, 1, "FEDERAL");
    expect(federal).toMatchObject({ status: "OK", ratePercent: 100, annualCents: 400000, quarterCents: 100000 });
    const colorado = await estimateQuarterlyTax(2031, 2, "COLORADO");
    expect(colorado).toMatchObject({ status: "OK", ratePercent: 100, quarterCents: 50000 });
    // Over the AGI line both jurisdictions use 110% (Colorado keys off federal AGI).
    await saveTaxYearFacts(ownerId, 2030, { federalAgiCents: 20000000 });
    expect(await estimateQuarterlyTax(2031, 1, "FEDERAL")).toMatchObject({ ratePercent: 110, quarterCents: 110000 });
    expect(await estimateQuarterlyTax(2031, 1, "COLORADO")).toMatchObject({ ratePercent: 110, quarterCents: 55000 });
    // No 2032 facts on file: 2033 gets words, not a number.
    const missing = await estimateQuarterlyTax(2033, 1, "FEDERAL");
    expect(missing.status).toBe("NO_PRIOR_YEAR");
    expect((await getTaxYearFacts(2030))?.federalTaxCents).toBe(400000);
  });

  it("only the owner can save tax-year facts", async () => {
    await expect(saveTaxYearFacts(staffId, 2030, { federalTaxCents: 1 })).rejects.toThrow();
  });
});
