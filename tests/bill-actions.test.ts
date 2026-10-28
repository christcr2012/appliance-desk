import { describe, expect, it } from "vitest";
import { billActions } from "@/domains/billing/bill-actions";

// AR-3 (MONEY-AREA 3): the bill record's action table, for every status combination.
const base = { taxBlocked: false, payPath: null, beingConfirmed: false, refundableCents: 0, hasCredits: false } as const;

describe("bill record actions", () => {
  it("a tax-blocked draft has no primary (the next-step card holds Recalculate tax)", () => {
    const actions = billActions({ ...base, status: "DRAFT", taxBlocked: true });
    expect(actions.primary).toBeNull();
    expect(actions.secondary).toBeNull();
    expect(actions.overflow.giveUp).toBe(false);
    expect(actions.overflow.frozen).toBe(false);
  });

  it("an open bill with a Stripe page: Take payment primary, Record secondary", () => {
    const actions = billActions({ ...base, status: "OPEN", payPath: "STRIPE_LINK", refundableCents: 100, hasCredits: true });
    expect(actions.primary).toBe("take-payment");
    expect(actions.secondary).toBe("record");
    expect(actions.overflow).toMatchObject({ sendText: true, useCredit: true, refund: true, giveUp: true, frozen: false });
  });

  it("an open bill with no Stripe page: Record cash or check is the only collect action", () => {
    const actions = billActions({ ...base, status: "DELINQUENT", payPath: "MANUAL_ONLY" });
    expect(actions.primary).toBe("record");
    expect(actions.secondary).toBeNull();
    expect(actions.overflow.useCredit).toBe(false);
    expect(actions.overflow.refund).toBe(false);
  });

  it("a shop sale: Take card payment primary, Record secondary, never the payment-link sheet", () => {
    const actions = billActions({ ...base, status: "OPEN", payPath: "SHOP_CARD" });
    expect(actions.primary).toBe("take-card");
    expect(actions.secondary).toBe("record");
  });

  it("while the bank confirms a payment, no collect action is offered", () => {
    const actions = billActions({ ...base, status: "OPEN", payPath: "STRIPE_LINK", beingConfirmed: true });
    expect(actions.primary).toBeNull();
    expect(actions.secondary).toBeNull();
    expect(actions.overflow.giveUp).toBe(true);
  });

  it("finished bills print, and the frozen record is in the menu", () => {
    for (const status of ["PAID", "VOID", "WRITTEN_OFF", "REFUNDED"]) {
      const actions = billActions({ ...base, status });
      expect(actions.primary).toBe("print");
      expect(actions.secondary).toBeNull();
      expect(actions.overflow.frozen).toBe(true);
      expect(actions.overflow.giveUp).toBe(false);
    }
  });

  it("an old FAILED bill offers no primary but can still be given up on", () => {
    const actions = billActions({ ...base, status: "FAILED", payPath: null });
    expect(actions.primary).toBeNull();
    expect(actions.overflow.giveUp).toBe(true);
  });
});
