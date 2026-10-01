import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const m = vi.hoisted(() => ({
  role: vi.fn(),
  appliances: vi.fn(),
  assignments: vi.fn(),
  repairs: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appliance: { findMany: m.appliances },
    applianceAssignment: { findMany: m.assignments },
    jobAppliance: { findMany: m.repairs },
  },
}));
import {
  getFleetAnalytics,
  type ApplianceProfitability,
} from "@/domains/inventory";
import { fleetReportPage } from "@/domains/inventory/fleet-report";
import { ApplianceEarningsSummary } from "@/components/desk/appliance-earnings-summary";
const asOf = new Date("2026-10-01T00:00:00Z");
beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  m.role.mockResolvedValue({ user: { role: "OWNER" } });
  m.appliances.mockResolvedValue([]);
  m.assignments.mockResolvedValue([]);
  m.repairs.mockResolvedValue([]);
});

it("reconciles known, explicit-zero and blank costs without claiming unknown cost recovery", async () => {
  m.appliances.mockResolvedValue([
    {
      id: "known",
      assetNumber: "A",
      applianceType: { name: "Washer" },
      status: "RENTED",
      acquisitionCostCents: 2000,
      createdAt: new Date("2026-08-01"),
    },
    {
      id: "unknown",
      assetNumber: "B",
      applianceType: { name: "Dryer" },
      status: "AVAILABLE",
      acquisitionCostCents: null,
      createdAt: new Date("2026-08-01"),
    },
    {
      id: "zero",
      assetNumber: "C",
      applianceType: { name: "Washer" },
      status: "AVAILABLE",
      acquisitionCostCents: 0,
      createdAt: new Date("2026-08-01"),
    },
    {
      id: "partial",
      assetNumber: "D",
      applianceType: { name: "Washer" },
      status: "AVAILABLE",
      acquisitionCostCents: 500,
      createdAt: new Date("2026-08-01"),
    },
  ]);
  m.assignments.mockResolvedValue(
    ["known", "unknown"].map((applianceId) => ({
      applianceId,
      rentalLineId: "set",
      assignedAt: new Date("2026-09-01"),
      unassignedAt: null,
      rentalLine: { monthlyPriceCents: 6000 },
    })),
  );
  m.repairs.mockResolvedValue([
    {
      applianceId: "known",
      job: { id: "repair-complete", partsCostCents: 200, laborCostCents: 300 },
    },
    {
      applianceId: "partial",
      job: { id: "repair-partial", partsCostCents: 100, laborCostCents: null },
    },
  ]);
  const report = await getFleetAnalytics(asOf);
  expect(report.asOf).toBe(asOf);
  expect(report.totals).toMatchObject({
    totalRevenueCents: 6000,
    totalInvestedCents: 2500,
    totalRepairCostCents: 600,
    totalNetContributionCents: 2900,
    incompleteCostCount: 2,
    paidForItselfCount: 2,
  });
  expect(
    report.appliances.find((r) => r.applianceId === "known"),
  ).toMatchObject({
    revenueCents: 3000,
    netContributionCents: 500,
    paidForItself: true,
  });
  expect(
    report.appliances.find((r) => r.applianceId === "unknown"),
  ).toMatchObject({ acquisitionCostRecorded: false, paidForItself: false });
  expect(
    report.appliances.find((r) => r.applianceId === "partial"),
  ).toMatchObject({
    incompleteRepairJobIds: ["repair-partial"],
    paidForItself: false,
  });
  expect(m.repairs.mock.calls[0][0].where.job).toEqual({
    status: "COMPLETED",
    type: "MAINTENANCE_VISIT",
  });
});

it("denies unauthorized fleet reads before querying records", async () => {
  m.role.mockRejectedValue(new Error("Denied"));
  await expect(getFleetAnalytics(asOf)).rejects.toThrow("Denied");
  expect(m.appliances).not.toHaveBeenCalled();
  expect(m.assignments).not.toHaveBeenCalled();
  expect(m.repairs).not.toHaveBeenCalled();
});

function row(id: number, missing = false): ApplianceProfitability {
  return {
    applianceId: String(id),
    assetNumber: `UNIT-${String(id).padStart(3, "0")}`,
    applianceTypeName: "Washer",
    status: "AVAILABLE",
    revenueCents: 5000,
    repairCostCents: 100,
    acquisitionCostCents: 2000,
    netContributionCents: 2900,
    paidForItself: !missing,
    utilizationFraction: 0.5,
    acquisitionCostRecorded: !missing,
    incompleteRepairJobIds: [],
  };
}
it("pages all supporting units in stable order, retains cost filtering and clamps old links", () => {
  const rows = Array.from({ length: 60 }, (_, i) =>
    row(i, i % 2 === 0),
  ).reverse();
  const first = fleetReportPage(rows);
  const second = fleetReportPage(rows, "2");
  const third = fleetReportPage(rows, "999");
  expect(first.totalCount).toBe(60);
  expect(first.rows).toHaveLength(25);
  expect(
    new Set(
      [...first.rows, ...second.rows, ...third.rows].map((r) => r.applianceId),
    ).size,
  ).toBe(60);
  const missing = fleetReportPage(rows, "2", true);
  expect(missing.totalCount).toBe(30);
  expect(missing.rows).toHaveLength(5);
  expect(missing.rows.every((r) => !r.acquisitionCostRecorded)).toBe(true);
  expect(rows[0].applianceId).toBe("59");
  expect(fleetReportPage([], "garbage", true)).toMatchObject({
    page: 1,
    totalCount: 0,
    rows: [],
  });
});

it("makes incomplete estimates explicit and links the exact repair evidence", () => {
  render(
    <ApplianceEarningsSummary
      report={{ ...row(1, true), incompleteRepairJobIds: ["repair-42"] }}
    />,
  );
  expect(screen.getByText("Unknown — costs incomplete")).toBeVisible();
  expect(
    screen.getByText(/do not establish payments collected or business profit/),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Review repair repair-42" }),
  ).toHaveAttribute("href", "/desk/jobs/repair-42");
  expect(screen.getByText(/Acquisition cost is missing/)).toBeVisible();
});

it("labels cost recovery as an estimate even for complete records", () => {
  render(<ApplianceEarningsSummary report={row(1)} />);
  expect(screen.getByText("Covered by estimated rental value")).toBeVisible();
  expect(screen.queryByText("Unknown — costs incomplete")).toBeNull();
});
