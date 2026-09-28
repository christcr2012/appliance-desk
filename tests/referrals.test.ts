import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateReferralCode, normalizeReferralCode } from "@/domains/referrals/code";

// Referral program (Task #68, docs/DECISIONS.md 2026-09-28 — Chris's
// pick: "discount for both people"). code.ts is pure; the rest of
// src/domains/referrals needs prisma/Stripe/email mocked.

describe("generateReferralCode", () => {
  it("is always 6 characters, uppercase, from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateReferralCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it("doesn't use visually-ambiguous characters (0, O, 1, I, L)", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateReferralCode();
      expect(code).not.toMatch(/[0O1IL]/);
    }
  });
});

describe("normalizeReferralCode", () => {
  it("trims and uppercases", () => {
    expect(normalizeReferralCode("  7k4mxq  ")).toBe("7K4MXQ");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeReferralCode("   ")).toBe("");
  });
});

// ---------------------------------------------------------------------------

const customerFindUnique = vi.fn();
const referralFindUnique = vi.fn();
const referralFindFirst = vi.fn();
const referralCreate = vi.fn();
const referralUpdate = vi.fn();
const customerCreditCreate = vi.fn();
const businessSettingsFindUnique = vi.fn();
const sendEmail = vi.fn();
const createBalanceTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findUnique: (...args: unknown[]) => customerFindUnique(...args) },
    referral: {
      findUnique: (...args: unknown[]) => referralFindUnique(...args),
      findFirst: (...args: unknown[]) => referralFindFirst(...args),
      create: (...args: unknown[]) => referralCreate(...args),
      update: (...args: unknown[]) => referralUpdate(...args),
    },
    customerCredit: { create: (...args: unknown[]) => customerCreditCreate(...args) },
    businessSettings: { findUnique: (...args: unknown[]) => businessSettingsFindUnique(...args) },
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    customers: { createBalanceTransaction: (...args: unknown[]) => createBalanceTransaction(...args) },
  }),
}));

vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

import {
  generateUniqueReferralCode,
  linkReferralIfCodeProvided,
  rewardReferralIfEligible,
} from "@/domains/referrals";

describe("generateUniqueReferralCode", () => {
  it("returns the first generated code when it isn't already taken", async () => {
    customerFindUnique.mockReset().mockResolvedValue(null);
    const tx = { customer: { findUnique: customerFindUnique } } as never;

    const code = await generateUniqueReferralCode(tx);

    expect(code).toHaveLength(6);
    expect(customerFindUnique).toHaveBeenCalledTimes(1);
  });

  it("retries when a generated code is already taken", async () => {
    customerFindUnique
      .mockReset()
      .mockResolvedValueOnce({ id: "existing" })
      .mockResolvedValueOnce(null);
    const tx = { customer: { findUnique: customerFindUnique } } as never;

    await generateUniqueReferralCode(tx);

    expect(customerFindUnique).toHaveBeenCalledTimes(2);
  });
});

describe("linkReferralIfCodeProvided", () => {
  beforeEach(() => {
    customerFindUnique.mockReset();
    referralFindUnique.mockReset();
    referralCreate.mockReset().mockResolvedValue({});
  });

  it("does nothing when no code was entered", async () => {
    const tx = { customer: { findUnique: customerFindUnique }, referral: { findUnique: referralFindUnique } } as never;

    await linkReferralIfCodeProvided(tx, "new-cust", null);

    expect(customerFindUnique).not.toHaveBeenCalled();
    expect(referralCreate).not.toHaveBeenCalled();
  });

  it("creates a Referral when the code matches a real customer", async () => {
    customerFindUnique.mockResolvedValue({ id: "referrer-1" });
    referralFindUnique.mockResolvedValue(null);
    const tx = { customer: { findUnique: customerFindUnique }, referral: { findUnique: referralFindUnique, create: referralCreate } } as never;

    await linkReferralIfCodeProvided(tx, "new-cust", " 7k4mxq ");

    expect(customerFindUnique).toHaveBeenCalledWith({
      where: { referralCode: "7K4MXQ" },
      select: { id: true },
    });
    expect(referralCreate).toHaveBeenCalledWith({
      data: { referrerCustomerId: "referrer-1", referredCustomerId: "new-cust" },
    });
  });

  it("does nothing when the code doesn't match any customer", async () => {
    customerFindUnique.mockResolvedValue(null);
    const tx = { customer: { findUnique: customerFindUnique }, referral: { findUnique: referralFindUnique, create: referralCreate } } as never;

    await linkReferralIfCodeProvided(tx, "new-cust", "NOMATCH");

    expect(referralCreate).not.toHaveBeenCalled();
  });

  it("never links a customer to their own code (can't happen in practice, guarded anyway)", async () => {
    customerFindUnique.mockResolvedValue({ id: "new-cust" });
    const tx = { customer: { findUnique: customerFindUnique }, referral: { findUnique: referralFindUnique, create: referralCreate } } as never;

    await linkReferralIfCodeProvided(tx, "new-cust", "SELFCODE");

    expect(referralCreate).not.toHaveBeenCalled();
  });

  it("does nothing when this customer is already linked to a referral", async () => {
    customerFindUnique.mockResolvedValue({ id: "referrer-1" });
    referralFindUnique.mockResolvedValue({ id: "existing-referral" });
    const tx = { customer: { findUnique: customerFindUnique }, referral: { findUnique: referralFindUnique, create: referralCreate } } as never;

    await linkReferralIfCodeProvided(tx, "new-cust", "SOMECODE");

    expect(referralCreate).not.toHaveBeenCalled();
  });
});

describe("rewardReferralIfEligible", () => {
  beforeEach(() => {
    referralFindFirst.mockReset();
    referralUpdate.mockReset().mockResolvedValue({});
    customerCreditCreate.mockReset().mockResolvedValue({});
    businessSettingsFindUnique.mockReset().mockResolvedValue({ id: "singleton", referralRewardCents: 2500 });
    sendEmail.mockReset().mockResolvedValue({ sent: true });
    createBalanceTransaction.mockReset().mockResolvedValue({});
  });

  function referral(overrides?: { referrerStripeId?: string | null; referredStripeId?: string | null }) {
    return {
      id: "referral-1",
      referrerCustomer: {
        id: "referrer-1",
        stripeCustomerId:
          overrides && "referrerStripeId" in overrides ? overrides.referrerStripeId : "cus_referrer",
        user: { name: "Alice Referrer", email: "alice@example.com" },
      },
      referredCustomer: {
        id: "referred-1",
        stripeCustomerId:
          overrides && "referredStripeId" in overrides ? overrides.referredStripeId : "cus_referred",
        user: { name: "Bob Referred", email: "bob@example.com" },
      },
    };
  }

  it("does nothing when this customer was never referred", async () => {
    referralFindFirst.mockResolvedValue(null);

    await rewardReferralIfEligible("some-customer");

    expect(customerCreditCreate).not.toHaveBeenCalled();
    expect(createBalanceTransaction).not.toHaveBeenCalled();
  });

  it("applies a Stripe balance credit and a local CustomerCredit to both sides, then marks REWARDED", async () => {
    referralFindFirst.mockResolvedValue(referral());

    await rewardReferralIfEligible("referred-1");

    expect(createBalanceTransaction).toHaveBeenCalledTimes(2);
    expect(createBalanceTransaction).toHaveBeenCalledWith("cus_referrer", {
      amount: -2500,
      currency: "usd",
      description: expect.stringContaining("Bob Referred"),
    });
    expect(createBalanceTransaction).toHaveBeenCalledWith("cus_referred", {
      amount: -2500,
      currency: "usd",
      description: expect.any(String),
    });

    expect(customerCreditCreate).toHaveBeenCalledTimes(2);
    expect(customerCreditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: "referrer-1",
          amountCents: 2500,
          remainingCents: 2500,
        }),
      }),
    );

    expect(referralUpdate).toHaveBeenCalledWith({
      where: { id: "referral-1" },
      data: { status: "REWARDED", rewardCents: 2500, rewardedAt: expect.any(Date) },
    });

    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("still records a local credit (without a Stripe call) for a side with no Stripe customer yet", async () => {
    referralFindFirst.mockResolvedValue(referral({ referrerStripeId: null }));

    await rewardReferralIfEligible("referred-1");

    // Only the referred side (which has a Stripe customer) gets a real
    // balance transaction; the referrer still gets their credit recorded.
    expect(createBalanceTransaction).toHaveBeenCalledTimes(1);
    expect(customerCreditCreate).toHaveBeenCalledTimes(2);
    const referrerCreditCall = customerCreditCreate.mock.calls.find(
      (call) => call[0].data.customerId === "referrer-1",
    );
    expect(referrerCreditCall?.[0].data.notes).toContain("Not yet applied automatically");
  });

  it("still rewards the other side when one side's Stripe call fails", async () => {
    referralFindFirst.mockResolvedValue(referral());
    createBalanceTransaction
      .mockRejectedValueOnce(new Error("Stripe is down"))
      .mockResolvedValueOnce({});

    await rewardReferralIfEligible("referred-1");

    expect(customerCreditCreate).toHaveBeenCalledTimes(2);
    expect(referralUpdate).toHaveBeenCalledTimes(1);
  });
});
