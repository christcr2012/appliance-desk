// OPS-3: pure rules for the delivery vehicle: what its weight means, reminders, trip miles and the mileage deduction.
import { businessDaysBetween } from "@/lib/business-date";

// Legal weight lines. Sources (checked 2026-10-26, secondary summaries - confirm with the state): a commercial driver's
// license is needed from 26,001 lb GVWR (federal, 49 CFR 383); Colorado treats a vehicle as a "commercial motor
// vehicle" for its safety rules from 16,001 lb GVWR (C.R.S. 42-4-235 and CDOT/State Patrol rules).
export const CDL_FROM_LBS = 26_001;
export const COLORADO_COMMERCIAL_FROM_LBS = 16_001;

export type VehicleRules = { level: "NONE" | "COLORADO_COMMERCIAL" | "CDL"; headline: string; points: string[] };

/** What the vehicle's weight means in plain words. `medicalCardRequired` is the owner's starting-value setting. */
export function vehicleRulesFor(gvwrLbs: number, medicalCardRequired: boolean): VehicleRules {
  if (gvwrLbs >= CDL_FROM_LBS) {
    return {
      level: "CDL", headline: "A commercial driver's license (CDL) is needed",
      points: ["Drivers need a CDL, and a federal medical card.", "The vehicle also falls under Colorado's commercial-vehicle rules, including a USDOT number.", "Ask your insurance agent about commercial coverage before you drive it."],
    };
  }
  if (gvwrLbs >= COLORADO_COMMERCIAL_FROM_LBS) {
    return {
      level: "COLORADO_COMMERCIAL", headline: "No CDL, but Colorado's commercial-vehicle rules apply",
      points: [
        "A regular driver's license is enough; no CDL.",
        "Colorado commercial-vehicle rules apply: get a USDOT number and keep the vehicle safe and inspected.",
        medicalCardRequired ? "A medical card is asked for from this weight up (starting value — not confirmed; check with the Colorado State Patrol)." : "You chose not to require a medical card for this weight.",
      ],
    };
  }
  return { level: "NONE", headline: "No special license", points: ["A regular driver's license is enough.", "Below 16,001 lb the commercial-vehicle rules don't apply."] };
}

/** Does this vehicle need a medical card date kept? */
export const needsMedicalCard = (gvwrLbs: number, setting: boolean) => gvwrLbs >= COLORADO_COMMERCIAL_FROM_LBS && setting;

export type VehicleInput = {
  nickname: string; year: number; make: string; model: string; vin?: string; plate?: string; gvwrLbs: number;
  registrationMonth?: number | null; odometerAtPurchase: number; maintenanceEveryMiles?: number | null; maintenanceEveryMonths?: number | null;
  lastMaintenanceOnKey?: string; lastMaintenanceMiles?: number | null; medicalCardExpiresOnKey?: string; notes?: string; insurancePolicyId?: string | null;
};

export function checkVehicleInput(input: VehicleInput, thisYear: number): string | null {
  if (!input.nickname.trim()) return "Give the vehicle a short name, like \"White van\".";
  if (!input.make.trim() || !input.model.trim()) return "Enter the make and model.";
  if (!Number.isInteger(input.year) || input.year < 1980 || input.year > thisYear + 1) return "Enter the model year.";
  if (!Number.isInteger(input.gvwrLbs) || input.gvwrLbs < 1000 || input.gvwrLbs > 100_000) return "Enter the vehicle's gross vehicle weight rating (GVWR) in pounds. It's on the sticker inside the driver's door.";
  if (input.vin && !/^[A-HJ-NPR-Z0-9]{11,17}$/i.test(input.vin.trim())) return "A VIN has 17 letters and numbers (no I, O or Q).";
  if (input.registrationMonth != null && (!Number.isInteger(input.registrationMonth) || input.registrationMonth < 1 || input.registrationMonth > 12)) return "Choose the month the registration is due.";
  if (!Number.isInteger(input.odometerAtPurchase) || input.odometerAtPurchase < 0 || input.odometerAtPurchase > 2_000_000) return "Enter the odometer reading when you bought it (0 if new).";
  for (const n of [input.maintenanceEveryMiles, input.maintenanceEveryMonths, input.lastMaintenanceMiles]) {
    if (n != null && (!Number.isInteger(n) || n < 0 || n > 2_000_000)) return "Maintenance numbers must be whole numbers.";
  }
  return null;
}

export function maskVin(vin: string | null | undefined): string {
  const v = (vin ?? "").trim();
  if (!v) return "";
  return v.length <= 4 ? "••••" : `••••${v.slice(-4)}`;
}

export const ROUTE_PURPOSE_FALLBACK = "Business driving";
const PURPOSE_BY_JOB: Record<string, string> = {
  DELIVERY: "Deliveries and pickups", INSTALLATION: "Deliveries and pickups", SWAP: "Deliveries and pickups", REMOVAL: "Deliveries and pickups", MAINTENANCE_VISIT: "Service visits",
};
/** The trip's purpose, filled from the day's visit types. */
export function purposeFromJobTypes(types: string[]): string {
  const labels = [...new Set(types.map((t) => PURPOSE_BY_JOB[t]).filter(Boolean))];
  return labels.length ? labels.join(" and ") : ROUTE_PURPOSE_FALLBACK;
}

export function tripMiles(start: number, end: number): number {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0) throw new Error("Enter whole-number odometer readings.");
  if (end < start) throw new Error("The ending reading can't be lower than the starting reading.");
  if (end - start > 2000) throw new Error("That's over 2,000 miles in one trip. Check the readings.");
  return end - start;
}

/** Standard-rate deduction in whole cents. Rate is in tenths of a cent per mile (725 = 72.5 cents). */
export function mileageDeductionCents(miles: number, rateTenthsOfCent: number): number {
  if (!Number.isInteger(miles) || miles < 0 || !Number.isInteger(rateTenthsOfCent) || rateTenthsOfCent < 0) throw new Error("Invalid mileage figures.");
  return Math.round((miles * rateTenthsOfCent) / 10);
}

export type DueItem = { key: "REGISTRATION" | "MAINTENANCE" | "MEDICAL_CARD"; label: string; overdue: boolean; detail: string };

/** What is due or coming up for a vehicle. `currentMiles` is the latest odometer reading known (null if none). */
export function vehicleDueItems(v: {
  registrationMonth: number | null; maintenanceEveryMiles: number | null; maintenanceEveryMonths: number | null; lastMaintenanceOn: Date | null; lastMaintenanceMiles: number | null;
  medicalCardExpiresOn: Date | null; gvwrLbs: number; odometerAtPurchase: number;
}, currentMiles: number | null, now: Date, medicalCardSetting: boolean, todayMonth: number): DueItem[] {
  const items: DueItem[] = [];
  if (v.registrationMonth != null) {
    const next = (todayMonth % 12) + 1;
    if (v.registrationMonth === todayMonth) items.push({ key: "REGISTRATION", label: "Renew the vehicle registration", overdue: false, detail: "It is due this month." });
    else if (v.registrationMonth === next) items.push({ key: "REGISTRATION", label: "Renew the vehicle registration", overdue: false, detail: "It is due next month." });
  }
  if (v.maintenanceEveryMiles != null && v.maintenanceEveryMiles > 0 && currentMiles != null) {
    const since = currentMiles - (v.lastMaintenanceMiles ?? v.odometerAtPurchase);
    if (since >= v.maintenanceEveryMiles) items.push({ key: "MAINTENANCE", label: "Vehicle maintenance is due", overdue: true, detail: `${since.toLocaleString("en-US")} miles since the last service (you asked to be reminded every ${v.maintenanceEveryMiles.toLocaleString("en-US")}).` });
  }
  if (v.maintenanceEveryMonths != null && v.maintenanceEveryMonths > 0 && v.lastMaintenanceOn) {
    const days = businessDaysBetween(v.lastMaintenanceOn, now);
    if (days >= v.maintenanceEveryMonths * 30) items.push({ key: "MAINTENANCE", label: "Vehicle maintenance is due", overdue: true, detail: `It has been about ${Math.round(days / 30)} months since the last service (you asked to be reminded every ${v.maintenanceEveryMonths}).` });
  }
  if (needsMedicalCard(v.gvwrLbs, medicalCardSetting)) {
    if (!v.medicalCardExpiresOn) items.push({ key: "MEDICAL_CARD", label: "Add the driver's medical card date", overdue: false, detail: "This vehicle's weight asks for a medical card. Enter when it expires." });
    else {
      const left = businessDaysBetween(now, v.medicalCardExpiresOn);
      if (left < 0) items.push({ key: "MEDICAL_CARD", label: "The driver's medical card has expired", overdue: true, detail: `It expired ${-left} day${left === -1 ? "" : "s"} ago.` });
      else if (left <= 60) items.push({ key: "MEDICAL_CARD", label: "The driver's medical card expires soon", overdue: false, detail: `It expires in ${left} day${left === 1 ? "" : "s"}.` });
    }
  }
  return items;
}
