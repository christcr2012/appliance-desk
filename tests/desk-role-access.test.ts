import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "STAFF",
  requireRole: vi.fn(),
  agreement: vi.fn(),
  agreements: vi.fn(),
  job: vi.fn(),
  updateJob: vi.fn(),
  appliance: vi.fn(),
  customer: vi.fn(),
  actor: vi.fn(),
  jobBefore: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/auth", () => ({ auth: { api: {} } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Checklist saves now run in one transaction: re-verify (with a row lock) that
// the acting staff member is still active, read the old checklist, update it,
// and write the audit entry together.
function makeTx() {
  return {
    $queryRaw: async () => [],
    user: { findUnique: mocks.actor },
    job: { findUniqueOrThrow: mocks.jobBefore, update: mocks.updateJob },
    auditLog: { create: mocks.audit },
  };
}
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
    rentalAgreement: {
      findUnique: mocks.agreement,
      findMany: mocks.agreements,
    },
    job: { findUnique: mocks.job, update: mocks.updateJob },
    appliance: { findUnique: mocks.appliance },
    customer: { findUnique: mocks.customer },
  },
}));

import {
  getDeskAgreementsPage,
  getDeskJobById,
  getOperationalAgreementById,
  getOperationalApplianceById,
} from "@/domains/desk-access";
import { getAgreementById } from "@/domains/agreements";
import { getJobById } from "@/domains/jobs";
import { getCustomerById } from "@/domains/customers";
import { getApplianceById, getFleetAnalytics } from "@/domains/inventory";
import { getCustomerTimeline } from "@/domains/customers/timeline";
import { setJobRepairCostsAction, updateJobChecklistAction } from "@/app/desk/jobs/actions";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.role = "STAFF";
  mocks.requireRole.mockImplementation(async (...allowed: string[]) => {
    if (!allowed.includes(mocks.role)) throw new Error("unauthorized");
    return { user: { id: "staff-1", role: mocks.role } };
  });
  mocks.actor.mockResolvedValue({ id: "staff-1", role: "STAFF", archivedAt: null });
  mocks.jobBefore.mockResolvedValue({ checklist: [] });
  mocks.audit.mockResolvedValue({});
  for (const read of [
    mocks.agreement,
    mocks.job,
    mocks.appliance,
    mocks.customer,
  ])
    read.mockResolvedValue(null);
  mocks.agreements.mockResolvedValue([]);
});

function expectOperationalSelect(query: {
  select?: unknown;
  include?: unknown;
}) {
  expect(query.select).toBeDefined();
  expect(query.include).toBeUndefined();
  expect(JSON.stringify(query.select)).not.toMatch(
    /Cents|billing|credits|signature|referredBy|metadata/,
  );
}

describe("desk query permissions", () => {
  it("blocks staff repair-cost mutations but preserves checklist updates", async () => {
    await expect(setJobRepairCostsAction("j-1", { partsCostDollars: "100" })).rejects.toThrow("unauthorized");
    expect(mocks.updateJob).not.toHaveBeenCalled();
    mocks.updateJob.mockResolvedValue({});
    const checklist = [{ item: "Operational check", checked: true }];
    expect(await updateJobChecklistAction("j-1", checklist)).toEqual({ status: "success" });
    expect(mocks.updateJob).toHaveBeenCalledWith({ where: { id: "j-1" }, data: { checklist } });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "job.checklist.update", userId: "staff-1" }) }),
    );
  });
  it("refuses a checklist save from a staff member who has since been deactivated", async () => {
    mocks.actor.mockResolvedValue({ id: "staff-1", role: "STAFF", archivedAt: new Date() });
    const result = await updateJobChecklistAction("j-1", [{ item: "Operational check", checked: true }]);
    expect(result).toMatchObject({ status: "error" });
    expect(mocks.updateJob).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("returns staff agreement counts without prices or free-text rental labels", async () => {
    mocks.agreements.mockResolvedValue([
      {
        id: "a-1",
        status: "ACTIVE",
        reservationExpiresAt: null,
        customer: {
          user: { name: "Customer", email: "customer@example.test" },
        },
        serviceAddress: { line1: "Test address", city: "Denver" },
        _count: { lines: 2 },
      },
    ]);
    const result = await getDeskAgreementsPage({ status: "ACTIVE" }, 20, 20);
    expect(result[0]).toMatchObject({
      id: "a-1",
      applianceCount: 2,
      monthlyCents: null,
    });
    expectOperationalSelect(mocks.agreements.mock.calls[0][0]);
    expect(mocks.agreements.mock.calls[0][0]).toMatchObject({
      where: { status: "ACTIVE" },
      skip: 20,
      take: 20,
    });
    expect(
      JSON.stringify(mocks.agreements.mock.calls[0][0].select),
    ).not.toContain("label");
  });

  it.each(["OWNER", "ADMIN"])(
    "retains agreement totals and job costs for %s",
    async (role) => {
      mocks.role = role;
      mocks.agreements.mockResolvedValue([
        {
          id: "a-1",
          status: "ACTIVE",
          reservationExpiresAt: null,
          customer: {},
          serviceAddress: {},
          lines: [{ monthlyPriceCents: 6000 }, { monthlyPriceCents: 3500 }],
        },
      ]);
      expect(
        (await getDeskAgreementsPage(undefined, 0, 20))[0]?.monthlyCents,
      ).toBe(9500);
      mocks.job.mockResolvedValue({ id: "j-1", partsCostCents: 12345 });
      expect(await getDeskJobById("j-1")).toMatchObject({
        partsCostCents: 12345,
      });
    },
  );

  it("selects operational job and appliance records without financial fields", async () => {
    await getDeskJobById("j-1");
    await getOperationalApplianceById("unit-1");
    await getOperationalAgreementById("a-1");
    for (const mock of [mocks.job, mocks.appliance, mocks.agreement]) {
      expectOperationalSelect(mock.mock.calls[0][0]);
    }
    expect(mocks.job.mock.calls[0][0].select).not.toHaveProperty("agreement");
    expect(
      mocks.agreement.mock.calls[0][0].select.lines.select,
    ).not.toHaveProperty("label");
  });

  it.each([
    getAgreementById,
    getJobById,
    getCustomerById,
    getApplianceById,
    getCustomerTimeline,
  ])(
    "refuses direct staff access to finance-bearing records before querying",
    async (read) => {
      await expect(read("record-1")).rejects.toThrow("unauthorized");
      for (const mock of [
        mocks.agreement,
        mocks.job,
        mocks.appliance,
        mocks.customer,
      ])
        expect(mock).not.toHaveBeenCalled();
    },
  );
  it("refuses staff fleet profitability queries", async () => {
    await expect(getFleetAnalytics()).rejects.toThrow("unauthorized");
    expect(mocks.appliance).not.toHaveBeenCalled();
  });
  it.each(["CUSTOMER", "SIGNED_OUT"])(
    "blocks %s from all operational desk record queries",
    async (role) => {
      mocks.role = role;
      for (const read of [
        getDeskJobById,
        getOperationalAgreementById,
        getOperationalApplianceById,
      ]) {
        await expect(read("other-record")).rejects.toThrow("unauthorized");
      }
      await expect(getDeskAgreementsPage(undefined, 0, 20)).rejects.toThrow(
        "unauthorized",
      );
      for (const mock of [
        mocks.agreement,
        mocks.agreements,
        mocks.job,
        mocks.appliance,
      ])
        expect(mock).not.toHaveBeenCalled();
    },
  );
});
