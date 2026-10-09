import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  agreement: vi.fn(),
  invoice: vi.fn(),
  job: vi.fn(),
  request: vi.fn(),
  appliance: vi.fn(),
  notice: vi.fn(),
  pendingDelivery: vi.fn(),
  providerOp: vi.fn(),
  raw: vi.fn(),
  earlyResolution: vi.fn(),
  audit: vi.fn(),
  taxExemption: vi.fn(),
  taxAddressLocation: vi.fn(),
  officialSourceWatch: vi.fn(),
  systemIssues: vi.fn(),
  systemIssueCount: vi.fn(),
  officialRateAttention: vi.fn(async () => []),
  rdfRefundAttention: vi.fn(async () => []),
  filingAttention: vi.fn(async () => ({ returns: { rows: [], total: 0 }, licenses: { rows: [], total: 0 } })),
  amendmentAttention: vi.fn(async () => ({ amendments: { rows: [], total: 0 }, readiness: { rows: [], total: 0 } })),
  acquisitionAttention: vi.fn(async () => []),
}));
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
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: { findMany: mocks.agreement },
    invoice: { findMany: mocks.invoice },
    job: { findMany: mocks.job },
    maintenanceRequest: { findMany: mocks.request },
    appliance: { findMany: mocks.appliance },
    customerNotice: { findMany: mocks.notice },
    pendingDelivery: { findMany: mocks.pendingDelivery },
    earlyReturnResolution: { findMany: mocks.earlyResolution },
    providerOperation: { findMany: mocks.providerOp, count: vi.fn().mockResolvedValue(0) },
    auditLog: { findMany: mocks.audit },
    customerTaxExemption: {
      findMany: mocks.taxExemption,
      count: vi.fn().mockResolvedValue(0),
    },
    addressTaxLocation: {
      findMany: mocks.taxAddressLocation,
      count: vi.fn().mockResolvedValue(0),
    },
    systemIssue: { findMany: mocks.systemIssues, count: mocks.systemIssueCount },
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
  for (const fn of [
    mocks.agreement,
    mocks.invoice,
    mocks.job,
    mocks.request,
    mocks.appliance,
    mocks.notice,
    mocks.pendingDelivery,
    mocks.providerOp,
    mocks.raw,
    mocks.earlyResolution,
    mocks.audit,
    mocks.taxExemption,
    mocks.taxAddressLocation,
    mocks.officialSourceWatch,
    mocks.systemIssues,
    mocks.officialRateAttention,
    mocks.rdfRefundAttention,
  ]) {
    fn.mockResolvedValue([]);
  }
  mocks.systemIssueCount.mockResolvedValue(0);
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
                dueDate: new Date(0),
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
    const calls = [mocks.agreement, mocks.invoice, mocks.job, mocks.request, mocks.appliance, mocks.notice, mocks.pendingDelivery, mocks.providerOp, mocks.taxExemption, mocks.taxAddressLocation, mocks.officialSourceWatch].flatMap(
      (fn) => fn.mock.calls.map(([query]) => query),
    );
    expect(calls.length).toBe(21); // includes bounded Sales tax draft-invoice, exemption-expiry, address-change and two official-source reads
    for (const query of calls) {
      expect(query.take).toBe(50);
      expect(query.orderBy.at(-1)).toEqual({ id: "asc" });
    }
  });

  it("selects a bounded schedule DTO without job costs or customer finance", async () => {
    await getTodaysJobs();
    expect(mocks.job.mock.calls[0][0].select).toEqual({
      id: true,
      type: true,
      status: true,
      scheduledAt: true,
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
