import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  purchaseFind: vi.fn(async () => []),
  supplierFind: vi.fn(async () => []),
}));
vi.mock("@/lib/job-role-guard", () => ({ jobRoleScreens: async () => null })); // ACC-5: no job role, so the access level alone decides
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findMany: vi.fn(async () => []) },
    appliance: { findMany: vi.fn(async () => []) },
    lead: { findMany: vi.fn(async () => []) },
    purchase: { findMany: mocks.purchaseFind },
    supplier: { findMany: mocks.supplierFind },
    auditLog: { findMany: vi.fn(async () => []) },
  },
}));

import { plainAction, getRecordConnections } from "@/domains/connections";
import { searchAll } from "@/domains/search";
import { ALLOWED_APPLIANCE_TRANSITIONS, APPLIANCE_STATUS_LABELS, applianceStatusAfterInspection, canTransitionApplianceStatus } from "@/domains/inventory/lifecycle";

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.purchaseFind.mockClear();
  mocks.supplierFind.mockClear();
});

describe("W-17 plain history wording", () => {
  it("never shows a raw code", () => {
    expect(plainAction("appliance.unit.status")).toBe("Status changed");
    expect(plainAction("appliance.repair_visit_drafted")).toMatch(/Repair visit drafted/);
    const fallback = plainAction("invoice.late_fee_waived");
    expect(fallback).toBe("Late fee waived");
    expect(fallback).not.toMatch(/[._]/);
    expect(plainAction("")).toBe("Updated");
  });
});

describe("W-17 connected records are owner/admin only", () => {
  it("refuses staff before reading anything", async () => {
    mocks.requireRole.mockRejectedValue(new Error("forbidden"));
    await expect(getRecordConnections("customer", "c1")).rejects.toThrow("forbidden");
    expect(mocks.requireRole).toHaveBeenCalledWith("OWNER", "ADMIN");
  });
});

describe("W-17 search for purchases and sellers", () => {
  it("never queries purchases or sellers for staff", async () => {
    mocks.requireRole.mockResolvedValue({ user: { id: "s", role: "STAFF" } });
    const result = await searchAll("acme");
    expect(mocks.purchaseFind).not.toHaveBeenCalled();
    expect(mocks.supplierFind).not.toHaveBeenCalled();
    expect(result.purchases).toEqual([]);
    expect(result.sellers).toEqual([]);
  });

  it("searches seller name, receipt number and seller records for the owner", async () => {
    mocks.requireRole.mockResolvedValue({ user: { id: "o", role: "OWNER" } });
    await searchAll("R-1001");
    const purchaseWhere = JSON.stringify((mocks.purchaseFind.mock.calls[0] as unknown[])[0]);
    expect(purchaseWhere).toContain("sellerName");
    expect(purchaseWhere).toContain("reference");
    expect(mocks.supplierFind).toHaveBeenCalledTimes(1);
  });
});

describe("W-17 cleaning step", () => {
  it("a passed inspection goes to Cleaning, a failed one to Maintenance", () => {
    expect(applianceStatusAfterInspection(true)).toBe("CLEANING");
    expect(applianceStatusAfterInspection(false)).toBe("MAINTENANCE");
  });
  it("Cleaning can only finish as Available (or go to repair or retire), never straight to rented", () => {
    expect(ALLOWED_APPLIANCE_TRANSITIONS.CLEANING).toEqual(["AVAILABLE", "MAINTENANCE", "RETIRED"]);
    expect(canTransitionApplianceStatus("CLEANING", "RENTED").ok).toBe(false);
    expect(APPLIANCE_STATUS_LABELS.CLEANING).toBe("Being cleaned");
  });
});
