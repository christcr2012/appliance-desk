import { describe, expect, it, vi } from "vitest";
import { loadRentalAcquisitionBasis } from "@/domains/tax/locations";
import type { Prisma } from "@prisma/client";

describe("T-6D2 billing-period acquisition lineage", () => {
  it("uses the assignment at the billing-period start, not a later swap", async () => {
    const start = new Date("2026-10-01T00:00:00Z");
    const findMany = vi.fn(async () => [{
      id: "rental-line",
      assignments: [{
        appliance: {
          id: "outgoing-washer",
          acquisitionTaxStatus: "USE_TAX_PAID",
          acquisitionTaxPaidCents: 100,
        },
      }],
    }]);
    const tx = { rentalLine: { findMany } } as unknown as Prisma.TransactionClient;
    const result = await loadRentalAcquisitionBasis(tx, "agreement", start, [
      { key: "invoice-line", kind: "RENTAL", rentalLineId: "rental-line" },
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["rental-line"] }, agreementId: "agreement" },
      select: expect.objectContaining({
        assignments: expect.objectContaining({
          where: { assignedAt: { lte: start }, OR: [
            { unassignedAt: null }, { unassignedAt: { gt: start } },
          ] },
        }),
      }),
    }));
    expect(result.get("invoice-line")).toEqual([{
      applianceId: "outgoing-washer", status: "USE_TAX_PAID", verifiedTaxPaid: true,
    }]);
  });

  it("returns no inferred exemption for a rental with no billing period", async () => {
    const findMany = vi.fn();
    const tx = { rentalLine: { findMany } } as unknown as Prisma.TransactionClient;
    const result = await loadRentalAcquisitionBasis(tx, "agreement", null, [
      { key: "rent", kind: "RENTAL", rentalLineId: "rental-line" },
    ]);
    expect(result.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
