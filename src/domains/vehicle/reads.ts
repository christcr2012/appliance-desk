import { prisma } from "@/lib/prisma";
import { businessDateKey, businessDayBounds } from "@/lib/business-date";
import { ruleAsOf } from "@/domains/rules/reads";
import { mileageDeductionCents, vehicleDueItems, vehicleRulesFor } from "./rules";
import { latestOdometer } from "./actions";
import { computeScheduleCYear } from "@/domains/compliance/schedule-c";

async function rateForYear(year: number): Promise<number | null> {
  try { return (await ruleAsOf<number>("us.mileage_rate", new Date(`${year}-12-31T12:00:00Z`))).value; } catch { return null; }
}

export async function loadVehicleOverview(now: Date) {
  const [settings, vehicles, policies] = await Promise.all([
    prisma.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {}, select: { mileageMethod: true, vehicleMedicalCardRequired: true } }),
    prisma.fleetVehicle.findMany({ orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }], take: 20, include: { insurancePolicy: { select: { id: true, insurer: true, policyNumber: true, effectiveOn: true, expiresOn: true, archivedAt: true } } } }),
    prisma.ownerInsurancePolicy.findMany({ where: { archivedAt: null }, orderBy: [{ expiresOn: "desc" }], take: 50, select: { id: true, kind: true, insurer: true, policyNumber: true, expiresOn: true } }),
  ]);
  const todayMonth = Number(businessDateKey(now).slice(5, 7));
  const today = businessDayBounds(now).start;
  const out = [];
  for (const v of vehicles) {
    const odometer = await latestOdometer(prisma, v.id);
    out.push({
      ...v, odometer, rules: vehicleRulesFor(v.gvwrLbs, settings.vehicleMedicalCardRequired),
      due: v.archivedAt ? [] : vehicleDueItems(v, odometer, now, settings.vehicleMedicalCardRequired, todayMonth),
      todayTrip: await prisma.mileageTrip.findFirst({ where: { vehicleId: v.id, tripDate: today, source: "ROUTE" } }),
    });
  }
  const trips = await prisma.mileageTrip.findMany({ orderBy: [{ tripDate: "desc" }, { createdAt: "desc" }], take: 40, include: { vehicle: { select: { nickname: true } } } });
  const finished = await prisma.mileageTrip.findMany({ where: { miles: { not: null } }, select: { tripDate: true, miles: true }, take: 20000 });
  const byYear = new Map<number, number>();
  for (const trip of finished) {
    const year = Number(businessDateKey(trip.tripDate).slice(0, 4));
    byYear.set(year, (byYear.get(year) ?? 0) + (trip.miles ?? 0));
  }
  // The current year always shows, so the comparison with the books is visible before the first trip is logged.
  const thisYear = Number(businessDateKey(now).slice(0, 4));
  if (!byYear.has(thisYear)) byYear.set(thisYear, 0);
  const years = [];
  for (const [year, miles] of [...byYear.entries()].sort((a, b) => b[0] - a[0]).slice(0, 6)) {
    const rate = await rateForYear(year);
    // What the books posted for vehicle costs (fuel, repairs, insurance), for the side-by-side comparison. Null if unreadable.
    let actualCents: number | null = null;
    try { actualCents = (await computeScheduleCYear(year)).vehicle.actualCents; } catch { actualCents = null; }
    years.push({ year, miles, rateTenths: rate, deductionCents: rate != null ? mileageDeductionCents(miles, rate) : null, actualCents });
  }
  return { settings, vehicles: out, trips, years, policies };
}

/** For the driver view: the vehicle(s) that can be driven today and whether today's trip is started or finished. */
export async function loadDriverMileage(now: Date) {
  const today = businessDayBounds(now).start;
  const vehicles = await prisma.fleetVehicle.findMany({ where: { archivedAt: null }, orderBy: { createdAt: "asc" }, take: 5, select: { id: true, nickname: true } });
  const result = [];
  for (const v of vehicles) {
    // A day that was never finished stays on the card until it is, even after midnight, so it can be closed out.
    const select = { id: true, startOdometer: true, endOdometer: true, miles: true, tripDate: true } as const;
    const open = await prisma.mileageTrip.findFirst({ where: { vehicleId: v.id, source: "ROUTE", endOdometer: null }, orderBy: { tripDate: "desc" }, select });
    const trip = open ?? await prisma.mileageTrip.findFirst({ where: { vehicleId: v.id, tripDate: today, source: "ROUTE" }, select });
    result.push({ ...v, lastOdometer: await latestOdometer(prisma, v.id), trip });
  }
  return result;
}

/**
 * The driver's route progress for today: how many stops there are and how many are finished. The route list itself only
 * shows unfinished stops, so this counts separately. Cancelled visits are not stops; customer pick-up hand-overs at our
 * place are never on the route. Counts only, no customer data.
 */
export async function loadDriverStopCounts(now: Date): Promise<{ total: number; finished: number }> {
  const { start, end } = businessDayBounds(now);
  const base = { scheduledAt: { gte: start, lt: end }, customerPickupHandoff: false };
  const [active, finished] = await Promise.all([
    prisma.job.count({ where: { ...base, status: { in: ["SCHEDULED", "IN_PROGRESS"] } } }),
    prisma.job.count({ where: { ...base, status: "COMPLETED" } }),
  ]);
  return { total: active + finished, finished };
}
