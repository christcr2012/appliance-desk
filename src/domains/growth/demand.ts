import { prisma } from "@/lib/prisma";

export type DemandEstimateRow = {
  applianceTypeId: string;
  applianceTypeName: string;
  fleetUnits: number;
  unitsInCustomerCustody: number;
  availableUnitsEstimate: number;
  openLeadRequestedUnits: number;
  estimatedUnitGap: number;
};

export function computeDemandEstimateRow(input: {
  applianceTypeId: string;
  applianceTypeName: string;
  fleetUnits: number;
  unitsInCustomerCustody: number;
  openLeadRequestedUnits: number;
}): DemandEstimateRow {
  const availableUnitsEstimate = Math.max(0, input.fleetUnits - input.unitsInCustomerCustody);
  return {
    ...input,
    availableUnitsEstimate,
    estimatedUnitGap: Math.max(0, input.openLeadRequestedUnits - availableUnitsEstimate),
  };
}

/**
 * Explainable planning signal only — not a forecast or purchase instruction.
 * Demand is open lead-requested units; supply-on-hand is fleet units without an
 * open physical custody episode. Assignment bookkeeping is deliberately ignored.
 */
export async function getDemandEstimate(): Promise<DemandEstimateRow[]> {
  const types = await prisma.applianceType.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      appliances: {
        where: { archivedAt: null, status: { not: "RETIRED" } },
        select: {
          id: true,
          custodyEpisodes: {
            where: { closedAt: null },
            select: { id: true },
            take: 1,
          },
        },
      },
      leadRequests: {
        where: { lead: { status: { in: ["NEW", "CONTACTED"] } } },
        select: { quantity: true },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });

  return types
    .map((type) =>
      computeDemandEstimateRow({
        applianceTypeId: type.id,
        applianceTypeName: type.name,
        fleetUnits: type.appliances.length,
        unitsInCustomerCustody: type.appliances.filter((unit) => unit.custodyEpisodes.length > 0).length,
        openLeadRequestedUnits: type.leadRequests.reduce((sum, request) => sum + request.quantity, 0),
      }),
    )
    .filter((row) => row.openLeadRequestedUnits > 0 || row.estimatedUnitGap > 0)
    .sort(
      (a, b) =>
        b.estimatedUnitGap - a.estimatedUnitGap ||
        b.openLeadRequestedUnits - a.openLeadRequestedUnits ||
        a.applianceTypeName.localeCompare(b.applianceTypeName) ||
        a.applianceTypeId.localeCompare(b.applianceTypeId),
    )
    .slice(0, 100);
}
