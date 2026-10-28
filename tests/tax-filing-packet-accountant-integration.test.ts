import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ACCT-1 (Codex round on PR #706): the live filing-packet loader behind an unfiled return
// refused the accountant even though the return page admits the role. The loader now admits
// ACCOUNTANT for the read; assigning due use-tax rows to the period stays owner-only.
// The session is mocked (the loader reads it via requireRole); data runs on real Postgres.
const session = vi.hoisted(() => ({ role: "OWNER" as string, id: "packet-owner" as string }));
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async (...roles: string[]) => {
    if (!roles.includes(session.role)) throw new Error("That page is not available for this role.");
    return { user: { id: session.id, role: session.role } };
  }),
}));

import { prisma } from "@/lib/prisma";
import { loadFilingPacket } from "@/domains/tax/filing-packet";
import { businessDateFromKey } from "@/lib/business-date";

const urlText = process.env.DATABASE_URL ?? "";
let enabled = false;
try {
  const u = new URL(urlText);
  enabled = process.env.CI === "true" && u.pathname === "/appliance_desk_test" && ["localhost", "127.0.0.1"].includes(u.hostname);
} catch { enabled = false; }

const tag = randomUUID().slice(0, 10);
const accountId = "packet-acct-" + tag;
const jurisdictionId = "packet-jur-" + tag;
const rateId = "packet-rate-" + tag;
const periodId = "packet-period-" + tag;
const rowId = "packet-row-" + tag;
const day = (s: string) => businessDateFromKey(s)!;

describe.skipIf(!enabled)("ACCT-1 live filing packet: accountant reads, only the owner assigns use tax", () => {
  beforeAll(async () => {
    await prisma.taxFilingAccount.create({
      data: { id: accountId, name: "Packet use tax " + tag, kind: "USE_TAX_RETURN", basis: "ACCRUAL", accountNumber: "UT-99887766" },
    });
    await prisma.taxJurisdiction.create({
      data: {
        id: jurisdictionId, code: "PKT-" + tag, name: "Packet jurisdiction",
        level: "CITY", administration: "SELF_COLLECTED", reviewStatus: "REVIEWED",
        useTaxFilingAccountId: accountId,
      },
    });
    const rate = await prisma.taxRateVersion.create({
      data: {
        id: rateId, jurisdictionId, rateMilliPercent: 5000,
        effectiveFrom: day("2026-01-01"), source: "MANUAL",
      },
    });
    await prisma.taxFilingPeriod.create({
      data: {
        id: periodId, filingAccountId: accountId,
        periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"), dueOn: day("2026-10-20"),
      },
    });
    await prisma.purchaseUseTax.create({
      data: {
        id: rowId, sourceType: "APPLIANCE", sourceId: "packet-src-" + tag,
        purchasedOn: day("2026-09-18"), purchaseAmountCents: 10000, vendorTaxCents: 0,
        useTaxDueCents: 500, jurisdictionId, rateVersionId: rate.id, status: "DUE",
      },
    });
  });

  afterAll(async () => {
    await prisma.purchaseUseTax.deleteMany({ where: { id: rowId } });
    await prisma.taxFilingPeriod.deleteMany({ where: { id: periodId } });
    await prisma.taxRateVersion.deleteMany({ where: { id: rateId } });
    await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
    await prisma.taxFilingAccount.deleteMany({ where: { id: accountId } });
  });

  it("the accountant loads an OPEN return and does NOT assign the due use-tax row", async () => {
    session.role = "ACCOUNTANT";
    session.id = "packet-accountant";
    const load = await loadFilingPacket(periodId);
    expect(load.status).toBe("READY");
    const row = await prisma.purchaseUseTax.findUniqueOrThrow({ where: { id: rowId } });
    expect(row.filingPeriodId).toBeNull();
  });

  it("the owner's load assigns the due use-tax row to the period", async () => {
    session.role = "OWNER";
    session.id = "packet-owner";
    const load = await loadFilingPacket(periodId);
    expect(load.status).toBe("READY");
    const row = await prisma.purchaseUseTax.findUniqueOrThrow({ where: { id: rowId } });
    expect(row.filingPeriodId).toBe(periodId);
  });
});
