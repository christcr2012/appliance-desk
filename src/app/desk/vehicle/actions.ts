"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { addManualTrip, archiveVehicle, finishRouteDay, recordMaintenance, saveVehicle, saveVehicleSettings, startRouteDay } from "@/domains/vehicle/actions";

export type VehicleActionState = { status: "idle" } | { status: "success"; message: string } | { status: "error"; message: string };

const fail = (error: unknown): VehicleActionState => ({ status: "error", message: error instanceof Error ? error.message : "Couldn't save that." });
const text = (fd: FormData, key: string) => String(fd.get(key) ?? "");
const int = (fd: FormData, key: string) => Number(text(fd, key).replaceAll(",", "").trim());
const optInt = (fd: FormData, key: string) => (text(fd, key).trim() ? int(fd, key) : null);
const refresh = () => { revalidatePath("/desk/vehicle"); revalidatePath("/desk/driver"); revalidatePath("/desk/today"); revalidatePath("/desk/tasks"); revalidatePath("/desk/insurance"); };

export async function saveVehicleAction(vehicleId: string | null, _: VehicleActionState, fd: FormData): Promise<VehicleActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await saveVehicle(session.user.id, vehicleId, {
      nickname: text(fd, "nickname"), year: int(fd, "year"), make: text(fd, "make"), model: text(fd, "model"), vin: text(fd, "vin"), plate: text(fd, "plate"),
      gvwrLbs: int(fd, "gvwr"), registrationMonth: optInt(fd, "registrationMonth"), odometerAtPurchase: int(fd, "odometerAtPurchase") || 0,
      maintenanceEveryMiles: optInt(fd, "maintenanceEveryMiles"), maintenanceEveryMonths: optInt(fd, "maintenanceEveryMonths"),
      lastMaintenanceOnKey: text(fd, "lastMaintenanceOn") || undefined, lastMaintenanceMiles: optInt(fd, "lastMaintenanceMiles"),
      medicalCardExpiresOnKey: text(fd, "medicalCardExpiresOn") || undefined, notes: text(fd, "notes"), insurancePolicyId: text(fd, "insurancePolicyId") || null,
    });
    refresh();
    return { status: "success", message: vehicleId ? "Saved." : "Vehicle added." };
  } catch (error) { return fail(error); }
}

export async function archiveVehicleAction(vehicleId: string, archive: boolean): Promise<void> {
  const session = await requireRole("OWNER", "ADMIN");
  await archiveVehicle(session.user.id, vehicleId, archive);
  refresh();
}

export async function manualTripAction(_: VehicleActionState, fd: FormData): Promise<VehicleActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await addManualTrip(session.user.id, { vehicleId: text(fd, "vehicleId"), dateKey: text(fd, "date"), startOdometer: int(fd, "start"), endOdometer: int(fd, "end"), purpose: text(fd, "purpose"), notes: text(fd, "notes") });
    refresh();
    return { status: "success", message: "Trip added." };
  } catch (error) { return fail(error); }
}

export async function maintenanceAction(vehicleId: string, _: VehicleActionState, fd: FormData): Promise<VehicleActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try { await recordMaintenance(session.user.id, vehicleId, text(fd, "date"), int(fd, "miles")); refresh(); return { status: "success", message: "Recorded." }; } catch (error) { return fail(error); }
}

export async function settingsAction(_: VehicleActionState, fd: FormData): Promise<VehicleActionState> {
  const session = await requireRole("OWNER");
  try {
    await saveVehicleSettings(session.user.id, { mileageMethod: text(fd, "method") as "STANDARD_RATE" | "ACTUAL_COSTS", medicalCardRequired: fd.get("medicalCard") === "on" });
    refresh();
    return { status: "success", message: "Saved." };
  } catch (error) { return fail(error); }
}

/** Driver view: any signed-in team member can log the day's odometer readings. */
export async function startDayAction(vehicleId: string, _: VehicleActionState, fd: FormData): Promise<VehicleActionState> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  try { await startRouteDay(session.user.id, vehicleId, int(fd, "odometer")); refresh(); return { status: "success", message: "Day started. Enter the ending reading when you finish." }; } catch (error) { return fail(error); }
}

export async function finishDayAction(tripId: string, _: VehicleActionState, fd: FormData): Promise<VehicleActionState> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  try { const miles = await finishRouteDay(session.user.id, tripId, int(fd, "odometer")); refresh(); return { status: "success", message: `Recorded ${miles.toLocaleString("en-US")} miles for today.` }; } catch (error) { return fail(error); }
}
