import { describe, it, expect, vi, beforeEach } from "vitest";

// Appliance guided actions (2026-09-28, /desk/inventory/[id]) — repair,
// retire, swap, inspection, and the history timeline. Mocked prisma (same
// pattern as tests/customer-workspace.test.ts) since these are atomic
// multi-step DB wrappers built on the pure rules in
// src/domains/inventory/lifecycle.ts, not something that needs a real
// database to prove correct.

const applianceFindUniqueOrThrow = vi.fn();
const applianceUpdateMany = vi.fn();
const applianceFindMany = vi.fn();
const applianceAssignmentFindFirst = vi.fn();
const applianceAssignmentUpdateMany = vi.fn();
const applianceAssignmentCreate = vi.fn();
const jobCreate = vi.fn();
const auditLogCreate = vi.fn();
const applianceInspectionCreate = vi.fn();
const auditLogFindMany = vi.fn();
const jobApplianceFindMany = vi.fn();
const applianceInspectionFindMany = vi.fn();
const getBusinessSettings = vi.fn();

function makeTx() {
  return {
    appliance: { updateMany: (...args: unknown[]) => applianceUpdateMany(...args) },
    applianceAssignment: {
      updateMany: (...args: unknown[]) => applianceAssignmentUpdateMany(...args),
      create: (...args: unknown[]) => applianceAssignmentCreate(...args),
    },
    job: { create: (...args: unknown[]) => jobCreate(...args) },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
    applianceInspection: { create: (...args: unknown[]) => applianceInspectionCreate(...args) },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appliance: {
      findUniqueOrThrow: (...args: unknown[]) => applianceFindUniqueOrThrow(...args),
      updateMany: (...args: unknown[]) => applianceUpdateMany(...args),
      findMany: (...args: unknown[]) => applianceFindMany(...args),
    },
    applianceAssignment: {
      findFirst: (...args: unknown[]) => applianceAssignmentFindFirst(...args),
      updateMany: (...args: unknown[]) => applianceAssignmentUpdateMany(...args),
      create: (...args: unknown[]) => applianceAssignmentCreate(...args),
    },
    job: { create: (...args: unknown[]) => jobCreate(...args) },
    auditLog: {
      create: (...args: unknown[]) => auditLogCreate(...args),
      findMany: (...args: unknown[]) => auditLogFindMany(...args),
    },
    applianceInspection: {
      create: (...args: unknown[]) => applianceInspectionCreate(...args),
      findMany: (...args: unknown[]) => applianceInspectionFindMany(...args),
    },
    jobAppliance: { findMany: (...args: unknown[]) => jobApplianceFindMany(...args) },
    applianceCustodyEpisode: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: (callback: (tx: ReturnType<typeof makeTx>) => unknown) => callback(makeTx()),
  },
}));

vi.mock("@/domains/settings", () => ({
  getBusinessSettings: (...args: unknown[]) => getBusinessSettings(...args),
}));

beforeEach(() => {
  applianceFindUniqueOrThrow.mockReset();
  applianceUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  applianceFindMany.mockReset().mockResolvedValue([]);
  applianceAssignmentFindFirst.mockReset().mockResolvedValue(null);
  applianceAssignmentUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  applianceAssignmentCreate.mockReset().mockResolvedValue({});
  jobCreate.mockReset().mockResolvedValue({ id: "job-1" });
  auditLogCreate.mockReset().mockResolvedValue({});
  applianceInspectionCreate.mockReset().mockResolvedValue({});
  auditLogFindMany.mockReset().mockResolvedValue([]);
  jobApplianceFindMany.mockReset().mockResolvedValue([]);
  applianceInspectionFindMany.mockReset().mockResolvedValue([]);
  getBusinessSettings.mockReset().mockResolvedValue({ inspectionChecklist: [] });
});

describe("startRepairForAppliance", () => {
  it("creates a maintenance-visit job and moves the appliance to MAINTENANCE atomically", async () => {
    applianceFindUniqueOrThrow.mockResolvedValue({ id: "app-1", status: "AVAILABLE" });
    const { startRepairForAppliance } = await import("@/domains/inventory/guided-actions");

    const result = await startRepairForAppliance("user-1", "app-1", "Won't spin");

    expect(result).toEqual({ jobId: "job-1" });
    expect(jobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "MAINTENANCE_VISIT",
          notes: "Won't spin",
          customerId: null,
          appliances: { create: [{ applianceId: "app-1" }] },
        }),
      }),
    );
    expect(applianceUpdateMany).toHaveBeenCalledWith({
      where: { id: "app-1", status: "AVAILABLE" },
      data: { status: "MAINTENANCE" },
    });
    expect(auditLogCreate).toHaveBeenCalled();
  });

  it("links the job to the current customer/agreement when the appliance is on an active assignment", async () => {
    applianceFindUniqueOrThrow.mockResolvedValue({ id: "app-1", status: "RENTED" });
    applianceAssignmentFindFirst.mockResolvedValue({
      id: "assign-1",
      rentalLineId: "line-1",
      rentalLine: {
        agreementId: "agr-1",
        agreement: {
          customerId: "cust-1",
          serviceAddressId: "addr-1",
          customer: {},
          serviceAddress: {},
        },
      },
    });
    const { startRepairForAppliance } = await import("@/domains/inventory/guided-actions");

    await startRepairForAppliance("user-1", "app-1");

    expect(jobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: "cust-1",
          serviceAddressId: "addr-1",
          agreementId: "agr-1",
        }),
      }),
    );
  });

  it("rejects a repair for an appliance whose status can't move to MAINTENANCE", async () => {
    applianceFindUniqueOrThrow.mockResolvedValue({ id: "app-1", status: "RETIRED" });
    const { startRepairForAppliance } = await import("@/domains/inventory/guided-actions");

    await expect(startRepairForAppliance("user-1", "app-1")).rejects.toThrow(/can't move/i);
    expect(jobCreate).not.toHaveBeenCalled();
  });

  it("throws a friendly conflict error when the status changed out from under it", async () => {
    applianceFindUniqueOrThrow.mockResolvedValue({ id: "app-1", status: "AVAILABLE" });
    applianceUpdateMany.mockResolvedValue({ count: 0 });
    const { startRepairForAppliance } = await import("@/domains/inventory/guided-actions");

    await expect(startRepairForAppliance("user-1", "app-1")).rejects.toThrow(/changed by someone else/i);
  });
});

describe("retireAppliance", () => {
  it("requires a non-empty reason", async () => {
    const { retireAppliance } = await import("@/domains/inventory/guided-actions");

    await expect(retireAppliance("user-1", "app-1", "   ")).rejects.toThrow(/reason is required/i);
    expect(applianceFindUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("rejects retiring an appliance that's already retired", async () => {
    applianceFindUniqueOrThrow.mockResolvedValue({ id: "app-1", status: "RETIRED", notes: null });
    const { retireAppliance } = await import("@/domains/inventory/guided-actions");

    await expect(retireAppliance("user-1", "app-1", "Compressor failed")).rejects.toThrow(
      /already its current status/i,
    );
  });

  it("appends the reason to existing notes and records the audit entry", async () => {
    applianceFindUniqueOrThrow.mockResolvedValue({
      id: "app-1",
      status: "MAINTENANCE",
      notes: "Purchased 2024.",
    });
    const { retireAppliance } = await import("@/domains/inventory/guided-actions");

    await retireAppliance("user-1", "app-1", "  Compressor failed, not economical to repair  ");

    expect(applianceUpdateMany).toHaveBeenCalledWith({
      where: { id: "app-1", status: "MAINTENANCE" },
      data: {
        status: "RETIRED",
        notes: "Purchased 2024.\n\nRetired: Compressor failed, not economical to repair",
      },
    });
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newValue: { status: "RETIRED", reason: "Compressor failed, not economical to repair" },
        }),
      }),
    );
  });
});

describe("getSwapCandidates", () => {
  it("only offers other AVAILABLE units of the exact same appliance type", async () => {
    applianceFindUniqueOrThrow.mockResolvedValue({ id: "app-1", applianceTypeId: "type-1" });
    const { getSwapCandidates } = await import("@/domains/inventory/guided-actions");

    await getSwapCandidates("app-1");

    expect(applianceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { applianceTypeId: "type-1", status: "AVAILABLE", id: { not: "app-1" } },
      }),
    );
  });
});

describe("startSwapForAppliance", () => {
  it("rejects swapping a unit in for itself", async () => {
    const { startSwapForAppliance } = await import("@/domains/inventory/guided-actions");

    await expect(startSwapForAppliance("user-1", "app-1", "app-1")).rejects.toThrow(/different unit/i);
  });

  it("requires the old appliance to be on an active assignment", async () => {
    applianceFindUniqueOrThrow
      .mockResolvedValueOnce({ id: "app-1", status: "RENTED", applianceTypeId: "type-1" })
      .mockResolvedValueOnce({ id: "app-2", status: "AVAILABLE", applianceTypeId: "type-1" });
    applianceAssignmentFindFirst.mockResolvedValue(null);
    const { startSwapForAppliance } = await import("@/domains/inventory/guided-actions");

    await expect(startSwapForAppliance("user-1", "app-1", "app-2")).rejects.toThrow(/nothing to swap/i);
  });

  it("requires the replacement to be the same appliance type", async () => {
    applianceFindUniqueOrThrow
      .mockResolvedValueOnce({ id: "app-1", status: "RENTED", applianceTypeId: "type-1" })
      .mockResolvedValueOnce({ id: "app-2", status: "AVAILABLE", applianceTypeId: "type-2" });
    applianceAssignmentFindFirst.mockResolvedValue({
      id: "assign-1",
      rentalLineId: "line-1",
      rentalLine: { agreementId: "agr-1", agreement: { customerId: "cust-1", serviceAddressId: "addr-1" } },
    });
    const { startSwapForAppliance } = await import("@/domains/inventory/guided-actions");

    await expect(startSwapForAppliance("user-1", "app-1", "app-2")).rejects.toThrow(/same appliance type/i);
  });

  it("requires the replacement to be AVAILABLE", async () => {
    applianceFindUniqueOrThrow
      .mockResolvedValueOnce({ id: "app-1", status: "RENTED", applianceTypeId: "type-1" })
      .mockResolvedValueOnce({ id: "app-2", status: "MAINTENANCE", applianceTypeId: "type-1" });
    applianceAssignmentFindFirst.mockResolvedValue({
      id: "assign-1",
      rentalLineId: "line-1",
      rentalLine: { agreementId: "agr-1", agreement: { customerId: "cust-1", serviceAddressId: "addr-1" } },
    });
    const { startSwapForAppliance } = await import("@/domains/inventory/guided-actions");

    await expect(startSwapForAppliance("user-1", "app-1", "app-2")).rejects.toThrow(/isn't currently available/i);
  });

  it("unassigns the old unit, assigns the replacement, moves both statuses, and creates one SWAP job", async () => {
    applianceFindUniqueOrThrow
      .mockResolvedValueOnce({ id: "app-1", status: "RENTED", applianceTypeId: "type-1" })
      .mockResolvedValueOnce({ id: "app-2", status: "AVAILABLE", applianceTypeId: "type-1" });
    applianceAssignmentFindFirst.mockResolvedValue({
      id: "assign-1",
      rentalLineId: "line-1",
      rentalLine: {
        agreementId: "agr-1",
        agreement: { customerId: "cust-1", serviceAddressId: "addr-1" },
      },
    });
    const { startSwapForAppliance } = await import("@/domains/inventory/guided-actions");

    const result = await startSwapForAppliance("user-1", "app-1", "app-2");

    expect(result).toEqual({ jobId: "job-1" });
    expect(applianceAssignmentUpdateMany).toHaveBeenCalledWith({
      where: { id: "assign-1", unassignedAt: null },
      data: expect.objectContaining({ unassignReason: "Swapped out for repair" }),
    });
    expect(applianceAssignmentCreate).toHaveBeenCalledWith({
      data: { rentalLineId: "line-1", applianceId: "app-2" },
    });
    expect(applianceUpdateMany).toHaveBeenCalledWith({
      where: { id: "app-1", status: "RENTED" },
      data: { status: "MAINTENANCE" },
    });
    expect(applianceUpdateMany).toHaveBeenCalledWith({
      where: { id: "app-2", status: "AVAILABLE" },
      data: { status: "RESERVED" },
    });
    expect(jobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "SWAP",
          customerId: "cust-1",
          appliances: { create: [{ applianceId: "app-1" }, { applianceId: "app-2" }] },
        }),
      }),
    );
    expect(auditLogCreate).toHaveBeenCalledTimes(2);
  });
});

describe("recordApplianceInspection", () => {
  it("requires the appliance to currently be AWAITING_INSPECTION", async () => {
    applianceFindUniqueOrThrow.mockResolvedValue({ id: "app-1", status: "AVAILABLE", condition: null });
    const { recordApplianceInspection } = await import("@/domains/inventory/guided-actions");

    await expect(
      recordApplianceInspection("user-1", "app-1", { passed: true, checklist: [] }),
    ).rejects.toThrow(/isn't currently awaiting inspection/i);
    expect(applianceInspectionCreate).not.toHaveBeenCalled();
  });

  it("a pass moves the appliance to AVAILABLE and records the inspection", async () => {
    applianceFindUniqueOrThrow.mockResolvedValue({
      id: "app-1",
      status: "AWAITING_INSPECTION",
      condition: "Fair",
    });
    const { recordApplianceInspection } = await import("@/domains/inventory/guided-actions");

    await recordApplianceInspection("user-1", "app-1", {
      passed: true,
      checklist: [{ item: "Runs a cycle", checked: true }],
      notes: "Looks good",
      condition: "Good",
    });

    expect(applianceInspectionCreate).toHaveBeenCalledWith({
      data: {
        applianceId: "app-1",
        passed: true,
        checklist: [{ item: "Runs a cycle", checked: true }],
        notes: "Looks good",
        condition: "Good",
        inspectedById: "user-1",
      },
    });
    expect(applianceUpdateMany).toHaveBeenCalledWith({
      where: { id: "app-1", status: "AWAITING_INSPECTION" },
      data: { status: "AVAILABLE", condition: "Good" },
    });
  });

  it("a fail moves the appliance to MAINTENANCE", async () => {
    applianceFindUniqueOrThrow.mockResolvedValue({
      id: "app-1",
      status: "AWAITING_INSPECTION",
      condition: "Fair",
    });
    const { recordApplianceInspection } = await import("@/domains/inventory/guided-actions");

    await recordApplianceInspection("user-1", "app-1", { passed: false, checklist: [] });

    expect(applianceUpdateMany).toHaveBeenCalledWith({
      where: { id: "app-1", status: "AWAITING_INSPECTION" },
      data: { status: "MAINTENANCE", condition: "Fair" },
    });
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newValue: { status: "MAINTENANCE", reason: "Inspection failed" },
        }),
      }),
    );
  });
});

describe("getInspectionChecklist", () => {
  it("uses Chris's custom checklist from settings when he's set one", async () => {
    getBusinessSettings.mockResolvedValue({ inspectionChecklist: ["Check for leaks", "Test spin cycle"] });
    const { getInspectionChecklist } = await import("@/domains/inventory/guided-actions");

    expect(await getInspectionChecklist()).toEqual(["Check for leaks", "Test spin cycle"]);
  });

  it("falls back to the built-in default checklist when none is set", async () => {
    getBusinessSettings.mockResolvedValue({ inspectionChecklist: [] });
    const { getInspectionChecklist, } = await import("@/domains/inventory/guided-actions");
    const { DEFAULT_INSPECTION_CHECKLIST } = await import("@/domains/inventory/lifecycle");

    expect(await getInspectionChecklist()).toEqual(DEFAULT_INSPECTION_CHECKLIST);
  });
});

describe("getApplianceHistory", () => {
  it("merges status changes, jobs, and inspections into one list, newest first", async () => {
    auditLogFindMany.mockResolvedValue([
      {
        id: "audit-1",
        action: "appliance.unit.status",
        newValue: { status: "MAINTENANCE", reason: "Repair started" },
        createdAt: new Date("2026-09-20"),
      },
    ]);
    jobApplianceFindMany.mockResolvedValue([
      {
        job: {
          id: "job-1",
          type: "MAINTENANCE_VISIT",
          status: "COMPLETED",
          completionNotes: "Replaced belt",
          createdAt: new Date("2026-09-22"),
        },
      },
    ]);
    applianceInspectionFindMany.mockResolvedValue([
      { id: "insp-1", passed: true, notes: "All good", createdAt: new Date("2026-09-18") },
    ]);
    const { getApplianceHistory } = await import("@/domains/inventory/guided-actions");

    const history = await getApplianceHistory("app-1");

    expect(history.map((h) => h.id)).toEqual(["job-job-1", "audit-audit-1", "inspection-insp-1"]);
    expect(history[0].summary).toBe("maintenance visit job — completed");
    expect(history[1].summary).toBe("Status changed to MAINTENANCE");
    expect(history[2].summary).toBe("Inspection passed");
  });
});
