// OPS-3: a year's business miles and what the standard mileage rate makes of them. Read-only; used by the vehicle page
// and by the Schedule C packet (CMP-2, line 9). The rate comes from the dated rule book (us.mileage_rate).
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { ruleAsOf } from "@/domains/rules/reads";
import { mileageDeductionCents } from "./rules";

export type VehicleYearFigures = { year: number; miles: number; rateTenths: number | null; standardCents: number | null };

export async function vehicleYearFigures(year: number): Promise<VehicleYearFigures> {
  const start = businessDateFromKey(`${year}-01-01`);
  const end = businessDateFromKey(`${year + 1}-01-01`);
  if (!start || !end) throw new Error("That tax year could not be read.");
  const sum = await prisma.mileageTrip.aggregate({ where: { tripDate: { gte: start, lt: end }, miles: { not: null } }, _sum: { miles: true } });
  const miles = sum._sum.miles ?? 0;
  let rateTenths: number | null = null;
  try { rateTenths = (await ruleAsOf<number>("us.mileage_rate", new Date(`${year}-12-31T12:00:00Z`))).value; } catch { rateTenths = null; }
  return { year, miles, rateTenths, standardCents: rateTenths == null ? null : mileageDeductionCents(miles, rateTenths) };
}
