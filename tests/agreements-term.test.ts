import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  assertActor: vi.fn(),
  queryRaw: vi.fn(),
  agreementFind: vi.fn(),
  agreementFindFirst: vi.fn(),
  agreementCreate: vi.fn(),
  agreementUpdate: vi.fn(),
  lineCreateMany: vi.fn(),
  auditCreate: vi.fn(),
  settingsFind: vi.fn(),
  userFind: vi.fn(),
  consentCreate: vi.fn(),
}));

function tx() {
  return {
    $queryRaw: (...args: unknown[]) => mocks.queryRaw(...args),
    rentalAgreement: {
      findUniqueOrThrow: (...args: unknown[]) => mocks.agreementFind(...args),
      findFirst: (...args: unknown[]) => mocks.agreementFindFirst(...args),
      create: (...args: unknown[]) => mocks.agreementCreate(...args),
      update: (...args: unknown[]) => mocks.agreementUpdate(...args),
    },
    rentalLine: { createMany: (...args: unknown[]) => mocks.lineCreateMany(...args) },
    auditLog: { create: (...args: unknown[]) => mocks.auditCreate(...args) },
    businessSettings: { findUnique: (...args: unknown[]) => mocks.settingsFind(...args) },
    user: { findUnique: (...args: unknown[]) => mocks.userFind(...args) },
    consentRecord: { create: (...args: unknown[]) => mocks.consentCreate(...args) },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (callback: (client: ReturnType<typeof tx>) => unknown) => {
      mocks.transaction();
      return callback(tx());
    },
  },
}));
vi.mock("@/lib/team-actor", () => ({
  assertActiveTeamActor: (...args: unknown[]) => mocks.assertActor(...args),
}));

import {
  loadTerminationPolicy,
  quoteEarlyTermination,
  renewAgreement,
  requestEarlyTermination,
  setAutoRenew,
  type TerminationPolicy,
} from "@/domains/agreements/term";

const policyBase: TerminationPolicy = {
  feeCents: null,
  feePercent: null,
  feeCapCents: null,
  noticeDays: 0,
  unusedTerm: "CREDIT",
  version: "policy-v1",
};

function agreementForQuote() {
  return {
    termMonths: 12,
    startDate: new Date("2026-01-01T07:00:00Z"),
    endDate: new Date("2027-01-01T07:00:00Z"),
    nextBillingDate: new Date("2026-11-01T06:00:00Z"),
    paidInFullInAdvance: false,
    lines: [{ monthlyPriceCents: 6_000 }],
    invoices: [],
  };
}

describe("termination policy", () => {
  it("returns null until required policy values and text are configured", () => {
    expect(
      loadTerminationPolicy({
        earlyTerminationNoticeDays: null,
        unusedTermTreatment: "CREDIT",
        terminationTermsText: "Terms",
      }),
    ).toBeNull();
    expect(
      loadTerminationPolicy({
        earlyTerminationNoticeDays: 5,
        unusedTermTreatment: null,
        terminationTermsText: "Terms",
      }),
    ).toBeNull();
    expect(
      loadTerminationPolicy({
        earlyTerminationNoticeDays: 5,
        unusedTermTreatment: "CREDIT",
        terminationTermsText: null,
      }),
    ).toBeNull();
  });

  it("generates a stable version fingerprint from configured policy", () => {
    const settings = {
      earlyTerminationFeeCents: 500,
      earlyTerminationFeePercent: 10,
      earlyTerminationFeeCapCents: 2_000,
      earlyTerminationNoticeDays: 5,
      unusedTermTreatment: "CREDIT",
      terminationTermsText: "Configured terms v1",
    };
    const first = loadTerminationPolicy(settings);
    const second = loadTerminationPolicy(settings);
    expect(first).not.toBeNull();
    expect(first?.version).toBe(second?.version);
  });

  it.each([
    ["flat only", { feeCents: 1_000, feePercent: null, feeCapCents: null }, 1_000],
    ["percent only", { feeCents: null, feePercent: 10, feeCapCents: null }, 1_200],
    ["both use max", { feeCents: 1_000, feePercent: 10, feeCapCents: null }, 1_200],
    ["cap applies last", { feeCents: 1_000, feePercent: 10, feeCapCents: 1_100 }, 1_100],
  ])("applies the required fee formula: %s", (_label, overrides, expected) => {
    const quote = quoteEarlyTermination(
      agreementForQuote(),
      { ...policyBase, ...overrides },
      new Date("2026-10-01T06:00:00Z"),
    );
    expect(quote.effectiveOn.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(quote.remainingTermMonths).toBe(2);
    expect(quote.remainingRentCents).toBe(12_000);
    expect(quote.feeCents).toBe(expected);
  });

  it("pushes notice to the next billing anniversary instead of prorating", () => {
    const quote = quoteEarlyTermination(
      agreementForQuote(),
      { ...policyBase, noticeDays: 5 },
      new Date("2026-10-20T18:00:00Z"),
    );
    expect(quote.effectiveOn.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(quote.remainingTermMonths).toBe(2);
  });
});

describe("term mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertActor.mockResolvedValue({ id: "owner-1", role: "OWNER" });
    mocks.queryRaw.mockResolvedValue([{ id: "agr-1" }]);
    mocks.agreementFindFirst.mockResolvedValue(null);
    mocks.agreementCreate.mockResolvedValue({ id: "agr-renewal" });
    mocks.agreementUpdate.mockResolvedValue({});
    mocks.lineCreateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({});
    mocks.consentCreate.mockResolvedValue({});
  });

  it("requestEarlyTermination rejects when owner policy is not configured", async () => {
    mocks.agreementFind.mockResolvedValue({
      id: "agr-1",
      status: "ACTIVE",
      termMonths: 12,
      startDate: new Date("2026-01-01T07:00:00Z"),
      endDate: new Date("2027-01-01T07:00:00Z"),
      nextBillingDate: new Date("2026-11-01T06:00:00Z"),
      paidInFullInAdvance: false,
      terminationRequestedAt: null,
      lines: [{ monthlyPriceCents: 6_000 }],
      invoices: [],
    });
    mocks.settingsFind.mockResolvedValue({
      earlyTerminationNoticeDays: null,
      unusedTermTreatment: null,
      terminationTermsText: null,
    });
    const quote = {
      requestedOn: new Date("2026-10-01T06:00:00Z"),
      effectiveOn: new Date("2026-11-01T06:00:00Z"),
      remainingTermMonths: 2,
      remainingRentCents: 12_000,
      feeCents: 0,
      unusedTermCents: 0,
      unusedTermTreatment: "CREDIT" as const,
      unpaidBalanceCents: 0,
      policyVersion: "missing",
    };

    await expect(requestEarlyTermination("owner-1", "agr-1", quote)).rejects.toThrow(
      /not available/i,
    );
    expect(mocks.agreementUpdate).not.toHaveBeenCalled();
  });

  it("creates a linked DRAFT renewal with copied price lines and leaves the old agreement untouched", async () => {
    mocks.agreementFind.mockResolvedValue({
      id: "agr-1",
      status: "ACTIVE",
      customerId: "cust-1",
      serviceAddressId: "addr-1",
      depositCents: 1_000,
      damageWaiverCents: 200,
      lateFeeGraceDays: 5,
      lateFeeCents: 500,
      lateFeePercent: 10,
      taxRatePermille: 73,
      lines: [
        {
          id: "line-old",
          label: "Washer / Dryer",
          monthlyPriceCents: 6_000,
          listPriceCents: 7_000,
          prepayDiscountCentsPerMonth: 1_000,
          assignments: [{ id: "assignment-that-must-not-copy" }],
        },
      ],
    });

    await expect(
      renewAgreement("owner-1", "agr-1", {
        termMonths: 12,
        startOn: new Date("2027-01-01T07:00:00Z"),
      }),
    ).resolves.toEqual({ newAgreementId: "agr-renewal" });

    expect(mocks.agreementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "DRAFT",
        renewedFromAgreementId: "agr-1",
        customerId: "cust-1",
        serviceAddressId: "addr-1",
        termMonths: 12,
      }),
      select: { id: true },
    });
    expect(mocks.lineCreateMany).toHaveBeenCalledWith({
      data: [
        {
          agreementId: "agr-renewal",
          label: "Washer / Dryer",
          monthlyPriceCents: 6_000,
          listPriceCents: 7_000,
          prepayDiscountCentsPerMonth: 1_000,
        },
      ],
    });
    expect(mocks.agreementUpdate).not.toHaveBeenCalled();
  });

  it("disabling auto-renew leaves the agreement lifecycle ACTIVE", async () => {
    mocks.agreementFind.mockResolvedValue({
      id: "agr-1",
      status: "ACTIVE",
      termMonths: 12,
      customerId: "cust-1",
      customer: { userId: "customer-user-1" },
    });
    mocks.userFind.mockResolvedValue({ id: "owner-1", role: "OWNER", archivedAt: null });

    await setAutoRenew("owner-1", "agr-1", {
      enabled: false,
      termsVersion: "",
    });

    expect(mocks.agreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: {
        renewalPreference: "NONE",
        autoRenewConsentedAt: null,
        autoRenewTermsVersion: null,
      },
    });
    expect(mocks.consentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: "cust-1",
        kind: "auto_renew",
        details: expect.objectContaining({ enabled: false }),
      }),
    });
    expect(
      (mocks.agreementUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data,
    ).not.toHaveProperty("status");
  });
});
