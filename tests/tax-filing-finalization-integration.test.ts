import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import {
  saveFilingEntryProgress, markPeriodFiled, detectTaxFilingAmendments,
  markAmendmentFiled, markAmendmentHandledOutside, buildFilingAmendmentPacket,
} from "@/domains/tax/filing";
import { buildFilingPacket, type FilingPacket } from "@/domains/tax/filing-packet";

const alerts = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/domains/messaging/owner-alerts", () => ({ sendOwnerAlert: alerts }));
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";
const day = (s: string) => businessDateFromKey(s)!;

describe("T-6b2 original filing and amendments (real Postgres)", () => {
  it("freezes an owner-approved return, reviews later changes without mutating it, and records corrections", async () => {
    const tag = randomUUID();
    const userId = "t6b2-customer-"+tag, customerId = "t6b2-cust-"+tag;
    const invoiceId = "t6b2-inv-"+tag, accountId = "t6b2-account-"+tag;
    const jurisdictionId = "t6b2-jur-"+tag;
    const owner = await prisma.user.findFirstOrThrow({
      where: { role: "OWNER", archivedAt: null }, select: { id: true },
    });
    let taxLineId = "";
    let periodId = "";
    let rateId = "";
    const amendIds: string[] = [];
    try {
      await prisma.user.create({
        data: { id: userId, email: "t6b2-"+tag+"@example.test", role: "CUSTOMER" },
      });
      await prisma.customer.create({ data: { id: customerId, userId, referralCode: tag.slice(0,8) } });
      await prisma.taxFilingAccount.create({
        data: { id: accountId, name: "Filing "+tag.slice(0,6), basis: "ACCRUAL", kind: "SALES_RETURN" },
      });
      await prisma.taxJurisdiction.create({
        data: {
          id: jurisdictionId, code: "FILING-"+tag.slice(0,8), name: "Greeley filing test",
          level: "CITY", administration: "SELF_COLLECTED", filingAccountId: accountId,
          reviewStatus: "REVIEWED",
        },
      });
      const rate = await prisma.taxRateVersion.create({
        data: { jurisdictionId, rateMilliPercent: 2900, effectiveFrom: day("2026-01-01"), source: "MANUAL" },
      });
      rateId = rate.id;
      const period = await prisma.taxFilingPeriod.create({
        data: { filingAccountId: accountId, periodStart: day("2026-10-01"),
          periodEnd: day("2026-10-31"), dueOn: day("2026-11-20"), legalDueOn: day("2026-11-20") },
      });
      periodId = period.id;
      await prisma.invoice.create({
        data: { id: invoiceId, customerId, status: "OPEN",
          subtotalCents: 10000, amountDueCents: 10290, taxCents: 290 },
      });
      const line = await prisma.invoiceTaxLine.create({
        data: { invoiceId, jurisdictionId, rateVersionId: rateId, category: "RENTAL",
          taxableCents: 10000, exemptCents: 0, taxCents: 290, source: "ENGINE" },
      });
      taxLineId = line.id;
      await expect(markPeriodFiled(owner.id, {
        periodId, filedOn: day("2026-11-18"), paidOn: day("2026-11-18"),
        confirmationNumber: "", amountPaidCents: 290,
      })).rejects.toThrow(/confirmation/i);
      await expect(markPeriodFiled(owner.id, {
        periodId, filedOn: day("2026-11-18"), paidOn: day("2026-11-18"),
        confirmationNumber: "CO-123", amountPaidCents: 289,
      })).rejects.toThrow(/Explain/i);
      await expect(markPeriodFiled(owner.id, {
        periodId, filedOn: day("2026-11-18"), paidOn: day("2026-11-18"),
        confirmationNumber: "CO-123", amountPaidCents: 290, confirmationPhotoId: "public-photo-id",
      })).rejects.toThrow(/private filing/i);
      await saveFilingEntryProgress(owner.id, { periodId, entryProgress: { gross: true, code: false } });
      await markPeriodFiled(owner.id, {
        periodId, filedOn: day("2026-11-18"), paidOn: day("2026-11-18"),
        confirmationNumber: "CO-123", amountPaidCents: 290,
      });
      const frozen = await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: periodId } });
      expect(frozen.status).toBe("FILED");
      expect(frozen.zeroReturn).toBe(false);
      expect(frozen.entryProgress).toEqual({ gross: true, code: false });
      expect((frozen.worksheet as unknown as FilingPacket).totals.taxCents).toBe(290);
      await expect(markPeriodFiled(owner.id, {
        periodId, filedOn: day("2026-11-18"), paidOn: day("2026-11-18"),
        confirmationNumber: "REPLAY", amountPaidCents: 290,
      })).rejects.toThrow(/already filed/);

      await prisma.invoiceTaxLine.update({ where: { id: taxLineId }, data: { taxCents: 300 } });
      expect(await detectTaxFilingAmendments(day("2026-11-22"))).toBe(1);
      expect(await detectTaxFilingAmendments(day("2026-11-23"))).toBe(1);
      let amendments = await prisma.taxFilingAmendment.findMany({ where: { periodId } });
      expect(amendments).toHaveLength(1);
      expect(amendments[0].additionalTaxCents).toBe(10);
      expect(amendments[0].detectedAt.toISOString()).toBe(day("2026-11-22").toISOString());
      amendIds.push(amendments[0].id);
      await expect(markAmendmentHandledOutside(owner.id, {
        amendmentId: amendments[0].id, reason: "Not eligible",
      })).rejects.toThrow(/Additional tax/);
      await markAmendmentFiled(owner.id, {
        amendmentId: amendments[0].id,
        filedOn: day("2026-11-22"), paidOn: day("2026-11-22"),
        confirmationNumber: "AMEND-1", amountPaidCents: 10,
      });
      await prisma.invoiceTaxLine.update({ where: { id: taxLineId }, data: { taxCents: 295 } });
      expect(await detectTaxFilingAmendments(day("2026-11-24"))).toBe(1);
      amendments = await prisma.taxFilingAmendment.findMany({
        where: { periodId }, orderBy: { sequence: "asc" },
      });
      expect(amendments).toHaveLength(2);
      expect(amendments[1].additionalTaxCents).toBe(-5);
      amendIds.push(amendments[1].id);
      await expect(markAmendmentHandledOutside(owner.id, {
        amendmentId: amendments[1].id, reason: "",
      })).rejects.toThrow(/Explain/i);
      await markAmendmentHandledOutside(owner.id, {
        amendmentId: amendments[1].id, reason: "Credit verified in state portal",
      });
      expect(await detectTaxFilingAmendments(day("2026-11-25"))).toBe(0);
      expect((await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: periodId } })).worksheet)
        .toEqual(frozen.worksheet);
      expect(await prisma.taxFilingAmendment.count({
        where: { periodId, status: "OPEN" },
      })).toBe(0);
      expect(await prisma.auditLog.count({
        where: { entityType: "TaxFilingPeriod", entityId: periodId, action: "tax.return_filed" },
      })).toBe(1);
    } finally {
      await prisma.auditLog.deleteMany({
        where: { OR: [
          { entityType: "TaxFilingPeriod", entityId: periodId },
          { entityType: "TaxFilingAmendment", entityId: { in: amendIds } },
        ] },
      });
      await prisma.taxFilingAmendment.deleteMany({ where: { periodId } });
      if (taxLineId) await prisma.invoiceTaxLine.deleteMany({ where: { id: taxLineId } });
      await prisma.invoice.deleteMany({ where: { id: invoiceId } });
      if (periodId) await prisma.taxFilingPeriod.deleteMany({ where: { id: periodId } });
      if (rateId) await prisma.taxRateVersion.deleteMany({ where: { id: rateId } });
      await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
      await prisma.taxFilingAccount.deleteMany({ where: { id: accountId } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });
});

describe("T-6b2 amendment math", () => {
  it("compares stored rows, omits viewing-day changes, and never awards a service fee on additional tax", () => {
    const make = (taxCents: number, remitCents: number) => buildFilingPacket({
      account: { id: "a", name: "CO", kind: "SALES_RETURN", accountNumber: null, portalUrl: null, deductionLabels: {} },
      period: { start: day("2026-09-01"), end: day("2026-09-30"),
        dueOn: day("2026-10-20"), legalDueOn: day("2026-10-20") },
      basis: "ACCRUAL",
      viewedOn: day("2026-10-25"),
      rows: [{ jurisdictionId: "co", name: "CO", filingCode: null,
        administration: "STATE_COLLECTED", grossSalesCents: 10000,
        deductions: [], netTaxableCents: 10000, rateMilliPercent: 2900,
        taxCents, serviceFeeCents: 20, remitCents }],
      useTax: [],
    });
    const diff = buildFilingAmendmentPacket(make(290, 270), make(295, 275));
    expect(diff.additionalTaxCents).toBe(5);
    expect(diff.differences.find(d => d.key.endsWith(":TAX"))?.differenceCents).toBe(5);
    expect(diff.corrected.totals.taxCents).toBe(295);
    // Additional tax paid is 5, not 5 minus a newly calculated service fee.
    expect(diff.additionalTaxCents).toBe(5);
    expect(buildFilingAmendmentPacket(make(290, 270), make(290, 290)).differences).toHaveLength(0);
  });
});
