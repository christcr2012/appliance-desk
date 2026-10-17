import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(async () => ({ user: { id: "w9-owner", role: "OWNER" } })),
}));
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));

import { businessDateFromKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { listTaxFilingAttention } from "@/domains/tax/filing-attention";
import { markPeriodFiled } from "@/domains/tax/filing";
import { collectSystemIssueInputs } from "@/domains/system-issues/sources";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";
const day = (s: string) => businessDateFromKey(s)!;

describe.skipIf(!enabled)("W-9 filing autopilot (real Postgres)", () => {
  const token = randomUUID();
  const tag = token.slice(0, 8);
  const ownerId = "w9-owner-" + token;
  const accountIds: string[] = [];
  const jurisdictionIds: string[] = [];

  async function useTaxAccount(label: string, purchaseCents: number, dueCents: number) {
    const accountId = `w9-acct-${label}-${token}`;
    const jurisdictionId = `w9-jur-${label}-${token}`;
    accountIds.push(accountId);
    jurisdictionIds.push(jurisdictionId);
    await prisma.taxFilingAccount.create({ data: {
      id: accountId, name: `W9 ${label} ${tag}`, kind: "USE_TAX_RETURN", basis: "ACCRUAL",
      firstPeriodStart: day("2026-09-01"),
    } });
    await prisma.taxJurisdiction.create({ data: {
      id: jurisdictionId, code: `W9-${label}-${tag}`, name: `W9 area ${label}`,
      level: "CITY", administration: "SELF_COLLECTED", reviewStatus: "REVIEWED",
      useTaxFilingAccountId: accountId,
    } });
    const period = await prisma.taxFilingPeriod.create({ data: {
      filingAccountId: accountId, periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"),
      dueOn: day("2026-10-20"), legalDueOn: day("2026-10-20"),
    } });
    if (purchaseCents > 0) {
      const rate = await prisma.taxRateVersion.create({ data: {
        jurisdictionId, rateMilliPercent: 5000, effectiveFrom: day("2026-01-01"), source: "MANUAL",
      } });
      await prisma.purchaseUseTax.create({ data: {
        sourceType: "APPLIANCE", sourceId: `w9-${label}-${token}`, purchasedOn: day("2026-09-18"),
        purchaseAmountCents: purchaseCents, vendorTaxCents: 0, useTaxDueCents: dueCents,
        jurisdictionId, rateVersionId: rate.id, status: "DUE", filingPeriodId: period.id,
      } });
    }
    return { accountId, periodId: period.id };
  }

  async function ensureOwner() {
    await prisma.user.upsert({
      where: { id: ownerId }, update: {},
      create: { id: ownerId, email: `w9-${token}@example.test`, role: "OWNER" },
    });
  }

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
    await prisma.purchaseUseTax.deleteMany({ where: { jurisdictionId: { in: jurisdictionIds } } });
    await prisma.taxFilingPeriod.deleteMany({ where: { filingAccountId: { in: accountIds } } });
    await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId: { in: jurisdictionIds } } });
    await prisma.taxJurisdiction.deleteMany({ where: { id: { in: jurisdictionIds } } });
    await prisma.taxFilingAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("puts 'File and pay $X on SUTS by <date>' on the list the day the period closes, with 'overdue' after the legal date", async () => {
    const { periodId } = await useTaxAccount("owed", 10000, 500);
    const early = await listTaxFilingAttention(day("2026-10-02"));
    const row = early.returns.rows.find((item) => item.href.endsWith(periodId));
    expect(row?.title).toBe("File and pay $5.00 on SUTS by Oct 20");
    expect(row?.href).toBe(`/desk/sales-tax/returns/${periodId}`);

    const late = await listTaxFilingAttention(day("2026-10-22"));
    const lateRow = late.returns.rows.find((item) => item.href.endsWith(periodId));
    expect(lateRow?.title).toMatch(/^File and pay \$[\d,.]+ on SUTS by Oct 20 \(overdue\)$/);
    expect(lateRow?.severity).toBe("high");
  });

  it("says 'File a $0 return' when nothing is owed, because a $0 return still has to be filed", async () => {
    const { periodId } = await useTaxAccount("zero", 0, 0);
    const result = await listTaxFilingAttention(day("2026-10-02"));
    const row = result.returns.rows.find((item) => item.href.endsWith(periodId));
    expect(row?.title).toBe("File a $0 return on SUTS by Oct 20");
  });

  it("'I filed and paid it' needs only the date paid and the confirmation number", async () => {
    await ensureOwner();
    const { periodId } = await useTaxAccount("simple", 10000, 500);
    await markPeriodFiled(ownerId, {
      periodId, paidOn: day("2026-10-05"), confirmationNumber: "CONF-" + tag,
    });
    const filed = await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: periodId } });
    expect(filed.status).toBe("FILED");
    expect(filed.filedOn?.getTime()).toBe(day("2026-10-05").getTime());
    expect(filed.paidOn?.getTime()).toBe(day("2026-10-05").getTime());
    expect(filed.amountPaidCents).toBe(500);
    expect(filed.confirmationNumber).toBe("CONF-" + tag);
    const rows = await prisma.purchaseUseTax.findMany({ where: { filingPeriodId: periodId } });
    expect(rows.every((row) => row.status === "FILED")).toBe(true);
    // A filed return leaves the list.
    const after = await listTaxFilingAttention(day("2026-10-06"));
    expect(after.returns.rows.some((item) => item.href.endsWith(periodId))).toBe(false);
  });

  it("still requires a reason when the website charged a different amount, and a confirmation number always", async () => {
    await ensureOwner();
    const { periodId } = await useTaxAccount("differs", 10000, 500);
    await expect(markPeriodFiled(ownerId, {
      periodId, paidOn: day("2026-10-05"), confirmationNumber: "  ",
    })).rejects.toThrow(/confirmation number/i);
    await expect(markPeriodFiled(ownerId, {
      periodId, paidOn: day("2026-10-05"), confirmationNumber: "C-" + tag, amountPaidCents: 450,
    })).rejects.toThrow(/Explain why/);
    expect((await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: periodId } })).status).toBe("OPEN");
    await markPeriodFiled(ownerId, {
      periodId, paidOn: day("2026-10-05"), filedOn: day("2026-10-04"), confirmationNumber: "C-" + tag,
      amountPaidCents: 450, amountDifferentReason: "Website applied a $0.50 discount",
    });
    const filed = await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: periodId } });
    expect(filed.amountPaidCents).toBe(450);
    expect(filed.filedOn?.getTime()).toBe(day("2026-10-04").getTime());
  });

  it("the nightly health check raises a high issue for a closed period with no return, and clears it once the return exists", async () => {
    const accountId = `w9-missing-${token}`;
    accountIds.push(accountId);
    await prisma.taxFilingAccount.create({ data: {
      id: accountId, name: `W9 missing ${tag}`, kind: "SALES_RETURN", basis: "ACCRUAL",
      frequency: "MONTHLY", firstPeriodStart: day("2026-08-01"),
    } });
    const now = day("2026-10-12");
    const before = await collectSystemIssueInputs(now, { limit: 100 });
    const issue = before.issues.find((item) => item.kind === "TAX_PERIOD_MISSING");
    expect(issue && issue.kind === "TAX_PERIOD_MISSING" ? issue.count : 0).toBeGreaterThanOrEqual(2);
    const baseline = issue && issue.kind === "TAX_PERIOD_MISSING" ? issue.count : 0;

    await prisma.taxFilingPeriod.createMany({ data: [
      { filingAccountId: accountId, periodStart: day("2026-08-01"), periodEnd: day("2026-08-31"), dueOn: day("2026-09-20") },
      { filingAccountId: accountId, periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"), dueOn: day("2026-10-20") },
    ] });
    const after = await collectSystemIssueInputs(now, { limit: 100 });
    const remaining = after.issues.find((item) => item.kind === "TAX_PERIOD_MISSING");
    const remainingCount = remaining && remaining.kind === "TAX_PERIOD_MISSING" ? remaining.count : 0;
    expect(remainingCount).toBe(baseline - 2);
    if (remainingCount === 0) expect(after.clearFingerprints).toContain("tax-period-missing");
  });
});
