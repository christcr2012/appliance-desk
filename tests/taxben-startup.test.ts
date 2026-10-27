import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import {
  computeStartupSummary,
  startupFirstYearCents,
  startupForTaxYear,
  startupForYear,
  type StartupRule,
} from "@/domains/taxben/startup";

// TAXBEN-1 section 2: the Section 195 formula at the spec's totals, the
// mid-year amortization, and the tagging read against a real Postgres
// (rolled back; totals are measured as deltas over whatever the seeded
// database already holds).

const RULE: StartupRule = { deductionCents: 500_000, phaseoutStartCents: 5_000_000, amortizationMonths: 180 };

describe("startupFirstYearCents", () => {
  it("gives the full deduction under the phase-out and nothing once it is eaten up", () => {
    expect(startupFirstYearCents(400_000, RULE)).toBe(400_000); // under the cap: everything
    expect(startupFirstYearCents(1_000_000, RULE)).toBe(500_000); // $10k of costs
    expect(startupFirstYearCents(5_200_000, RULE)).toBe(300_000); // $52k: $5,000 − $2,000
    expect(startupFirstYearCents(6_000_000, RULE)).toBe(0); // $60k: fully phased out
    expect(startupFirstYearCents(0, RULE)).toBe(0);
  });
});

describe("startupForYear", () => {
  it("works the spec's totals for a January start", () => {
    const ten = startupForYear(1_000_000, "2026-01-01", 2026, RULE);
    expect(ten.firstYearCents).toBe(500_000);
    expect(ten.amortizationCents).toBe(33_333); // 12 of 180 months of the $5,000 remainder
    expect(ten.deductionCents).toBe(533_333);
    expect(ten.remainingCents).toBe(466_667);

    const fiftyTwo = startupForYear(5_200_000, "2026-01-01", 2026, RULE);
    expect(fiftyTwo.firstYearCents).toBe(300_000);
    expect(fiftyTwo.deductionCents).toBe(300_000 + 326_666);

    const sixty = startupForYear(6_000_000, "2026-01-01", 2026, RULE);
    expect(sixty.firstYearCents).toBe(0);
    expect(sixty.amortizationCents).toBe(400_000);
  });

  it("counts months from the began month and finishes exactly", () => {
    const first = startupForYear(600_000, "2026-06-01", 2026, RULE);
    expect(first.monthsElapsed).toBe(7); // June through December
    expect(first.amortizationCents).toBe(3_888);
    const second = startupForYear(600_000, "2026-06-01", 2027, RULE);
    expect(second.firstYearCents).toBe(0);
    expect(second.amortizationCents).toBe(6_667);
    const last = startupForYear(600_000, "2026-06-01", 2041, RULE);
    expect(last.remainingCents).toBe(0);
    const before = startupForYear(600_000, "2026-06-01", 2025, RULE);
    expect(before.deductionCents).toBe(0);
    expect(before.remainingCents).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// Tagging (real Postgres, everything rolled back)
// ---------------------------------------------------------------------------

const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return new URL("http://localhost/");
  }
})();
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

class Rollback extends Error {}

describe.skipIf(!enabled)("start-up tagging (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `taxben-startup-${tag}`;

  async function world(tx: Prisma.TransactionClient) {
    await tx.user.upsert({
      where: { id: userId },
      create: { id: userId, email: `taxben-startup-${tag}@example.test`, role: "OWNER" },
      update: {},
    });
    const bank = await tx.ledgerAccount.create({
      data: { name: `TB bank ${tag}`, type: "ASSET", description: "test", isPaymentSource: true },
    });
    // systemRole is unique: reuse the seeded chart accounts for these roles.
    const byRole = async (role: string, scheduleCLine: string) => {
      const existing = await tx.ledgerAccount.findFirst({ where: { systemRole: role } });
      if (existing) return existing;
      return tx.ledgerAccount.create({
        data: { name: `TB ${role} ${tag}`, type: "EXPENSE", description: "test", systemRole: role, scheduleCLine },
      });
    };
    const software = await byRole("EXPENSE_SOFTWARE_AND_SUBSCRIPTIONS", "18");
    const taxes = await byRole("TAX_ADJUSTMENTS", "23");
    const interest = await tx.ledgerAccount.create({
      data: {
        name: `TB interest acct ${tag}`, type: "EXPENSE", description: "test", scheduleCLine: "16b",
      },
    });
    const mkCategory = async (name: string, ledgerAccountId: string) =>
      tx.expenseCategory.create({ data: { name, description: "test", ledgerAccountId } });
    const categories = {
      software: await mkCategory(`Software ${tag}`, software.id),
      taxes: await mkCategory(`Taxes ${tag}`, taxes.id),
      interest: await mkCategory(`Interest ${tag}`, interest.id),
    };
    const spend = async (input: {
      spentOn: string; amountCents: number; categoryId: string;
      status?: "POSTED" | "DRAFT" | "VOID"; applianceId?: string; capitalizeToAppliance?: boolean;
    }) => tx.expense.create({
      data: {
        status: input.status ?? "POSTED",
        spentOn: businessDateFromKey(input.spentOn)!,
        amountCents: input.amountCents,
        vendorName: "Test vendor",
        categoryId: input.categoryId,
        paidFromAccountId: bank.id,
        submittedByUserId: userId,
        applianceId: input.applianceId ?? null,
        capitalizeToAppliance: input.capitalizeToAppliance ?? false,
      },
    });
    return { categories, spend };
  }

  it("counts posted pre-began expenses and excludes fleet, interest, taxes, drafts and later costs", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.complianceProfile.upsert({
          where: { id: "singleton" },
          create: { id: "singleton", businessBeganOn: businessDateFromKey("2026-06-01") },
          update: { businessBeganOn: businessDateFromKey("2026-06-01") },
        });
        const { categories, spend } = await world(tx);
        const baseline = await computeStartupSummary(tx);
        await spend({ spentOn: "2026-03-01", amountCents: 500_000, categoryId: categories.software.id });
        await spend({ spentOn: "2026-05-31", amountCents: 100_000, categoryId: categories.software.id });
        await spend({ spentOn: "2026-06-01", amountCents: 999_900, categoryId: categories.software.id }); // began day: not start-up
        await spend({ spentOn: "2026-03-01", amountCents: 777_700, categoryId: categories.software.id, status: "DRAFT" });
        await spend({ spentOn: "2026-03-01", amountCents: 50_000, categoryId: categories.taxes.id });
        await spend({ spentOn: "2026-03-01", amountCents: 30_000, categoryId: categories.interest.id });
        const type = await tx.applianceType.create({
          data: { name: `TB startup type ${tag}`, slug: `tb-startup-${tag}` },
        });
        const unit = await tx.appliance.create({
          data: {
            assetNumber: `TB-SU-${tag}`, applianceTypeId: type.id,
            purchaseDate: businessDateFromKey("2026-07-01"), acquisitionCostCents: 200_000,
          },
        });
        await spend({ spentOn: "2026-03-01", amountCents: 200_000, categoryId: categories.software.id, applianceId: unit.id });
        await spend({ spentOn: "2026-03-01", amountCents: 200_000, categoryId: categories.software.id, capitalizeToAppliance: true });

        const after = await computeStartupSummary(tx);
        expect(after.beganOn).toBe("2026-06-01");
        expect(after.beganStored).toBe(true);
        expect(after.totalCents - baseline.totalCents).toBe(600_000);
        const softwareDelta = (after.byCategory.find((c) => c.name === `Software ${tag}`)?.cents ?? 0)
          - (baseline.byCategory.find((c) => c.name === `Software ${tag}`)?.cents ?? 0);
        expect(softwareDelta).toBe(600_000);

        const view = await startupForTaxYear(2026, tx);
        expect(view).not.toBeNull();
        const pure = startupForYear(after.totalCents, "2026-06-01", 2026, RULE);
        expect(view!.firstYearCents).toBe(pure.firstYearCents);
        expect(view!.amortizationCents).toBe(pure.amortizationCents);
        expect(await startupForTaxYear(2025, tx)).toBeNull();
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("derives the began date from the fleet when the fact was never stored", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.complianceProfile.upsert({
          where: { id: "singleton" },
          create: { id: "singleton", businessBeganOn: null },
          update: { businessBeganOn: null },
        });
        const type = await tx.applianceType.create({
          data: { name: `TB derived type ${tag}`, slug: `tb-derived-${tag}` },
        });
        await tx.appliance.create({
          data: {
            assetNumber: `TB-DV-${tag}`, applianceTypeId: type.id,
            purchaseDate: businessDateFromKey("2026-02-01"), acquisitionCostCents: 100_000,
          },
        });
        const summary = await computeStartupSummary(tx);
        // Another lane of the seed may hold an even earlier first; the date
        // can only be on or before this unit's purchase day.
        expect(summary.beganOn).not.toBeNull();
        expect(summary.beganOn! <= "2026-02-01").toBe(true);
        expect(summary.beganStored).toBe(false);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
