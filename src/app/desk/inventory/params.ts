import type { AcquisitionTaxStatus, ApplianceStatus } from "@prisma/client";
import { ALL_APPLIANCE_STATUSES } from "@/domains/inventory/lifecycle";
import type { FleetParams, FleetSort, FleetTab } from "@/domains/inventory/fleet-list";

export type { FleetParams, FleetSort, FleetTab };

/**
 * AR-6 section 3: the Fleet list's URL params.
 *
 * Tabs replace the old per-status filter. Old links keep working:
 * ?status=AVAILABLE (and friends) map to the tab that contains the status,
 * ?taxStatus= maps to tax, and ?page= is ignored (cursor paging now).
 * RETIRED is contained in no tab — retired appliances live on the Retired
 * page — so an old ?status=RETIRED link lands on "all" rather than
 * pretending the fleet list shows retired units.
 */
export const FLEET_TABS: { value: FleetTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready to rent" },
  { value: "out", label: "Out with customers" },
  { value: "coming-back", label: "Coming back" },
  { value: "needs-work", label: "Needs work" },
];

const TAB_BY_STATUS: Record<ApplianceStatus, FleetTab> = {
  AVAILABLE: "ready",
  RESERVED: "out",
  RENTED: "out",
  AWAITING_PICKUP: "coming-back",
  AWAITING_INSPECTION: "needs-work",
  CLEANING: "needs-work",
  MAINTENANCE: "needs-work",
  RETIRED: "all",
};

const TAX_STATES: AcquisitionTaxStatus[] = [
  "UNKNOWN",
  "SALES_TAX_PAID",
  "USE_TAX_DUE",
  "USE_TAX_PAID",
  "BOUGHT_TAX_FREE_FOR_LEASE",
];

export function parseFleetParams(
  raw: Record<string, string | undefined>,
  role: "OWNER" | "ADMIN" | "STAFF",
): FleetParams {
  let tab: FleetTab = "all";
  const statusRaw = raw.status;
  if (statusRaw) {
    if ((FLEET_TABS as { value: string }[]).some((t) => t.value === statusRaw)) {
      tab = statusRaw as FleetTab;
    } else if ((ALL_APPLIANCE_STATUSES as string[]).includes(statusRaw)) {
      tab = TAB_BY_STATUS[statusRaw as ApplianceStatus];
    }
  }

  const taxRaw = raw.tax ?? raw.taxStatus;
  const tax =
    role !== "STAFF" && taxRaw && (TAX_STATES as string[]).includes(taxRaw)
      ? (taxRaw as AcquisitionTaxStatus)
      : undefined;

  const sort: FleetSort =
    raw.sort === "number" || raw.sort === "type" ? raw.sort : "newest";

  return {
    tab,
    type: raw.type?.trim() ? raw.type.trim() : undefined,
    tax,
    q: raw.q?.trim() ?? "",
    sort,
    cursor: raw.cursor?.trim() ? raw.cursor.trim() : undefined,
  };
}
