import type { ExceptionItem } from "./rules";
import { loadVehicleOverview } from "@/domains/vehicle/reads";

/** Owner To do items for the delivery vehicle: registration month, maintenance due, medical card. */
export async function listVehicleAttention(now: Date): Promise<ExceptionItem[]> {
  const overview = await loadVehicleOverview(now);
  const rows: ExceptionItem[] = [];
  for (const v of overview.vehicles) {
    for (const d of v.due) {
      rows.push({
        category: "VEHICLE_DUE", severity: d.overdue ? "high" : "medium", title: `${d.label} (${v.nickname})`,
        detail: d.detail, href: "/desk/vehicle", since: now,
      });
    }
  }
  return rows;
}
