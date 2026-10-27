import { prisma } from "@/lib/prisma";
import { businessDateKey, businessDayBounds } from "@/lib/business-date";
import { ruleAsOf } from "@/domains/rules/reads";
import { mileageDeductionCents, vehicleDueItems, vehicleRulesFor } from "./rules";
import { latestOdometer } from "./actions";

async function rateForYear(year: number): Promise<number | null> {
  try { return (await ruleAsOf<number>("us.mileage_rate", new Date(`${year}-12-31T12:00:00Z`))).value; } catch { return null; }
}

export async function loadVehicleOverview(now: Date) {
  const [settings, vehicles] = await Promise.all([
    prisma.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {}, select: { mileageMethod: true, vehicleMedicalCardRequired: true } }),
    prisma.fleetVehicle.findMany({ orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }], take: 20 }),
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
  const years = [];
  for (const [year, miles] of [...byYear.entries()].sort((a, b) => b[0] - a[0])) {
    const rate = await rateForYear(year);
    years.push({ year, miles, rateTenths: rate, deductionCents: rate != null ? mileageDeductionCents(miles, rate) : null });
  }
  return { settings, vehicles: out, trips, years };
}

/** For the driver view: the vehicle(s) that can be driven today and whether today's trip is started or finished. */
export async function loadDriverMileage(now: Date) {
  const today = businessDayBounds(now).start;
  const vehicles = await prisma.fleetVehicle.findMany({ where: { archivedAt: null }, orderBy: { createdAt: "asc" }, take: 5, select: { id: true, nickname: true } });
  const result = [];
  for (const v of vehicles) {
    const trip = await prisma.mileageTrip.findFirst({ where: { vehicleId: v.id, tripDate: today, source: "ROUTE" }, select: { id: true, startOdometer: true, endOdometer: true, miles: true } });
    result.push({ ...v, lastOdometer: await latestOdometer(prisma, v.id), trip });
  }
  return result;
}
