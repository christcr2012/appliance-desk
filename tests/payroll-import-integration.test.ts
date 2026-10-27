import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import { getComplianceProfile, saveBusinessFacts, type BusinessFactsInput } from "@/domains/compliance/profile";
import { syncComplianceFilings } from "@/domains/compliance/filings";
import { importPayrollCsv, parsePayrollCsv } from "@/domains/compliance/payroll-import";

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

const PAYROLL_KEYS = [
  "fed.payroll.941",
  "fed.payroll.940",
  "fed.payroll.w2",
  "co.payroll.withholding",
  "co.payroll.ui",
  "co.payroll.famli",
  "co.payroll.new_hire",
];

describe.skipIf(!enabled)("CMP-5 hiring readiness and payroll import", () => {
  const tag = randomUUID().slice(0, 8);
  const provider = `Cmp5Test-${tag}`;
  let ownerId: string;
  let customerId: string;
  let savedFacts: BusinessFactsInput;
  let savedBooksStart: Date | null = null;
  const hashes: string[] = [];
  const hashOf = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

  const csv = (rows: string[]) =>
    ["pay_date,gross_wages,employer_taxes,employee_taxes,amount_withdrawn,provider", ...rows].join("\n");

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    customerId = (await prisma.user.findFirstOrThrow({ where: { role: "CUSTOMER" } })).id;
    const profile = await getComplianceProfile();
    savedFacts = {
      entityType: profile.entityType as BusinessFactsInput["entityType"],
      employees: profile.employees,
      truckGvwrLbs: profile.truckGvwrLbs,
      sosReportMonth: profile.sosReportMonth,
      hasHomeOffice: profile.hasHomeOffice,
      hiring: { firstHireDate: profile.firstHireDate ? businessDateKey(profile.firstHireDate) : null },
      local: {
        tradeName: profile.tradeName,
        usdotNumber: profile.usdotNumber,
        truckRegistrationMonth: profile.truckRegistrationMonth,
        greeleyLicenseDate: profile.greeleyLicenseDate ? businessDateKey(profile.greeleyLicenseDate) : null,
        registeredAgentName: profile.registeredAgentName,
        registeredAgentAddress: profile.registeredAgentAddress,
        registeredAgentCity: profile.registeredAgentCity,
        registeredAgentState: profile.registeredAgentState,
        registeredAgentZip: profile.registeredAgentZip,
      },
    };
    const settings = await prisma.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { booksStartDate: true },
    });
    savedBooksStart = settings?.booksStartDate ?? null;
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { booksStartDate: new Date("2026-01-01T07:00:00Z") },
    });
  });

  afterAll(async () => {
    await saveBusinessFacts(ownerId, savedFacts).catch(() => undefined);
    await syncComplianceFilings().catch(() => undefined);
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { booksStartDate: savedBooksStart },
    });
    const records = await prisma.payrollImport.findMany({
      where: { fileHash: { in: hashes } },
      select: { id: true },
    });
    const ids = records.map((r) => r.id);
    if (ids.length) {
      const entries = await prisma.journalEntry.findMany({
        where: { sourceType: "PAYROLL", sourceId: { in: ids } },
        select: { id: true },
      });
      await prisma.journalLine.deleteMany({ where: { entryId: { in: entries.map((e) => e.id) } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: entries.map((e) => e.id) } } });
      await prisma.payrollImport.deleteMany({ where: { id: { in: ids } } });
    }
  });

  it("payroll filings wake when employees > 0, with the new-hire report due start + 20 days", async () => {
    await saveBusinessFacts(ownerId, {
      ...savedFacts,
      employees: 1,
      hiring: { firstHireDate: "2027-03-02" },
    });
    await syncComplianceFilings();
    const filings = await prisma.complianceFiling.findMany({
      where: { obligationKey: { in: PAYROLL_KEYS } },
    });
    const live = filings.filter((f) => !["NOT_APPLICABLE"].includes(f.state));
    expect(live.map((f) => f.obligationKey)).toContain("fed.payroll.941");
    const newHire = live.find((f) => f.obligationKey === "co.payroll.new_hire");
    expect(newHire).toBeTruthy();
    expect(newHire!.periodKey).toBe("2027-03-02");
    expect(businessDateKey(newHire!.dueOn)).toBe("2027-03-22");
  });

  it("a bad first-hire date is refused in plain words", async () => {
    await expect(
      saveBusinessFacts(ownerId, { ...savedFacts, employees: 1, hiring: { firstHireDate: "2027-02-30" } }),
    ).rejects.toThrow(/start date like 2026-05-01/);
  });

  it("imports pay runs as balanced PAYROLL journals and refuses the same file twice", async () => {
    const text = csv([
      `2026-05-15,2000.00,153.00,300.00,2153.00,${provider}`,
      `2026-05-29,2000.00,153.00,300.00,2153.00,${provider}`,
    ]);
    hashes.push(hashOf(text));
    await expect(importPayrollCsv(ownerId, text, "payroll-may.csv")).resolves.toEqual({ imported: 2 });

    const records = await prisma.payrollImport.findMany({ where: { providerName: provider } });
    expect(records).toHaveLength(2);
    const entries = await prisma.journalEntry.findMany({
      where: { sourceType: "PAYROLL", sourceId: { in: records.map((r) => r.id) } },
      include: { lines: { include: { ledgerAccount: { select: { systemRole: true } } } } },
    });
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      const byRole = new Map(entry.lines.map((l) => [l.ledgerAccount.systemRole, l]));
      expect(byRole.get("WAGES")?.debitCents).toBe(200000);
      expect(byRole.get("EMPLOYER_PAYROLL_TAXES")?.debitCents).toBe(15300);
      expect(byRole.get("BANK")?.creditCents).toBe(215300);
      const debit = entry.lines.reduce((s, l) => s + l.debitCents, 0);
      const credit = entry.lines.reduce((s, l) => s + l.creditCents, 0);
      expect(debit).toBe(credit);
      expect(entry.memo).toContain(provider);
    }

    await expect(importPayrollCsv(ownerId, text, "payroll-may.csv")).rejects.toThrow(/already imported/);
    const after = await prisma.journalEntry.count({
      where: { sourceType: "PAYROLL", sourceId: { in: records.map((r) => r.id) } },
    });
    expect(after).toBe(2);
  });

  it("an unbalanced file posts nothing, and a pay run before the books start is refused", async () => {
    const bad = csv([`2026-06-12,2000.00,153.00,300.00,1900.00,${provider}`]);
    hashes.push(hashOf(bad));
    await expect(importPayrollCsv(ownerId, bad, "bad.csv")).rejects.toThrow(/does not add up/);
    expect(await prisma.payrollImport.count({ where: { fileHash: hashOf(bad) } })).toBe(0);

    const early = csv([`2025-12-15,2000.00,153.00,300.00,2153.00,${provider}`]);
    hashes.push(hashOf(early));
    await expect(importPayrollCsv(ownerId, early, "early.csv")).rejects.toThrow(/before the books start date/);
  });

  it("refuses when the books are not started, and a customer can never import", async () => {
    const text = csv([`2026-06-26,2000.00,153.00,300.00,2153.00,${provider}`]);
    hashes.push(hashOf(text));
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { booksStartDate: null } });
    try {
      await expect(importPayrollCsv(ownerId, text, "june.csv")).rejects.toThrow(/books are not started/);
    } finally {
      await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: { booksStartDate: new Date("2026-01-01T07:00:00Z") },
      });
    }
    await expect(importPayrollCsv(customerId, text, "june.csv")).rejects.toThrow();
    expect(parsePayrollCsv(text)).toHaveLength(1); // the file itself was fine; the gates refused it
  });
});
