import { beforeEach, describe, expect, it, vi } from "vitest";

// FEE-1: the late-fee review list has its own database tests; here it must not add reads to the capped Today queries.
vi.mock("@/domains/exceptions/late-fee-attention", () => ({ listLateFeeReview: async () => ({ rows: [], total: 0 }) }));

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  requireRole: vi.fn(),
  agreement: vi.fn(),
  invoice: vi.fn(),
  job: vi.fn(),
  request: vi.fn(),
  appliance: vi.fn(),
  notice: vi.fn(),
  pendingDelivery: vi.fn(),
  providerOp: vi.fn(),
  signingPayment: vi.fn(),
  signingPaymentCount: vi.fn(),
  cancellationRefunds: vi.fn(),
  cancellationRefundCount: vi.fn(),
  raw: vi.fn(),
  earlyResolution: vi.fn(),
  audit: vi.fn(),
  snoozes: vi.fn(),
  taxExemption: vi.fn(),
  taxAddressLocation: vi.fn(),
  officialSourceWatch: vi.fn(),
  outOfService: vi.fn(),
  systemIssues: vi.fn(),
  systemIssueCount: vi.fn(),
  officialRateAttention: vi.fn(async () => []),
  rdfRefundAttention: vi.fn(async () => []),
  filingAttention: vi.fn(async () => ({ returns: { rows: [], total: 0 }, licenses: { rows: [], total: 0 }, setupChecks: { rows: [], total: 0 } })),
  amendmentAttention: vi.fn(async () => ({ amendments: { rows: [], total: 0 }, readiness: { rows: [], total: 0 } })),
  acquisitionAttention: vi.fn(async () => []),
}));
vi.mock("@/domains/paperwork", () => ({ listPaperworkAttention: vi.fn(async () => []) }));
vi.mock("@/domains/tax/acquisition-attention", () => ({
  listAcquisitionTaxAttention: mocks.acquisitionAttention,
}));
vi.mock("@/domains/tax/amendment-attention", () => ({
  listTaxAmendmentAttention: mocks.amendmentAttention,
}));
vi.mock("@/domains/tax/filing-attention", () => ({
  listTaxFilingAttention: mocks.filingAttention,
  listRdfRefundAttention: mocks.rdfRefundAttention,
}));
vi.mock("@/domains/tax/official-rate-auto-apply", () => ({
  listOfficialRateAttention: mocks.officialRateAttention,
}));
vi.mock("@/domains/exceptions/bank-payment-attention", () => ({
  listBankPaymentSlow: vi.fn(async () => ({ rows: [], total: 0 })),
}));
vi.mock("@/domains/exceptions/dispute-attention", () => ({
  listDisputeAttention: vi.fn(async () => ({ rows: [], total: 0 })),
}));
vi.mock("@/domains/exceptions/signed-delivery-attention", () => ({
  listSignedDeliveryAttention: vi.fn(async () => ({ rows: [], total: 0 })),
}));
vi.mock("@/domains/exceptions/money-turning-points", () => ({
  listHeldPaymentAttention: vi.fn(async () => ({ rows: [], total: 0 })),
  listDepositDecisionAttention: vi.fn(async () => ({ rows: [], total: 0 })),
}));
vi.mock("@/domains/exceptions/lead-turning-points", () => ({
  listNewLeadContact: vi.fn(async () => ({ rows: [], total: 0 })),
  listLeadFollowUps: vi.fn(async () => ({ rows: [], total: 0 })),
  listApprovedQuoteToRental: vi.fn(async () => ({ rows: [], total: 0 })),
}));
vi.mock("@/domains/exceptions/goal-attention", () => ({
  listGoalAttention: vi.fn(async () => []), // covered by tests/goals-integration.test.ts
}));
vi.mock("@/domains/exceptions/resale-tax-attention", () => ({
  listResaleTaxAttention: vi.fn(async () => []), // owner-only item; covered by tests/used-appliance-sale-integration.test.ts
}));
vi.mock("@/domains/exceptions/approval-attention", () => ({
  listApprovalAttention: vi.fn(async () => []), // owner-only approvals item; covered by tests/approvals-integration.test.ts
}));
vi.mock("@/domains/exceptions/unsigned-agreements", () => ({
  listUnsignedAgreements: vi.fn(async () => ({ rows: [], total: 0 })),
}));
vi.mock("@/domains/exceptions/turning-points-attention", () => ({
  listRentalEndingSoon: vi.fn(async () => ({ rows: [], total: 0 })),
  listPickupUnscheduled: vi.fn(async () => ({ rows: [], total: 0 })),
  listVisitNeedsAssignment: vi.fn(async () => ({ rows: [], total: 0 })),
  listCleaningNeeded: vi.fn(async () => ({ rows: [], total: 0 })),
}));
vi.mock("@/domains/exceptions/feedback-attention", () => ({
  listFeedbackWaiting: vi.fn(async () => ({ rows: [], total: 0 })),
}));
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: { findMany: mocks.agreement },
    invoice: { findMany: mocks.invoice, count: vi.fn().mockResolvedValue(0) },
    job: { findMany: mocks.job },
    businessSettings: { findUnique: mocks.settings },
    maintenanceRequest: { findMany: mocks.request },
    appliance: { findMany: mocks.appliance },
    customerNotice: { findMany: mocks.notice },
    pendingDelivery: { findMany: mocks.pendingDelivery },
    earlyReturnResolution: { findMany: mocks.earlyResolution },
    providerOperation: { findMany: mocks.providerOp, count: vi.fn().mockResolvedValue(0) },
    agreementSigningPayment: { findMany: mocks.signingPayment, count: mocks.signingPaymentCount },
    preDeliveryCancellation: { findMany: mocks.cancellationRefunds, count: mocks.cancellationRefundCount },
    auditLog: { findMany: mocks.audit },
    exceptionSnooze: { findMany: mocks.snoozes },
    customerTaxExemption: {
      findMany: mocks.taxExemption,
      count: vi.fn().mockResolvedValue(0),
    },
    addressTaxLocation: {
      findMany: mocks.taxAddressLocation,
      count: vi.fn().mockResolvedValue(0),
    },
    systemIssue: { findMany: mocks.systemIssues, count: mocks.systemIssueCount },
    outOfServicePeriod: { findMany: mocks.outOfService, count: vi.fn().mockResolvedValue(0) },
    officialSourceWatch: {
      findMany: mocks.officialSourceWatch,
      count: vi.fn().mockResolvedValue(0),
    },
    // R17: term-ended agreements and maintenance-due appliances are found with set-based SQL.
    $queryRaw: mocks.raw,
  },
}));

import { getExceptions, getTodaysJobs } from "@/domains/exceptions";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { role: "STAFF" } });
  mocks.settings.mockResolvedValue({ defaultJobDurationMinutes: 90 });
  for (const fn of [
    mocks.agreement,
    mocks.invoice,
    mocks.job,
    mocks.request,
    mocks.appliance,
    mocks.notice,
    mocks.pendingDelivery,
    mocks.providerOp,
    mocks.signingPayment,
    mocks.cancellationRefunds,
    mocks.raw,
    mocks.earlyResolution,
    mocks.audit,
    mocks.snoozes,
    mocks.taxExemption,
    mocks.taxAddressLocation,
    mocks.officialSourceWatch,
    mocks.systemIssues,
    mocks.officialRateAttention,
    mocks.rdfRefundAttention,
    mocks.outOfService,
  ]) {
    fn.mockResolvedValue([]);
  }
  mocks.systemIssueCount.mockResolvedValue(0);
  mocks.signingPaymentCount.mockResolvedValue(0);
  mocks.cancellationRefundCount.mockResolvedValue(0);
});

describe("Today server-side visibility", () => {
  it("does not query billing or repair bookkeeping for STAFF, preserving operational exceptions", async () => {
    mocks.job.mockResolvedValue([
      {
        id: "job-1",
        type: "DELIVERY",
        scheduledAt: new Date(0),
        customer: null,
      },
    ]);
    const result = await getExceptions();
    expect(result.map((x) => x.category)).toEqual(["OVERDUE_JOB"]);
    expect(mocks.filingAttention).not.toHaveBeenCalled();
    expect(mocks.rdfRefundAttention).not.toHaveBeenCalled();
    expect(mocks.amendmentAttention).not.toHaveBeenCalled();
    expect(mocks.acquisitionAttention).not.toHaveBeenCalled();
    expect(mocks.invoice).not.toHaveBeenCalled();
    expect(mocks.notice).not.toHaveBeenCalled();
    // The Stripe-update-pending read is money: STAFF never trigger it.
    expect(mocks.providerOp).not.toHaveBeenCalled();
    expect(mocks.signingPayment).not.toHaveBeenCalled();
    // An item still waiting for delivery is operational: STAFF see it too.
    expect(mocks.pendingDelivery).toHaveBeenCalledTimes(1);
    // stale reservations and renewals that did not start (term-ended agreements come from SQL)
    expect(mocks.agreement).toHaveBeenCalledTimes(2);
    expect(
      mocks.agreement.mock.calls.every(
        ([query]) => !query.where.billingBlockedReason,
      ),
    ).toBe(true);
    expect(mocks.job).toHaveBeenCalledTimes(1);
    expect(mocks.job.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ status: "SCHEDULED" }),
    );
  });

  it.each(["OWNER", "ADMIN"])(
    "retains finance exceptions for %s",
    async (role) => {
      mocks.requireRole.mockResolvedValue({ user: { role } });
      mocks.invoice.mockImplementation(async (query) =>
        query.where?.status === "DRAFT"
          ? []
          : [
              {
                id: "inv-1",
                customerId: "c-1",
                status: "OPEN",
                dueDate: new Date(0),
                updatedAt: new Date(0),
                payments: [],
                amountDueCents: 6000,
                amountPaidCents: 0,
                customer: { user: { name: "Customer", email: "c@example.test" } },
              },
            ],
      );
      const result = await getExceptions();
      expect(result.some((x) => x.category === "PAST_DUE_INVOICE")).toBe(true);
      expect(mocks.invoice).toHaveBeenCalledTimes(2);
      expect(mocks.job).toHaveBeenCalledTimes(2);
      expect(mocks.acquisitionAttention).toHaveBeenCalledTimes(1);
      expect(mocks.rdfRefundAttention).toHaveBeenCalledTimes(1);
    },
  );

  it.each([getExceptions, getTodaysJobs])(
    "rejects an unauthorized caller before any query",
    async (query) => {
      mocks.requireRole.mockRejectedValue(new Error("unauthorized"));
      await expect(query()).rejects.toThrow("unauthorized");
      for (const fn of [
        mocks.agreement,
        mocks.invoice,
        mocks.job,
        mocks.request,
        mocks.appliance,
      ]) {
        expect(fn).not.toHaveBeenCalled();
      }
    },
  );

  it("R17: every category read is capped at 50 and ordered oldest-first with an id tie-breaker", async () => {
    mocks.requireRole.mockResolvedValue({ user: { role: "OWNER" } });
    await getExceptions();
    const calls = [mocks.agreement, mocks.invoice, mocks.job, mocks.request, mocks.appliance, mocks.notice, mocks.pendingDelivery, mocks.providerOp, mocks.taxExemption, mocks.taxAddressLocation, mocks.officialSourceWatch, mocks.outOfService].flatMap(
      (fn) => fn.mock.calls.map(([query]) => query),
    );
    expect(calls.length).toBe(24); // includes the bounded retired-appliance read (M-2B), bounded Sales tax draft-invoice, exemption-expiry, address-change, two official-source reads, the W-16B old-set read and the W-21A out-of-service read
    for (const query of calls) {
      expect(query.take).toBe(50);
      expect(query.orderBy.at(-1)).toEqual({ id: "asc" });
    }
  });

  it("gives each visit its own length, else the business default", async () => {
    mocks.job.mockResolvedValueOnce([
      { id: "a", durationMinutes: 45 },
      { id: "b", durationMinutes: null },
    ]);
    const jobs = await getTodaysJobs();
    expect(jobs.map((j) => j.durationMinutes)).toEqual([45, 90]);
  });

  it("selects a bounded schedule DTO without job costs or customer finance", async () => {
    await getTodaysJobs();
    expect(mocks.job.mock.calls[0][0].select).toEqual({
      id: true,
      type: true,
      status: true,
      scheduledAt: true,
      durationMinutes: true,
      customer: { select: { user: { select: { name: true, email: true } } } },
      serviceAddress: { select: { line1: true, city: true } },
    });
  });
});

it("queries Colorado's entire DST transition day with a stable chronological order", async () => {
  await getTodaysJobs(new Date("2026-11-01T12:00:00Z"));
  expect(mocks.job).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        scheduledAt: {
          gte: new Date("2026-11-01T06:00:00Z"),
          lt: new Date("2026-11-02T07:00:00Z"),
        },
      },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    }),
  );
});
