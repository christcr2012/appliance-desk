import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async () => ({ user: { id: "test-owner", role: "OWNER" } })),
}));
import { prisma } from "@/lib/prisma";
import { listAcquisitionTaxAttention } from "@/domains/tax/acquisition-attention";
import { assignDueUseTaxRowsToPeriod } from "@/domains/tax/use-tax";
import { businessDateFromKey } from "@/lib/business-date";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname)
  && url.pathname === "/appliance_desk_test";
const tag = randomUUID().slice(0, 8);
const jur = "w0a-unlinked-" + tag, account = "w0a-account-" + tag;
const date = (d: string) => businessDateFromKey(d)!;
describe.skipIf(!enabled)("W-0A unlinked use tax (Postgres)", () => {
  let rateId = "", periodId = "", taxId = "";
  beforeAll(async () => {
    await prisma.taxFilingAccount.create({ data: {
      id: account, name: "W0A use account " + tag, kind: "USE_TAX_RETURN", basis: "ACCRUAL",
    } });
    await prisma.taxJurisdiction.create({ data: {
      id: jur, code: "W0U-" + tag, name: "Unlinked use " + tag,
      level: "CITY", administration: "SELF_COLLECTED", reviewStatus: "REVIEWED",
    } });
    const rate = await prisma.taxRateVersion.create({ data: {
      jurisdictionId: jur, rateMilliPercent: 5000, effectiveFrom: date("2026-01-01"), source: "MANUAL",
    } });
    rateId = rate.id;
    const row = await prisma.purchaseUseTax.create({ data: {
      sourceType: "EXPENSE", sourceId: "test-" + tag, purchasedOn: date("2026-09-14"),
      purchaseAmountCents: 10000, vendorTaxCents: 0,
      jurisdictionId: jur, rateVersionId: rateId, useTaxDueCents: 500, status: "DUE",
    } });
    taxId = row.id;
  });
  afterAll(async () => {
    await prisma.purchaseUseTax.deleteMany({ where: { id: taxId } });
    if (periodId) await prisma.taxFilingPeriod.delete({ where: { id: periodId } });
    await prisma.taxRateVersion.delete({ where: { id: rateId } });
    await prisma.taxJurisdiction.delete({ where: { id: jur } });
    await prisma.taxFilingAccount.delete({ where: { id: account } });
  });
  it("DUE with no use-tax account is a high Today action", async () => {
    const list = await listAcquisitionTaxAttention(date("2026-10-08"));
    expect(list).toContainEqual(expect.objectContaining({
      category: "PURCHASE_USE_TAX_DUE", severity: "high",
      href: "/desk/sales-tax/setup#accounts",
      title: expect.stringContaining("Unlinked use " + tag),
    }));
  });
  it("linking a use-tax account attaches old rows to its OPEN period", async () => {
    const period = await prisma.taxFilingPeriod.create({ data: {
      filingAccountId: account, periodStart: date("2026-09-01"),
      periodEnd: date("2026-09-30"), dueOn: date("2026-10-20"),
    } });
    periodId = period.id;
    await prisma.taxJurisdiction.update({ where: { id: jur },
      data: { useTaxFilingAccountId: account } });
    const attached = await prisma.$transaction(tx => assignDueUseTaxRowsToPeriod(tx, period.id));
    expect(attached).toBe(1);
    expect((await prisma.purchaseUseTax.findUniqueOrThrow({ where: { id: taxId } }))
      .filingPeriodId).toBe(period.id);
  });
});
