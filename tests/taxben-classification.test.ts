import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  allocateByPrice,
  businessUsePercentFor,
  classifyPurchaseInTx,
  decideCapitalization,
  deductionMappingForRole,
  deMinimisElectionFor,
  effectiveDeductionPercent,
  resolvePlacedInService,
  saveWriteOffSettings,
  type CapitalizationFacts,
} from "@/domains/taxben/classification";

// TAXBEN-1 section 1: the deduction mapping, the business-use rule (0% until
// answered), the de minimis election, and the capital-vs-expense decider in
// the spec's order — plus the recorded decision against a real Postgres
// (rolled back, so the shared settings and fleet are never touched).

const LIMIT = 250_000; // the seeded us.de_minimis_per_item value, $2,500

function facts(overrides: Partial<CapitalizationFacts> = {}): CapitalizationFacts {
  return {
    lineCents: 300_000,
    purchasedOn: new Date("2026-03-10T12:00:00Z"),
    taxYear: 2026,
    electionOn: true,
    deMinimisLimitCents: LIMIT,
    bonusPercent: 100,
    bonusAcquiredAfter: "2025-01-19",
    preferSection179: false,
    section179: { limitCents: 256_000_000, phaseoutCents: 409_000_000 },
    classLifeMonths: 60,
    boughtFromRelatedParty: false,
    ...overrides,
  };
}

describe("deduction mapping", () => {
  it("maps expense accounts to their Schedule C line, percent and kind", () => {
    expect(deductionMappingForRole("EXPENSE_SOFTWARE_AND_SUBSCRIPTIONS")).toEqual({
      scheduleCLine: "18", percent: 100, kind: "ORDINARY",
    });
    expect(deductionMappingForRole("DEPRECIATION")).toEqual({
      scheduleCLine: "13", percent: 100, kind: "CAPITAL",
    });
    expect(deductionMappingForRole("EXPENSE_PHONE_AND_INTERNET")?.kind).toBe("PERSONAL_SHARE");
    expect(deductionMappingForRole("RENTAL_INCOME")).toBeNull();
    expect(deductionMappingForRole("NO_SUCH_ROLE")).toBeNull();
  });

  it("deducts 0% of a mixed-use account until the owner answers, then the answered percent", () => {
    expect(effectiveDeductionPercent("EXPENSE_PHONE_AND_INTERNET", {})).toBe(0);
    expect(effectiveDeductionPercent("EXPENSE_PHONE_AND_INTERNET", { EXPENSE_PHONE_AND_INTERNET: 40 })).toBe(40);
    expect(effectiveDeductionPercent("EXPENSE_SOFTWARE_AND_SUBSCRIPTIONS", {})).toBe(100);
    expect(businessUsePercentFor({ EXPENSE_PHONE_AND_INTERNET: 140 }, "EXPENSE_PHONE_AND_INTERNET")).toBeNull();
    expect(businessUsePercentFor("junk", "EXPENSE_PHONE_AND_INTERNET")).toBeNull();
  });

  it("defaults the de minimis election on and honors a stored off", () => {
    expect(deMinimisElectionFor({}, 2026)).toBe(true);
    expect(deMinimisElectionFor(null, 2026)).toBe(true);
    expect(deMinimisElectionFor({ "2026": false }, 2026)).toBe(false);
    expect(deMinimisElectionFor({ "2026": false }, 2027)).toBe(true);
    expect(deMinimisElectionFor({ "2026": "off" }, 2026)).toBe(true);
  });
});

describe("allocateByPrice", () => {
  it("splits charges by price and sums exactly", () => {
    const shares = allocateByPrice([100_000, 300_000], 10_001);
    expect(shares[0]! + shares[1]!).toBe(10_001);
    expect(shares[0]).toBe(2_500);
    expect(shares[1]).toBe(7_501);
  });
  it("handles zero charges, zero prices and no units", () => {
    expect(allocateByPrice([100, 200], 0)).toEqual([0, 0]);
    expect(allocateByPrice([0, 0], 101)).toEqual([51, 50]);
    expect(allocateByPrice([], 500)).toEqual([]);
  });
});

describe("decideCapitalization", () => {
  it("expenses a line at or under the limit when the election is on", () => {
    const at = decideCapitalization(facts({ lineCents: LIMIT }));
    expect(at.decision).toBe("EXPENSED_DE_MINIMIS");
    expect(at.reason).toContain("de minimis safe harbor");
    expect(at.ruleKey).toBe("us.de_minimis_per_item");
    expect(at.ruleValue).toBe(String(LIMIT));
  });

  it("capitalizes one cent over the limit", () => {
    const over = decideCapitalization(facts({ lineCents: LIMIT + 1 }));
    expect(over.decision).toBe("CAPITALIZED_BONUS");
    expect(over.reason).toContain("over the $2,500.00 de minimis limit");
  });

  it("capitalizes under the limit when the election is off", () => {
    const off = decideCapitalization(facts({ lineCents: 100_000, electionOn: false }));
    expect(off.decision).toBe("CAPITALIZED_BONUS");
    expect(off.reason).toContain("election is off for 2026");
  });

  it("never gives bonus for a related-party purchase", () => {
    const related = decideCapitalization(facts({ boughtFromRelatedParty: true }));
    expect(related.decision).toBe("CAPITALIZED");
    expect(related.reason).toContain("relative or your own other business");
  });

  it("follows the Section 179 preference over bonus", () => {
    const chosen = decideCapitalization(facts({ preferSection179: true }));
    expect(chosen.decision).toBe("CAPITALIZED_SECTION179");
    expect(chosen.ruleKey).toBe("us.section179");
  });

  it("honors the year's bonus elect-out for the class (TAXBEN-2 review)", () => {
    const out = decideCapitalization(facts({ bonusElectedOut: true }));
    expect(out.decision).toBe("CAPITALIZED");
    expect(out.reason).toContain("elected out of bonus depreciation");
    expect(out.ruleValue).toContain("electedOut");
    // The Section 179 preference still wins over the elect-out.
    const chosen = decideCapitalization(facts({ bonusElectedOut: true, preferSection179: true }));
    expect(chosen.decision).toBe("CAPITALIZED_SECTION179");
    // And the de minimis expense still wins first.
    const expensed = decideCapitalization(facts({ bonusElectedOut: true, lineCents: 100_000 }));
    expect(expensed.decision).toBe("EXPENSED_DE_MINIMIS");
  });

  it("requires property acquired strictly after the bonus boundary date", () => {
    const onBoundary = decideCapitalization(facts({
      purchasedOn: new Date("2025-01-19T12:00:00Z"), taxYear: 2025,
    }));
    expect(onBoundary.decision).toBe("CAPITALIZED");
    const after = decideCapitalization(facts({
      purchasedOn: new Date("2025-01-20T12:00:00Z"), taxYear: 2025,
    }));
    expect(after.decision).toBe("CAPITALIZED_BONUS");
  });

  it("capitalizes conservatively when the de minimis rule cannot be read", () => {
    const missing = decideCapitalization(facts({ lineCents: 10_000, deMinimisLimitCents: null }));
    expect(missing.decision).toBe("CAPITALIZED_BONUS");
    expect(missing.reason).toContain("could not be read");
  });
});

describe("resolvePlacedInService", () => {
  it("prefers the book asset's attested date over the purchase date", () => {
    const bought = new Date("2026-01-05T00:00:00Z");
    const placed = new Date("2026-03-01T00:00:00Z");
    expect(resolvePlacedInService({ purchaseDate: bought, bookPlacedInServiceOn: placed })).toBe(placed);
    expect(resolvePlacedInService({ purchaseDate: bought, bookPlacedInServiceOn: null })).toBe(bought);
    expect(resolvePlacedInService({ purchaseDate: null, bookPlacedInServiceOn: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Recorded decisions (real Postgres, everything rolled back)
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

describe.skipIf(!enabled)("recorded capitalization decisions (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const actorId = `taxben-actor-${tag}`;

  async function fixture(
    tx: Prisma.TransactionClient,
    input: { prices: number[]; otherChargesCents: number; related?: boolean | null; elections?: unknown; preference?: string },
  ) {
    // The audit rows classifyPurchaseInTx writes need a real user (FK).
    await tx.user.upsert({
      where: { id: actorId },
      create: { id: actorId, email: `taxben-actor-${tag}@example.test`, role: "OWNER" },
      update: {},
    });
    const type = await tx.applianceType.create({
      data: { name: `TB type ${tag} ${Math.random()}`, slug: `tb-type-${tag}-${Math.random()}` },
    });
    if (input.elections !== undefined || input.preference !== undefined) {
      await tx.businessSettings.upsert({
        where: { id: "singleton" },
        create: {
          id: "singleton",
          deMinimisElections: input.elections ?? {},
          capitalizationPreference: input.preference ?? "BONUS",
        },
        update: {
          ...(input.elections !== undefined ? { deMinimisElections: input.elections as Prisma.InputJsonValue } : {}),
          ...(input.preference !== undefined ? { capitalizationPreference: input.preference } : {}),
        },
      });
    }
    const purchase = await tx.purchase.create({
      data: {
        operationKey: `taxben-${tag}-${Math.random()}`,
        payloadHash: "test",
        sellerName: "Test seller",
        purchasedOn: new Date("2026-03-10T12:00:00Z"),
        subtotalCents: input.prices.reduce((sum, price) => sum + price, 0),
        sellerTaxCents: 0,
        sellerTaxKind: "NONE",
        otherChargesCents: input.otherChargesCents,
        boughtFromRelatedParty: input.related ?? null,
        createdByUserId: actorId,
        taxRevisionAt: new Date(),
      },
    });
    const units = [];
    const unitTag = Math.random().toString(36).slice(2, 8);
    for (const [index, price] of input.prices.entries()) {
      units.push(await tx.appliance.create({
        data: {
          assetNumber: `TB-${tag}-${unitTag}-${index}`,
          applianceTypeId: type.id,
          purchaseId: purchase.id,
          purchaseDate: purchase.purchasedOn,
          acquisitionCostCents: price,
        },
      }));
    }
    return { purchase, units };
  }

  it("records the decision per unit, delivery share included, and never rewrites it", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        // A $2,400 unit plus its $200 share of the delivery charge is a
        // $2,600 line — over the limit, so it capitalizes; a $300 unit on
        // the same receipt expenses.
        const { purchase, units } = await fixture(tx, {
          prices: [240_000, 30_000], otherChargesCents: 22_500,
        });
        const decided = await classifyPurchaseInTx(tx, purchase.id, actorId, new Date("2026-03-11T00:00:00Z"));
        expect(decided).toBe(2);
        const rows = await tx.appliance.findMany({
          where: { id: { in: units.map((unit) => unit.id) } },
          orderBy: { assetNumber: "asc" },
        });
        const big = rows[0]!;
        const small = rows[1]!;
        expect(big.capLineCents).toBe(260_000);
        expect(big.capDecision).toBe("CAPITALIZED_BONUS");
        expect(small.capDecision).toBe("EXPENSED_DE_MINIMIS");
        expect(small.capRuleKey).toBe("us.de_minimis_per_item");
        expect(small.capPlacedInServiceOn?.toISOString()).toBe(purchase.purchasedOn.toISOString());
        // A second run decides nothing and changes nothing.
        const again = await classifyPurchaseInTx(tx, purchase.id, actorId, new Date("2026-03-12T00:00:00Z"));
        expect(again).toBe(0);
        const audit = await tx.auditLog.findMany({
          where: { action: "taxben.capitalization_decided", entityId: purchase.id },
        });
        expect(audit).toHaveLength(1);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("applies the year's saved bonus elect-out to new classifications (TAXBEN-2 review)", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.taxYearFacts.upsert({
          where: { year: 2026 },
          create: { year: 2026, bonusElectOutClasses: ["rentalAppliances"] },
          update: { bonusElectOutClasses: ["rentalAppliances"] },
        });
        const bought = await fixture(tx, { prices: [300_000], otherChargesCents: 0 });
        await classifyPurchaseInTx(tx, bought.purchase.id, actorId);
        const unit = await tx.appliance.findUniqueOrThrow({ where: { id: bought.units[0]!.id } });
        expect(unit.capDecision).toBe("CAPITALIZED");
        expect(unit.capReason).toContain("elected out of bonus depreciation");
        // A decision recorded before the elect-out is never rewritten:
        // clearing the choice and re-running changes nothing already decided.
        await tx.taxYearFacts.update({
          where: { year: 2026 },
          data: { bonusElectOutClasses: Prisma.DbNull },
        });
        const decidedAgain = await classifyPurchaseInTx(tx, bought.purchase.id, actorId);
        expect(decidedAgain).toBe(0);
        const still = await tx.appliance.findUniqueOrThrow({ where: { id: bought.units[0]!.id } });
        expect(still.capDecision).toBe("CAPITALIZED");
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("honors the year's election being off and the related-party answer", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const cheap = await fixture(tx, {
          prices: [10_000], otherChargesCents: 0, elections: { "2026": false },
        });
        await classifyPurchaseInTx(tx, cheap.purchase.id, actorId);
        const cheapUnit = await tx.appliance.findUniqueOrThrow({ where: { id: cheap.units[0]!.id } });
        expect(cheapUnit.capDecision).toBe("CAPITALIZED_BONUS");
        expect(cheapUnit.capReason).toContain("election is off");

        const related = await fixture(tx, {
          prices: [900_000], otherChargesCents: 0, related: true, elections: {},
        });
        await classifyPurchaseInTx(tx, related.purchase.id, actorId);
        const relatedUnit = await tx.appliance.findUniqueOrThrow({ where: { id: related.units[0]!.id } });
        expect(relatedUnit.capDecision).toBe("CAPITALIZED");
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});

describe.skipIf(!enabled)("write-off settings save (real Postgres, restored after)", () => {
  it("saves the answers, follows them, and audits the save", async () => {
    const before = await prisma.businessSettings.findUnique({ where: { id: "singleton" } });
    const actor = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } });
    try {
      await saveWriteOffSettings(actor.id, {
        businessUsePercents: { EXPENSE_PHONE_AND_INTERNET: 40 },
        enterpriseZone: "YES",
        deMinimisElection: { year: 2099, on: false },
        capitalizationPreference: "SECTION179",
      });
      const after = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
      expect(businessUsePercentFor(after.businessUsePercents, "EXPENSE_PHONE_AND_INTERNET")).toBe(40);
      expect(effectiveDeductionPercent("EXPENSE_PHONE_AND_INTERNET", after.businessUsePercents)).toBe(40);
      expect(after.enterpriseZone).toBe("YES");
      expect(after.capitalizationPreference).toBe("SECTION179");
      expect(deMinimisElectionFor(after.deMinimisElections, 2099)).toBe(false);
      const audits = await prisma.auditLog.findMany({
        where: { userId: actor.id, action: "taxben.settings_saved" },
      });
      expect(audits.length).toBeGreaterThan(0);
      await expect(
        saveWriteOffSettings(actor.id, { businessUsePercents: { EXPENSE_SOFTWARE_AND_SUBSCRIPTIONS: 10 } }),
      ).rejects.toThrow("does not take a business-use percent");
    } finally {
      if (before) {
        await prisma.businessSettings.update({
          where: { id: "singleton" },
          data: {
            businessUsePercents: before.businessUsePercents as never,
            deMinimisElections: before.deMinimisElections as never,
            enterpriseZone: before.enterpriseZone,
            capitalizationPreference: before.capitalizationPreference,
          },
        });
      }
    }
  });
});
