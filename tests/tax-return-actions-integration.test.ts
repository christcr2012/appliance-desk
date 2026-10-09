import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { toCsv } from "@/lib/csv";
import { markPeriodFiled, saveFilingEntryProgress } from "@/domains/tax/filing";

const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && db.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(db.hostname);
const date = (value: string) => businessDateFromKey(value)!;
async function fixture(run: (ctx: { ownerId: string; periodId: string }) => Promise<void>) {
  const token = randomUUID().replaceAll("-", "");
  const owner = await prisma.user.findFirstOrThrow({
    where: { role: "OWNER", archivedAt: null }, select: { id: true },
  });
  const account = await prisma.taxFilingAccount.create({ data: {
    name: "T7C filing " + token.slice(0, 8),
    kind: "SALES_RETURN", basis: "ACCRUAL", frequency: "MONTHLY",
    accountNumber: "TEST-ONLY", firstPeriodStart: date("2026-03-01"),
  } });
  const period = await prisma.taxFilingPeriod.create({ data: {
    filingAccountId: account.id, periodStart: date("2026-03-01"),
    periodEnd: date("2026-03-31"), dueOn: date("2026-04-20"),
    legalDueOn: date("2026-04-20"),
  } });
  try { await run({ ownerId: owner.id, periodId: period.id }); }
  finally {
    await prisma.taxFilingAmendment.deleteMany({ where: { periodId: period.id } });
    await prisma.auditLog.deleteMany({ where: {
      entityType: "TaxFilingPeriod", entityId: period.id,
    } });
    await prisma.taxFilingPeriod.delete({ where: { id: period.id } });
    await prisma.taxFilingAccount.delete({ where: { id: account.id } });
  }
}

describe.skipIf(!enabled)("T-7C private filing and immutable confirmation (isolated PostgreSQL)", () => {
  it("stale filing progress and second filing cannot overwrite a finalized packet", async () =>
    fixture(async ({ ownerId, periodId }) => {
      await saveFilingEntryProgress(ownerId, {
        periodId, entryProgress: { "step:0": true },
      });
      await markPeriodFiled(ownerId, {
        periodId, filedOn: date("2026-04-18"), paidOn: date("2026-04-18"),
        confirmationNumber: "T7C-001", amountPaidCents: 0,
      });
      const saved = await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: periodId } });
      expect(saved.status).toBe("FILED");
      expect(saved.worksheet).not.toBeNull();
      await expect(saveFilingEntryProgress(ownerId, {
        periodId, entryProgress: { "step:0": false },
      })).rejects.toThrow(/already filed/i);
      await expect(markPeriodFiled(ownerId, {
        periodId, filedOn: date("2026-04-18"), paidOn: date("2026-04-18"),
        confirmationNumber: "T7C-DUPLICATE", amountPaidCents: 0,
      })).rejects.toThrow();
      const after = await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: periodId } });
      expect(after.worksheet).toEqual(saved.worksheet);
      expect(after.confirmationNumber).toBe("T7C-001");
      expect(await prisma.auditLog.count({
        where: { entityType: "TaxFilingPeriod", entityId: periodId,
          action: "tax.return_filed" },
      })).toBe(1);
    }));

  it("different-period, public and forged confirmation media cannot finalize a return", async () =>
    fixture(async ({ ownerId, periodId }) => {
      await expect(markPeriodFiled(ownerId, {
        periodId, filedOn: date("2026-04-18"), paidOn: date("2026-04-18"),
        confirmationNumber: "T7C-BAD-URL", amountPaidCents: 0,
        confirmationPhotoUrl: "https://example.com/public/tax-filings/" + periodId + "/file.jpg",
      })).rejects.toThrow(/private|confirmation|return/i);
      await expect(markPeriodFiled(ownerId, {
        periodId, filedOn: date("2026-04-18"), paidOn: date("2026-04-18"),
        confirmationNumber: "T7C-BAD-ID", amountPaidCents: 0,
        confirmationPhotoId: "other-return-photo-id",
      })).rejects.toThrow(/private|confirmation|return/i);
      const stillOpen = await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: periodId } });
      expect(stillOpen.status).toBe("OPEN");
      expect(stillOpen.confirmationPhotoId).toBeNull();
      expect(await prisma.auditLog.count({ where: {
        entityType: "TaxFilingPeriod", entityId: periodId, action: "tax.return_filed",
      } })).toBe(0);
    }));

  it("CSV escapes formula-like tax names without changing integer-cent amounts", () => {
    const csv = toCsv(
      [{ key: "name", header: "Tax area" }, { key: "cents", header: "Tax cents" }],
      [{ name: "=HYPERLINK(\"https://bad.example\")", cents: 400 },
        { name: "  +SUM(1,2)", cents: -150 }],
    );
    expect(csv).toContain("\'=HYPERLINK");
    expect(csv).toContain("400");
    expect(csv).toContain("-150");
    expect(csv).not.toContain("\r\n=HYPERLINK");
  });
});

