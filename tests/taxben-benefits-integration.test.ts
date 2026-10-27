import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import {
  computeTaxBenefits,
  halfSeTaxCents,
  listBenefitsAttention,
  midQuarterShare,
  qbiEstimate,
  seTaxCents,
  sepEstimateCents,
  soloEstimateCents,
} from "@/domains/taxben/benefits";

// TAXBEN-1 section 3: the benefit list. The money chain is checked against
// hand-worked figures; the engine read runs on a real Postgres inside a
// rolled-back transaction.

const SE_RULE = { deductiblePercent: 50, ssWageBaseCents: 18_450_000 };
const SE_RATES = { netEarningsPercent: 92.35, socialSecurityPercent: 12.4, medicarePercent: 2.9, minimumNetEarningsCents: 40_000 };
const QBI_RULE = { percent: 20, minimumCents: 40_000, minimumQbiCents: 100_000 };

describe("the self-employment chain", () => {
  it("works the SE tax, its deductible half, the SEP and the solo 401(k)", () => {
    // $80,000 profit: net earnings 92.35% = $73,880; SS 12.4% = $9,161.12;
    // Medicare 2.9% = $2,142.52; total $11,303.64.
    const se = seTaxCents(8_000_000, SE_RULE, SE_RATES);
    expect(se).toBe(1_130_364);
    expect(seTaxCents(30_000, SE_RULE, SE_RATES)).toBe(0); // under the $400 floor
    const half = halfSeTaxCents(se, SE_RULE);
    expect(half).toBe(565_182);
    const sep = sepEstimateCents(8_000_000, half, { percentOfNetProfit: 20, maxCents: 7_200_000 });
    expect(sep).toBe(1_486_964);
    const solo = soloEstimateCents(8_000_000, half, { percentOfNetProfit: 20, maxCents: 7_200_000 }, { deferralCents: 2_450_000, maxTotalCents: 7_200_000 });
    expect(solo).toBe(2_450_000 + 1_486_964);
  });

  it("applies the QBI minimum only when qualified income reaches its floor", () => {
    const big = qbiEstimate({ netProfitCents: 8_000_000, halfSeCents: 565_182, seHealthCents: 0, retirementCents: 1_486_964, rule: QBI_RULE });
    expect(big.baseCents).toBe(5_947_854);
    expect(big.deductionCents).toBe(1_189_571);
    const small = qbiEstimate({ netProfitCents: 200_000, halfSeCents: 0, seHealthCents: 0, retirementCents: 50_000, rule: QBI_RULE });
    expect(small.baseCents).toBe(150_000);
    expect(small.deductionCents).toBe(40_000); // the minimum beats 20% of $1,500
    const tiny = qbiEstimate({ netProfitCents: 90_000, halfSeCents: 0, seHealthCents: 0, retirementCents: 0, rule: QBI_RULE });
    expect(tiny.deductionCents).toBe(18_000); // below the floor: plain 20%
  });

  it("measures the mid-quarter share on basis after Section 179", () => {
    const share = midQuarterShare([
      { placedMonth: 3, basisCents: 100_000 },
      { placedMonth: 11, basisCents: 300_000 },
    ]);
    expect(share.totalBasisCents).toBe(400_000);
    expect(share.sharePercent).toBe(75);
    expect(midQuarterShare([]).sharePercent).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The engine read (real Postgres, rolled back)
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

describe.skipIf(!enabled)("tax benefits engine (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const YEAR = 2026;

  async function account(tx: Prisma.TransactionClient, role: string) {
    return tx.ledgerAccount.findUniqueOrThrow({ where: { systemRole: role } });
  }

  async function journal(
    tx: Prisma.TransactionClient,
    input: { on: string; sourceId: string; lines: { accountId: string; debit: number; credit: number }[] },
  ) {
    await tx.journalEntry.create({
      data: {
        entryDate: businessDateFromKey(input.on)!,
        periodKey: input.on.slice(0, 7),
        sourceType: "EXPENSE",
        sourceId: input.sourceId,
        eventKind: "TAXBEN_TEST",
        memo: "TAXBEN-1 test entry",
        lines: { create: input.lines.map((l) => ({ ledgerAccountId: l.accountId, debitCents: l.debit, creditCents: l.credit })) },
      },
    });
  }

  it("builds the benefit rows from the books, fleet, mileage and facts", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.businessSettings.upsert({
          where: { id: "singleton" },
          create: { id: "singleton", enterpriseZone: "YES", businessUsePercents: {} },
          update: { enterpriseZone: "YES", businessUsePercents: {} },
        });
        await tx.complianceProfile.upsert({
          where: { id: "singleton" },
          create: {
            id: "singleton", hasHomeOffice: true, homeOfficeSqFt: 200, homeSqFt: 1000,
            homeHousingCostsCents: 1_200_000, homeUtilitiesCents: 300_000, homeInsuranceCents: 100_000,
            homeOfficeAttestedYear: YEAR,
          },
          update: {
            hasHomeOffice: true, homeOfficeSqFt: 200, homeSqFt: 1000,
            homeHousingCostsCents: 1_200_000, homeUtilitiesCents: 300_000, homeInsuranceCents: 100_000,
            homeOfficeAttestedYear: YEAR,
          },
        });
        await tx.taxYearFacts.upsert({
          where: { year: YEAR },
          create: { year: YEAR, seHealthPremiumCents: 600_000, seHealthEmployerPlanMonths: [] },
          update: { seHealthPremiumCents: 600_000, seHealthEmployerPlanMonths: [] },
        });

        const income = await account(tx, "RENTAL_INCOME");
        const software = await account(tx, "EXPENSE_SOFTWARE_AND_SUBSCRIPTIONS");
        const fuel = await account(tx, "EXPENSE_FUEL");
        await journal(tx, { on: "2026-05-01", sourceId: `tb-inc-${tag}`, lines: [{ accountId: income.id, debit: 0, credit: 10_000_000 }] });
        await journal(tx, { on: "2026-05-02", sourceId: `tb-sw-${tag}`, lines: [{ accountId: software.id, debit: 100_000, credit: 0 }] });
        await journal(tx, { on: "2026-05-03", sourceId: `tb-fuel-${tag}`, lines: [{ accountId: fuel.id, debit: 50_000, credit: 0 }] });

        const type = await tx.applianceType.create({
          data: { name: `TB ben type ${tag}`, slug: `tb-ben-${tag}` },
        });
        const recorder = await tx.user.upsert({
          where: { id: `taxben-ben-${tag}` },
          create: { id: `taxben-ben-${tag}`, email: `taxben-ben-${tag}@example.test`, role: "OWNER" },
          update: {},
        });
        const mkUnit = async (assetNumber: string, placed: string, cost: number, allowed: number) => {
          const unit = await tx.appliance.create({
            data: {
              assetNumber, applianceTypeId: type.id,
              purchaseDate: businessDateFromKey(placed)!, acquisitionCostCents: cost,
            },
          });
          await tx.bookAsset.create({
            data: {
              applianceId: unit.id, costCents: cost,
              placedInServiceOn: businessDateFromKey(placed)!, lifeMonths: 60, salvagePercent: 0,
            },
          });
          await tx.bookTaxEvidence.create({
            data: {
              applianceId: unit.id, classification: "RENTAL_ASSET", confidence: "CPA_CONFIRMED",
              allowedDepreciationCents: allowed, section179Cents: 0, bonusDepreciationCents: allowed,
              evidenceAsOf: businessDateFromKey(placed)!, sourceReference: "TAXBEN-1 test",
              recordedByUserId: recorder.id,
            },
          });
        };
        await mkUnit(`TB-B1-${tag}`, "2026-03-01", 100_000, 20_000);
        await mkUnit(`TB-B2-${tag}`, "2026-11-15", 1_000_000, 200_000);

        const vehicle = await tx.fleetVehicle.create({
          data: {
            nickname: `TB truck ${tag}`, year: 2024, make: "Ford", model: "Transit", gvwrLbs: 9000,
            createdByUserId: recorder.id,
          },
        });
        await tx.mileageTrip.create({
          data: {
            vehicleId: vehicle.id, tripDate: businessDateFromKey("2026-06-01")!,
            startOdometer: 0, endOdometer: 1000, miles: 1000, purpose: "Deliveries", source: "MANUAL",
            createdByUserId: recorder.id,
          },
        });

        const benefits = await computeTaxBenefits(YEAR, tx);
        const byKey = new Map(benefits.rows.map((r) => [r.key, r]));

        const depreciation = byKey.get("depreciation");
        expect(depreciation?.amountCents).toBe(220_000);

        const midQuarter = byKey.get("mid-quarter");
        expect(midQuarter?.condition).toContain("over the 40% line");

        const vehicleRow = byKey.get("vehicle");
        expect(vehicleRow?.amountCents).toBe(72_500); // 1,000 miles at 72.5 cents
        expect(vehicleRow?.details.find((d) => d.label.startsWith("Actual"))?.cents).toBe(50_000);

        const homeOffice = byKey.get("home-office");
        expect(homeOffice?.amountCents).toBe(320_000); // regular method beats simplified here

        expect(byKey.get("se-tax-half")?.amountCents).toBeGreaterThan(0);
        expect(byKey.get("se-health")?.amountCents).toBe(600_000);
        expect(byKey.get("retirement")?.amountCents).toBeGreaterThan(0);
        expect(byKey.get("qbi")?.amountCents).toBeGreaterThan(0);
        expect(byKey.get("enterprise-zone")?.condition).toContain("Pre-certify in January");
        expect(byKey.get("bad-debts")).toBeDefined();
        const ordinary = byKey.get("ordinary");
        expect(ordinary?.details.find((d) => d.label.includes("Software"))?.cents).toBe(100_000);

        const november = await listBenefitsAttention(businessDateFromKey("2026-11-10")!, tx);
        expect(november.map((i) => i.kind)).toContain("MID_QUARTER");
        const january = await listBenefitsAttention(businessDateFromKey("2027-01-15")!, tx);
        expect(january.map((i) => i.kind)).toEqual(expect.arrayContaining(["RETIREMENT", "ENTERPRISE_ZONE"]));
        // The fixture answered no business-use percent, so the ask is open.
        expect(january.map((i) => i.kind)).toContain("BUSINESS_USE");
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
