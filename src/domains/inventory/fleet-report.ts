import type { ApplianceProfitability } from "./index";
import { paginationMeta, parsePage } from "@/domains/pagination";

export function fleetReportPage(
  rows: ApplianceProfitability[],
  rawPage?: string,
  missingOnly = false,
) {
  const filtered = rows.filter(
    (row) =>
      !missingOnly ||
      !row.acquisitionCostRecorded ||
      row.incompleteRepairJobIds.length > 0,
  );
  // Asset number is the operator's stable lookup key; ID breaks equal-key ties.
  filtered.sort(
    (a, b) =>
      a.assetNumber.localeCompare(b.assetNumber) ||
      a.applianceId.localeCompare(b.applianceId),
  );
  const meta = paginationMeta(filtered.length, parsePage(rawPage));
  return {
    ...meta,
    rows: filtered.slice(meta.skip, meta.skip + meta.pageSize),
  };
}
