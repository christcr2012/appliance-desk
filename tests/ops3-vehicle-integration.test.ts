import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateKey, businessDayBounds } from "@/lib/business-date";
import { ruleAsOf } from "@/domains/rules/reads";
import { addManualTrip, archiveVehicle, finishRouteDay, recordMaintenance, saveVehicle, saveVehicleSettings, startRouteDay } from "@/domains/vehicle/actions";
import { loadDriverMileage, loadVehicleOverview } from "@/domains/vehicle/reads";
import { listVehicleAttention } from "@/domains/exceptions/vehicle-attention";

// OPS-3 on real Postgres.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("vehicle and mileage (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 8);
  const staffId = `ops3-staff-${tag}`;
  const customerUser = `ops3-cust-${tag}`;
  let ownerId = "";
  let customerId = "";
  let addressId = "";
  let vehicleId = "";
  const jobs: string[] = [];
  let settingsBefore: { mileageMethod: "STANDARD_RATE" | "ACTUAL_COSTS"; vehicleMedicalCardRequired: boolean } | null = null;

  const van = { nickname: `Van ${tag}`, year: 2021, make: "Ford", model: "Transit", gvwrLbs: 9500, odometerAtPurchase: 12_000, registrationMonth: null };

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.user.create({ data: { id: staffId, email: `${staffId}@example.test`, role: "STAFF", emailVerified: true } });
    await prisma.user.create({ data: { id: customerUser, email: `${customerUser}@example.test`, role: "CUSTOMER", emailVerified: true, name: "Ops3 Customer" } });
    customerId = (await prisma.customer.create({ data: { userId: customerUser, referralCode: `O3${tag}` } })).id;
    addressId = (await prisma.serviceAddress.create({ data: { customerId, line1: "1 Test St", city: "Greeley", zip: "80631" } })).id;
    settingsBefore = await prisma.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {}, select: { mileageMethod: true, vehicleMedicalCardRequired: true } });
  });

  afterAll(async () => {
    await prisma.mileageTrip.deleteMany({ where: { vehicleId } });
    await prisma.fleetVehicle.deleteMany({ where: { id: vehicleId } });
    await prisma.job.deleteMany({ where: { id: { in: jobs } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: staffId }, { entityId: vehicleId }, { action: "settings.vehicle", userId: ownerId }] } });
    if (settingsBefore) await prisma.businessSettings.update({ where: { id: "singleton" }, data: settingsBefore });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [staffId, customerUser] } } });
  });

  it("seeds the 2026 IRS rate as 72.5 cents a mile", async () => {
    expect((await ruleAsOf<number>("us.mileage_rate", new Date("2026-07-01T12:00:00Z"))).value).toBe(725);
  });

  it("adds a vehicle (weight required) and lets staff do nothing to the profile", async () => {
    await expect(saveVehicle(staffId, null, van)).rejects.toThrow();
    await expect(saveVehicle(ownerId, null, { ...van, gvwrLbs: 0 })).rejects.toThrow(/GVWR/);
    vehicleId = await saveVehicle(ownerId, null, van);
    const o = await loadVehicleOverview(new Date());
    const mine = o.vehicles.find((v) => v.id === vehicleId);
    expect(mine?.rules.level).toBe("NONE");
    expect(mine?.odometer).toBe(12_000);
  });

  it("logs a route day: start, then finish, with the purpose and stops from that day's visits", async () => {
    const now = new Date();
    const noon = new Date(businessDayBounds(now).start.getTime() + 12 * 3_600_000);
    for (const type of ["DELIVERY", "REMOVAL"] as const) {
      jobs.push((await prisma.job.create({ data: { type, status: "SCHEDULED", scheduledAt: noon, customerId, serviceAddressId: addressId } })).id);
    }
    await expect(startRouteDay(staffId, vehicleId, 11_000)).rejects.toThrow(/lower than the last reading/);
    const tripId = await startRouteDay(staffId, vehicleId, 12_050);
    await expect(startRouteDay(staffId, vehicleId, 12_060)).rejects.toThrow(/already started/);
    const started = await prisma.mileageTrip.findUniqueOrThrow({ where: { id: tripId } });
    expect(started.purpose).toBe("Deliveries and pickups");
    expect(started.stops).toBeGreaterThanOrEqual(2);
    expect(started.endOdometer).toBeNull();
    await expect(finishRouteDay(staffId, tripId, 12_000)).rejects.toThrow(/lower/);
    expect(await finishRouteDay(staffId, tripId, 12_087)).toBe(37);
    await expect(finishRouteDay(staffId, tripId, 12_090)).rejects.toThrow(/already finished/);
    const mileage = await loadDriverMileage(now);
    expect(mileage.find((v) => v.id === vehicleId)?.trip?.miles).toBe(37);
    expect(mileage.find((v) => v.id === vehicleId)?.lastOdometer).toBe(12_087);
  });

  it("adds a manual trip (owner only) and totals the year with the rule-book rate", async () => {
    const today = businessDateKey(new Date());
    await expect(addManualTrip(staffId, { vehicleId, dateKey: today, startOdometer: 12_087, endOdometer: 12_100, purpose: "Parts" })).rejects.toThrow();
    await expect(addManualTrip(ownerId, { vehicleId, dateKey: today, startOdometer: 12_100, endOdometer: 12_090, purpose: "Parts" })).rejects.toThrow(/lower/);
    await expect(addManualTrip(ownerId, { vehicleId, dateKey: today, startOdometer: 12_087, endOdometer: 12_100, purpose: " " })).rejects.toThrow(/for/);
    await addManualTrip(ownerId, { vehicleId, dateKey: today, startOdometer: 12_087, endOdometer: 12_100, purpose: "Buying parts" });
    const o = await loadVehicleOverview(new Date());
    const year = o.years.find((y) => y.year === Number(today.slice(0, 4)));
    expect(year?.rateTenths).toBe(725);
    expect(year!.miles).toBeGreaterThanOrEqual(50);
    expect(year!.deductionCents).toBe(Math.round((year!.miles * 725) / 10));
  });

  it("reminds the owner about maintenance and the medical card, and stops when done", async () => {
    await saveVehicle(ownerId, vehicleId, { ...van, maintenanceEveryMiles: 100, lastMaintenanceMiles: 12_000, lastMaintenanceOnKey: businessDateKey(new Date()) });
    let rows = (await listVehicleAttention(new Date())).filter((r) => r.title.includes(van.nickname));
    expect(rows.map((r) => r.title)).toEqual([`Vehicle maintenance is due (${van.nickname})`]);
    await recordMaintenance(ownerId, vehicleId, businessDateKey(new Date()), 12_100);
    rows = (await listVehicleAttention(new Date())).filter((r) => r.title.includes(van.nickname));
    expect(rows).toEqual([]);
    // A heavier vehicle asks for a medical card date; the owner can turn that off.
    await saveVehicle(ownerId, vehicleId, { ...van, gvwrLbs: 20_000 });
    expect((await listVehicleAttention(new Date())).some((r) => r.title.includes(van.nickname) && /medical card/.test(r.title))).toBe(true);
    await expect(saveVehicleSettings(staffId, { mileageMethod: "STANDARD_RATE", medicalCardRequired: false })).rejects.toThrow();
    await saveVehicleSettings(ownerId, { mileageMethod: "STANDARD_RATE", medicalCardRequired: false });
    expect((await listVehicleAttention(new Date())).some((r) => r.title.includes(van.nickname))).toBe(false);
  });

  it("retires a vehicle: it drops off the driver view", async () => {
    await archiveVehicle(ownerId, vehicleId, true);
    expect((await loadDriverMileage(new Date())).some((v) => v.id === vehicleId)).toBe(false);
    await expect(startRouteDay(ownerId, vehicleId, 99_999)).rejects.toThrow(/find/);
    await archiveVehicle(ownerId, vehicleId, false);
  });
});
