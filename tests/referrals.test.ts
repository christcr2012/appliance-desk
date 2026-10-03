import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateReferralCode, normalizeReferralCode } from "@/domains/referrals/code";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/domains/billing/provider-ops", () => ({
  RetryLater: class RetryLater extends Error {},
  claimProviderOperation: vi.fn(),
  completeProviderOperation: vi.fn(),
  runProviderCall: vi.fn(),
}));

import {
  generateUniqueReferralCode,
  linkReferralIfCodeProvided,
  rewardReferralOnFirstPaidInvoice,
} from "@/domains/referrals";

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

describe("generateUniqueReferralCode", () => {
  it("returns the first generated code when it isn't already taken", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const tx = { customer: { findUnique } } as never;

    const code = await generateUniqueReferralCode(tx);

    expect(code).toHaveLength(6);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("retries when a generated code is already taken", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: "existing" })
      .mockResolvedValueOnce(null);
    const tx = { customer: { findUnique } } as never;

    await generateUniqueReferralCode(tx);

    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

describe("linkReferralIfCodeProvided", () => {
  let customerFindUnique: ReturnType<typeof vi.fn>;
  let referralFindUnique: ReturnType<typeof vi.fn>;
  let referralCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    customerFindUnique = vi.fn();
    referralFindUnique = vi.fn();
    referralCreate = vi.fn().mockResolvedValue({});
  });

  function tx() {
    return {
      customer: { findUnique: customerFindUnique },
      referral: { findUnique: referralFindUnique, create: referralCreate },
    } as never;
  }

  it("does nothing when no code was entered", async () => {
    await linkReferralIfCodeProvided(tx(), "new-cust", null);

    expect(customerFindUnique).not.toHaveBeenCalled();
    expect(referralCreate).not.toHaveBeenCalled();
  });

  it("creates a Referral when the code matches a real customer", async () => {
    customerFindUnique.mockResolvedValue({ id: "referrer-1" });
    referralFindUnique.mockResolvedValue(null);

    await linkReferralIfCodeProvided(tx(), "new-cust", " 7k4mxq ");

    expect(customerFindUnique).toHaveBeenCalledWith({
      where: { referralCode: "7K4MXQ" },
      select: { id: true },
    });
    expect(referralCreate).toHaveBeenCalledWith({
      data: { referrerCustomerId: "referrer-1", referredCustomerId: "new-cust" },
    });
  });

  it("does nothing for an unknown code, a self-code, or an already-linked customer", async () => {
    customerFindUnique.mockResolvedValueOnce(null);
    await linkReferralIfCodeProvided(tx(), "new-cust", "NOMATCH");
    expect(referralCreate).not.toHaveBeenCalled();

    customerFindUnique.mockResolvedValueOnce({ id: "new-cust" });
    await linkReferralIfCodeProvided(tx(), "new-cust", "SELFCODE");
    expect(referralCreate).not.toHaveBeenCalled();

    customerFindUnique.mockResolvedValueOnce({ id: "referrer-1" });
    referralFindUnique.mockResolvedValueOnce({ id: "existing-referral" });
    await linkReferralIfCodeProvided(tx(), "new-cust", "SOMECODE");
    expect(referralCreate).not.toHaveBeenCalled();
  });
});

describe("rewardReferralOnFirstPaidInvoice", () => {
  const referral = {
    id: "referral-1",
    referrerCustomerId: "referrer-1",
    referredCustomerId: "referred-1",
    referrerCustomer: {
      id: "referrer-1",
      user: { name: "Alice Referrer", email: "alice@example.test" },
    },
    referredCustomer: {
      id: "referred-1",
      user: { name: "Bob Referred", email: "bob@example.test" },
    },
  };

  function makeTx(status: "PENDING" | "REWARDING" | "REWARDED" | null = "PENDING") {
    const queryRaw = vi.fn().mockResolvedValue(
      status ? [{ id: referral.id, status }] : [],
    );
    const referralFind = vi.fn().mockResolvedValue(referral);
    const settingsFind = vi.fn().mockResolvedValue({ referralRewardCents: 2500 });
    const creditCreate = vi
      .fn()
      .mockResolvedValueOnce({ id: "credit-referrer" })
      .mockResolvedValueOnce({ id: "credit-referred" });
    const referralUpdate = vi.fn().mockResolvedValue({});

    return {
      tx: {
        $queryRaw: queryRaw,
        referral: {
          findUniqueOrThrow: referralFind,
          update: referralUpdate,
        },
        businessSettings: { findUniqueOrThrow: settingsFind },
        customerCredit: { create: creditCreate },
      } as never,
      queryRaw,
      referralFind,
      settingsFind,
      creditCreate,
      referralUpdate,
    };
  }

  it("claims PENDING under the row lock and atomically mints one credit per side", async () => {
    const mocks = makeTx();

    await expect(
      rewardReferralOnFirstPaidInvoice(mocks.tx, "referred-1"),
    ).resolves.toEqual({ creditIds: ["credit-referrer", "credit-referred"] });

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.creditCreate).toHaveBeenCalledTimes(2);
    expect(mocks.creditCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: "referrer-1",
          amountCents: 2500,
          remainingCents: 2500,
          sourceType: "REFERRAL",
          sourceId: "referral-1",
          side: "referrer",
        }),
      }),
    );
    expect(mocks.creditCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: "referred-1",
          amountCents: 2500,
          remainingCents: 2500,
          sourceType: "REFERRAL",
          sourceId: "referral-1",
          side: "referred",
        }),
      }),
    );
    expect(mocks.referralUpdate).toHaveBeenCalledWith({
      where: { id: "referral-1" },
      data: { status: "REWARDING", rewardCents: 2500 },
    });
  });

  it.each([null, "REWARDING", "REWARDED"] as const)(
    "does not mint credits when the locked referral status is %s",
    async (status) => {
      const mocks = makeTx(status);

      await expect(
        rewardReferralOnFirstPaidInvoice(mocks.tx, "referred-1"),
      ).resolves.toBeNull();

      expect(mocks.referralFind).not.toHaveBeenCalled();
      expect(mocks.settingsFind).not.toHaveBeenCalled();
      expect(mocks.creditCreate).not.toHaveBeenCalled();
      expect(mocks.referralUpdate).not.toHaveBeenCalled();
    },
  );
});
