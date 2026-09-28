import { requireRole } from "@/lib/session";
import { getAppliances } from "@/domains/inventory";
import { toCsv } from "@/lib/csv";
import { APPLIANCE_STATUS_LABELS, ALL_APPLIANCE_STATUSES } from "@/domains/inventory/lifecycle";
import type { ApplianceStatus } from "@prisma/client";

function isApplianceStatus(value: string | null): value is ApplianceStatus {
  return ALL_APPLIANCE_STATUSES.includes(value as ApplianceStatus);
}

/** CSV export of the fleet — the full list (or one status filter, same
 * as the on-screen tabs), not just the current page, since this is
 * meant for spreadsheet use outside the app. */
export async function GET(request: Request) {
  await requireRole("OWNER", "ADMIN");

  const { searchParams } = new URL(request.url);
  const rawStatus = searchParams.get("status");
  const status = isApplianceStatus(rawStatus) ? rawStatus : undefined;

  const appliances = await getAppliances(status ? { status } : undefined);

  const csv = toCsv(
    [
      { key: "assetNumber", header: "Asset #" },
      { key: "type", header: "Type" },
      { key: "status", header: "Status" },
      { key: "manufacturer", header: "Manufacturer" },
      { key: "model", header: "Model" },
      { key: "serialNumber", header: "Serial #" },
      { key: "color", header: "Color" },
      { key: "condition", header: "Condition" },
      { key: "currentLocation", header: "Location" },
      { key: "acquisitionCost", header: "Acquisition cost ($)" },
      { key: "purchaseDate", header: "Purchase date" },
    ],
    appliances.map((a) => ({
      assetNumber: a.assetNumber,
      type: a.applianceType.name,
      status: APPLIANCE_STATUS_LABELS[a.status],
      manufacturer: a.manufacturer ?? "",
      model: a.model ?? "",
      serialNumber: a.serialNumber ?? "",
      color: a.color ?? "",
      condition: a.condition ?? "",
      currentLocation: a.currentLocation ?? "",
      acquisitionCost: a.acquisitionCostCents !== null ? (a.acquisitionCostCents / 100).toFixed(2) : "",
      purchaseDate: a.purchaseDate ? a.purchaseDate.toISOString().slice(0, 10) : "",
    })),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inventory-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
