import { describe, it, expect, vi, beforeEach } from "vitest";

// Optimistic concurrency on Appliance edits (2026-09-28, docs/DECISIONS.md)
// — updateApplianceDetails and updateApplianceStatus both condition their
// write on `updatedAt` still matching what was just read, so a second,
// near-simultaneous edit doesn't silently overwrite the first one.

const applianceFindUniqueOrThrow = vi.fn();
const applianceUpdateMany = vi.fn();
const auditLogCreate = vi.fn();

vi.mock("@/domains/inventory/custody", () => ({ assertStatusChangeKeepsCustody: vi.fn() }));
vi.mock("@/lib/team-actor", () => ({ assertActiveTeamActor: vi.fn().mockResolvedValue({ id: "user-1", role: "OWNER", archivedAt: null }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) => fn((await import("@/lib/prisma")).prisma),
    appliance: {
      findUniqueOrThrow: (...args: unknown[]) => applianceFindUniqueOrThrow(...args),
      updateMany: (...args: unknown[]) => applianceUpdateMany(...args),
    },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
  },
}));

import { updateApplianceDetails, updateApplianceStatus, ApplianceConflictError } from "@/domains/inventory";

const ORIGINAL_UPDATED_AT = new Date("2026-09-28T12:00:00Z");

describe("updateApplianceDetails", () => {
  beforeEach(() => {
    applianceFindUniqueOrThrow.mockReset();
    applianceUpdateMany.mockReset();
    auditLogCreate.mockReset().mockResolvedValue({});
  });

  it("saves normally when nobody else touched the record since it was loaded", async () => {
    applianceUpdateMany.mockResolvedValue({ count: 1 });
    applianceFindUniqueOrThrow.mockResolvedValue({
      id: "app-1",
      notes: "Scratched left panel",
      updatedAt: new Date(),
    });

    const result = await updateApplianceDetails(
      "user-1",
      "app-1",
      { notes: "Scratched left panel" },
      ORIGINAL_UPDATED_AT,
    );

    expect(applianceUpdateMany).toHaveBeenCalledWith({
      where: { id: "app-1", updatedAt: ORIGINAL_UPDATED_AT },
      data: { notes: "Scratched left panel" },
    });
    expect(result.notes).toBe("Scratched left panel");
    expect(auditLogCreate).toHaveBeenCalledTimes(1);
  });

  it("throws ApplianceConflictError, and never writes the audit log, when the record changed first", async () => {
    // updateMany touching zero rows is exactly what happens when the
    // where clause's updatedAt no longer matches — someone else's edit
    // already moved it on.
    applianceUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      updateApplianceDetails("user-1", "app-1", { notes: "My edit" }, ORIGINAL_UPDATED_AT),
    ).rejects.toBeInstanceOf(ApplianceConflictError);

    expect(auditLogCreate).not.toHaveBeenCalled();
  });
});

describe("updateApplianceStatus", () => {
  beforeEach(() => {
    applianceFindUniqueOrThrow.mockReset();
    applianceUpdateMany.mockReset();
    auditLogCreate.mockReset().mockResolvedValue({});
  });

  it("updates normally when the record hasn't changed since it was read", async () => {
    applianceFindUniqueOrThrow
      .mockResolvedValueOnce({ id: "app-1", status: "AVAILABLE", updatedAt: ORIGINAL_UPDATED_AT })
      .mockResolvedValueOnce({ id: "app-1", status: "RENTED", updatedAt: new Date() });
    applianceUpdateMany.mockResolvedValue({ count: 1 });

    const result = await updateApplianceStatus("user-1", "app-1", "RENTED");

    expect(applianceUpdateMany).toHaveBeenCalledWith({
      where: { id: "app-1", updatedAt: ORIGINAL_UPDATED_AT },
      data: { status: "RENTED" },
    });
    expect(result.status).toBe("RENTED");
  });

  it("throws ApplianceConflictError when two status changes race each other", async () => {
    // Both "requests" read the same AVAILABLE/updatedAt snapshot, so both
    // pass canTransitionApplianceStatus — but only the first write can
    // still match that updatedAt.
    applianceFindUniqueOrThrow.mockResolvedValue({
      id: "app-1",
      status: "AVAILABLE",
      updatedAt: ORIGINAL_UPDATED_AT,
    });
    applianceUpdateMany.mockResolvedValue({ count: 0 });

    await expect(updateApplianceStatus("user-1", "app-1", "RENTED")).rejects.toBeInstanceOf(
      ApplianceConflictError,
    );
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it("still rejects an invalid transition before even touching updatedAt", async () => {
    applianceFindUniqueOrThrow.mockResolvedValue({
      id: "app-1",
      status: "RETIRED",
      updatedAt: ORIGINAL_UPDATED_AT,
    });

    await expect(updateApplianceStatus("user-1", "app-1", "AVAILABLE")).rejects.toThrow(/Retired/);
    expect(applianceUpdateMany).not.toHaveBeenCalled();
  });
});
