import { describe, expect, it } from "vitest";
import { buildCheckoutLinePlan } from "@/domains/billing/checkout";

// Pure logic only — no database, no Stripe. See tests/billing-webhooks.test.ts
// for the real, database-backed side of Phase 6B (verified by CI against a
// real Postgres — see AGENTS.md's sandbox note).

describe("buildCheckoutLinePlan", () => {
  it("includes one recurring line per rental line, at monthlyPriceCents", () => {
    const plan = buildCheckoutLinePlan({
      lines: [
        { id: "line-1", label: "Washer", monthlyPriceCents: 4000 },
        { id: "line-2", label: "Dryer", monthlyPriceCents: 3500 },
      ],
      depositCents: 0,
      damageWaiverCents: 0,
    });

    expect(plan).toEqual([
      { kind: "RENTAL", description: "Washer", amountCents: 4000, recurring: true, rentalLineId: "line-1" },
      { kind: "RENTAL", description: "Dryer", amountCents: 3500, recurring: true, rentalLineId: "line-2" },
    ]);
  });

  it("adds a one-time deposit line when depositCents > 0", () => {
    const plan = buildCheckoutLinePlan({
      lines: [{ id: "line-1", label: "Washer", monthlyPriceCents: 4000 }],
      depositCents: 15000,
      damageWaiverCents: 0,
    });

    const deposit = plan.find((item) => item.kind === "DEPOSIT");
    expect(deposit).toEqual({
      kind: "DEPOSIT",
      description: "Security deposit",
      amountCents: 15000,
      recurring: false,
      rentalLineId: null,
    });
  });

  it("adds a one-time damage-waiver line when damageWaiverCents > 0", () => {
    const plan = buildCheckoutLinePlan({
      lines: [{ id: "line-1", label: "Washer", monthlyPriceCents: 4000 }],
      depositCents: 0,
      damageWaiverCents: 999,
    });

    const waiver = plan.find((item) => item.kind === "DAMAGE_WAIVER");
    expect(waiver).toEqual({
      kind: "DAMAGE_WAIVER",
      description: "Damage waiver",
      amountCents: 999,
      recurring: false,
      rentalLineId: null,
    });
  });

  it("omits deposit/damage-waiver lines when they're zero, rather than charging $0", () => {
    const plan = buildCheckoutLinePlan({
      lines: [{ id: "line-1", label: "Washer", monthlyPriceCents: 4000 }],
      depositCents: 0,
      damageWaiverCents: 0,
    });

    expect(plan.some((item) => item.kind === "DEPOSIT")).toBe(false);
    expect(plan.some((item) => item.kind === "DAMAGE_WAIVER")).toBe(false);
  });

  it("throws rather than sending Stripe an empty Checkout Session", () => {
    expect(() =>
      buildCheckoutLinePlan({ lines: [], depositCents: 0, damageWaiverCents: 0 }),
    ).toThrow(/nothing to charge/i);
  });
});
