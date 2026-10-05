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
  raw: vi.fn(),
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
    mocks.raw,
  ]) {
    fn.mockResolvedValue([]);
  }
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
    expect(mocks.invoice).not.toHaveBeenCalled();
    expect(mocks.notice).not.toHaveBeenCalled();
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
      mocks.invoice.mockResolvedValue([
        {
          id: "inv-1",
          customerId: "c-1",
          dueDate: new Date(0),
          amountDueCents: 6000,
          amountPaidCents: 0,
          customer: { user: { name: "Customer", email: "c@example.test" } },
        },
      ]);
      const result = await getExceptions();
      expect(result.some((x) => x.category === "PAST_DUE_INVOICE")).toBe(true);
      expect(mocks.invoice).toHaveBeenCalledOnce();
      expect(mocks.job).toHaveBeenCalledTimes(2);
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
    const calls = [mocks.agreement, mocks.invoice, mocks.job, mocks.request, mocks.appliance, mocks.notice, mocks.pendingDelivery].flatMap(
      (fn) => fn.mock.calls.map(([query]) => query),
    );
    expect(calls.length).toBe(12);
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
