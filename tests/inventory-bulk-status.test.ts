import { describe, it, expect, vi, beforeEach } from "vitest";

// bulkUpdateApplianceStatus (src/domains/inventory/index.ts) — the
// inventory list's multi-select "set status" action (Task #44's bulk
// actions). It reuses updateApplianceStatus per appliance rather than one
// all-or-nothing transaction, so a selection that mixes valid and invalid
// transitions still applies to what *can* move and reports the rest.

const applianceFindUniqueOrThrow = vi.fn();
const applianceUpdateMany = vi.fn();
const auditLogCreate = vi.fn();

vi.mock("@/domains/inventory/custody", () => ({ assertStatusChangeKeepsCustody: vi.fn() }));
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

import { bulkUpdateApplianceStatus } from "@/domains/inventory";

describe("bulkUpdateApplianceStatus", () => {
  beforeEach(() => {
    applianceFindUniqueOrThrow.mockReset();
    // updateApplianceStatus does findUniqueOrThrow twice per appliance now
    // (once to check the transition + read updatedAt, once to return the
    // fresh row after a successful conditional updateMany) — the mock
    // below always answers with the same status/updatedAt for a given id,
    // which is fine for these tests since nothing here exercises an
    // actual conflict (see tests/inventory-concurrency.test.ts for that).
    applianceUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    auditLogCreate.mockReset().mockResolvedValue({});
  });

  it("updates every appliance when the whole selection is a valid transition", async () => {
    applianceFindUniqueOrThrow.mockImplementation(({ where }) =>
      Promise.resolve({ id: where.id, status: "AVAILABLE", updatedAt: new Date("2026-09-01") }),
    );

    const result = await bulkUpdateApplianceStatus("user-1", ["app-1", "app-2"], "RENTED");

    expect(result.updated).toEqual(["app-1", "app-2"]);
    expect(result.skipped).toEqual([]);
    expect(applianceUpdateMany).toHaveBeenCalledTimes(2);
  });

  it("partially applies a mixed selection instead of failing the whole batch", async () => {
    applianceFindUniqueOrThrow.mockImplementation(({ where }) =>
      Promise.resolve({
        id: where.id,
        // app-2 is already retired — RETIRED can't transition anywhere.
        status: where.id === "app-2" ? "RETIRED" : "AVAILABLE",
        updatedAt: new Date("2026-09-01"),
      }),
    );

    const result = await bulkUpdateApplianceStatus(
      "user-1",
      ["app-1", "app-2", "app-3"],
      "RENTED",
    );

    expect(result.updated).toEqual(["app-1", "app-3"]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].applianceId).toBe("app-2");
    expect(result.skipped[0].reason).toMatch(/Retired/);
  });

  it("skips an appliance id that doesn't exist rather than throwing for the whole batch", async () => {
    applianceFindUniqueOrThrow.mockImplementation(({ where }) => {
      if (where.id === "missing") {
        return Promise.reject(new Error("No Appliance found"));
      }
      return Promise.resolve({ id: where.id, status: "AVAILABLE" });
    });

    const result = await bulkUpdateApplianceStatus("user-1", ["app-1", "missing"], "RENTED");

    expect(result.updated).toEqual(["app-1"]);
    expect(result.skipped).toEqual([
      { applianceId: "missing", reason: "No Appliance found" },
    ]);
  });

  it("returns an empty result for an empty selection", async () => {
    const result = await bulkUpdateApplianceStatus("user-1", [], "RENTED");
    expect(result).toEqual({ updated: [], skipped: [] });
    expect(applianceFindUniqueOrThrow).not.toHaveBeenCalled();
  });
});
