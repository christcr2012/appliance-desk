import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  agreement: vi.fn(),
  invoice: vi.fn(),
  job: vi.fn(),
  request: vi.fn(),
  appliance: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: { findMany: mocks.agreement },
    invoice: { findMany: mocks.invoice },
    job: { findMany: mocks.job },
    maintenanceRequest: { findMany: mocks.request },
    appliance: { findMany: mocks.appliance },
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
    expect(mocks.agreement).toHaveBeenCalledTimes(4);
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
