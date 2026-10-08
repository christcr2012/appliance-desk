import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  role: "OWNER" as "OWNER" | "ADMIN" | "STAFF",
  requireRole: vi.fn(async (...roles: string[]) => {
    if (!roles.includes(mocks.role)) throw new Error("Access denied");
    return { user: { id: "test-owner", role: mocks.role } };
  }),
}));
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
import { businessDateFromKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { loadFilingPacket } from "@/domains/tax/filing-packet";
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";
const day = (s: string) => businessDateFromKey(s)!;

describe.skipIf(!enabled)("T-6b1 filing load (real Postgres)", () => {
  const token = randomUUID();
  const tag = token.slice(0, 9);
  const accountId = "t6-packet-account-"+token;
  const jurisdictionId = "t6-packet-jurisdiction-"+token;
  const userId = "t6-packet-user-"+token;
  const customerId = "t6-packet-customer-"+token;
  const invoiceId = "t6-packet-invoice-"+token;
  let periodId = "";
  let rateId = "";
  let receiptId = "";

  afterEach(() => { mocks.role = "OWNER"; });

  it("uses saved invoice tax in accrual, receipt allocations in cash, and refuses guessed basis or STAFF access", async () => {
    try {
      await prisma.user.create({
        data: { id: userId, email: "t6packet-"+token+"@example.test", role: "CUSTOMER" },
      });
      await prisma.customer.create({
        data: { id: customerId, userId, referralCode: "T6-"+tag },
      });
      await prisma.taxFilingAccount.create({
        data: { id: accountId, name: "Test filing "+tag, kind: "SALES_RETURN", basis: "ACCRUAL" },
      });
      await prisma.taxJurisdiction.create({
        data: {
          id: jurisdictionId, code: "TXPK-"+tag, name: "Test Tax Jurisdiction",
          level: "CITY", administration: "SELF_COLLECTED",
          reviewStatus: "REVIEWED", filingAccountId: accountId,
        },
      });
      const rate = await prisma.taxRateVersion.create({
        data: { jurisdictionId, rateMilliPercent: 2900,
          effectiveFrom: day("2026-01-01"), source: "MANUAL" },
      });
      rateId = rate.id;
      const period = await prisma.taxFilingPeriod.create({
        data: {
          filingAccountId: accountId, periodStart: day("2026-10-01"),
          periodEnd: day("2026-10-31"), dueOn: day("2026-11-20"),
        },
      });
      periodId = period.id;
      await prisma.invoice.create({
        data: {
          id: invoiceId, customerId, status: "OPEN", subtotalCents: 10000,
          taxCents: 290, amountDueCents: 10290,
        },
      });
      const line = await prisma.invoiceTaxLine.create({
        data: {
          invoiceId, jurisdictionId, rateVersionId: rateId,
          category: "RENTAL", taxableCents: 10000, exemptCents: 0,
          taxCents: 290, source: "ENGINE",
        },
      });
      const accrual = await loadFilingPacket(periodId, day("2026-11-15"));
      expect(accrual.status).toBe("READY");
      if (accrual.status !== "READY") throw new Error("Unexpected block");
      expect(accrual.packet.rows).toHaveLength(1);
      expect(accrual.packet.rows[0].taxCents).toBe(290);
      expect(accrual.packet.rows[0].grossSalesCents).toBe(10000);
      expect(accrual.packet.totals.taxCents).toBe(290);

      await prisma.taxFilingAccount.update({ where: { id: accountId }, data: { basis: "CASH" } });
      const noReceipt = await loadFilingPacket(periodId, day("2026-11-15"));
      expect(noReceipt.status).toBe("READY");
      if (noReceipt.status !== "READY") throw new Error("Unexpected cash block");
      expect(noReceipt.packet.rows).toHaveLength(0);

      const receipt = await prisma.receipt.create({
        data: {
          customerId, source: "MANUAL", method: "check",
          amountCents: 10290, receivedOn: day("2026-10-15"),
        },
      });
      receiptId = receipt.id;
      await prisma.payment.create({
        data: {
          invoiceId, receiptId, amountCents: 10290,
          method: "check", status: "succeeded",
        },
      });
      const cash = await loadFilingPacket(periodId, day("2026-11-15"));
      expect(cash.status).toBe("READY");
      if (cash.status !== "READY") throw new Error("Unexpected cash block");
      expect(cash.packet.rows).toHaveLength(1);
      expect(cash.packet.rows[0].taxCents).toBe(290);
      expect(cash.packet.rows[0].netTaxableCents).toBe(10000);

      await prisma.taxFilingAccount.update({ where: { id: accountId }, data: { basis: "UNDECIDED" } });
      const blocked = await loadFilingPacket(periodId);
      expect(blocked.status).toBe("BLOCKED");
      if (blocked.status === "BLOCKED") expect(blocked.problems.join(" ")).toMatch(/CPA/i);

      mocks.role = "STAFF";
      await expect(loadFilingPacket(periodId)).rejects.toThrow("Access denied");
      mocks.role = "ADMIN";
      const admin = await loadFilingPacket(periodId);
      expect(admin.status).toBe("BLOCKED");
      expect(mocks.requireRole).toHaveBeenCalledWith("OWNER", "ADMIN");
      await prisma.invoiceTaxLine.delete({ where: { id: line.id } });
    } finally {
      await prisma.payment.deleteMany({ where: { invoiceId } });
      if (receiptId) await prisma.receipt.deleteMany({ where: { id: receiptId } });
      await prisma.invoiceTaxLine.deleteMany({ where: { invoiceId } });
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
