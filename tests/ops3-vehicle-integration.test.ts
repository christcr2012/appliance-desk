import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateKey, businessDayBounds } from "@/lib/business-date";
import { ruleAsOf } from "@/domains/rules/reads";
import { addManualTrip, archiveVehicle, finishRouteDay, latestOdometer, recordMaintenance, saveVehicle, saveVehicleSettings, startRouteDay } from "@/domains/vehicle/actions";
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

  it("never counts the same miles twice, remembers service readings, and keeps an unfinished day on the driver card", async () => {
    await expect(addManualTrip(ownerId, { vehicleId, dateKey: businessDateKey(new Date()), startOdometer: 12_040, endOdometer: 12_060, purpose: "Overlaps the route" })).rejects.toThrow(/overlap/);
    await recordMaintenance(ownerId, vehicleId, businessDateKey(new Date()), 14_000);
    expect(await latestOdometer(prisma, vehicleId)).toBe(14_000);

    const second = await saveVehicle(ownerId, null, { ...van, nickname: `Van2 ${tag}` });
    const yesterday = new Date(businessDayBounds(new Date()).start.getTime() - 12 * 3_600_000);
    const day = businessDayBounds(yesterday).start;
    await prisma.mileageTrip.create({ data: { vehicleId: second, tripDate: day, startOdometer: 12_000, source: "ROUTE", purpose: "Deliveries", createdByUserId: ownerId } });
    const card = (await loadDriverMileage(new Date())).find((v) => v.id === second);
    expect(card?.trip?.endOdometer).toBeNull();
    await expect(startRouteDay(ownerId, second, 12_100)).rejects.toThrow(/never finished/);
    await finishRouteDay(ownerId, card!.trip!.id, 12_080);
    await startRouteDay(ownerId, second, 12_080);
    await prisma.mileageTrip.deleteMany({ where: { vehicleId: second } });
    await prisma.fleetVehicle.deleteMany({ where: { id: second } });
  });

  it("retires a vehicle: it drops off the driver view", async () => {
    await archiveVehicle(ownerId, vehicleId, true);
    expect((await loadDriverMileage(new Date())).some((v) => v.id === vehicleId)).toBe(false);
    await expect(startRouteDay(ownerId, vehicleId, 99_999)).rejects.toThrow(/find/);
    await archiveVehicle(ownerId, vehicleId, false);
  });
  it("links the vehicle to an insurance policy: live policies only, shown on the overview, cleared if the policy goes", async () => {
    const policyIds: string[] = [];
    try {
      const mk = (n: string, expires: Date, archived = false) => prisma.ownerInsurancePolicy.create({
        data: { kind: "COMMERCIAL_AUTO", insurer: `Auto Mutual ${n}`, policyNumber: `V-${tag}-${n}`, expiresOn: expires, archivedAt: archived ? new Date() : null, createdByUserId: ownerId },
      });
      const live = await mk("live", new Date(Date.now() + 200 * 86_400_000));
      const old = await mk("old", new Date(Date.now() - 3 * 86_400_000));
      const gone = await mk("gone", new Date(Date.now() + 200 * 86_400_000), true);
      policyIds.push(live.id, old.id, gone.id);
      const input = { ...van, nickname: `Linked ${tag}`, insurancePolicyId: live.id };
      await expect(saveVehicle(staffId, null, input)).rejects.toThrow();
      await expect(saveVehicle(ownerId, null, { ...input, insurancePolicyId: gone.id })).rejects.toThrow(/still on your list/);
      await expect(saveVehicle(ownerId, null, { ...input, insurancePolicyId: "missing" })).rejects.toThrow(/still on your list/);
      const id = await saveVehicle(ownerId, null, input);
      let overview = await loadVehicleOverview(new Date());
      let row = overview.vehicles.find((v) => v.id === id)!;
      expect(row.insurancePolicy?.insurer).toBe("Auto Mutual live");
      expect(overview.policies.map((p) => p.id)).toContain(live.id);
      expect(overview.policies.map((p) => p.id)).not.toContain(gone.id);
      // Switch to a policy that has already ended: it is allowed (still on the list) and the page can say so.
      await saveVehicle(ownerId, id, { ...input, insurancePolicyId: old.id });
      overview = await loadVehicleOverview(new Date());
      row = overview.vehicles.find((v) => v.id === id)!;
      expect(row.insurancePolicy!.expiresOn.getTime()).toBeLessThan(Date.now());
      // Unlinking works, and deleting a linked policy clears the link instead of failing.
      await saveVehicle(ownerId, id, { ...input, insurancePolicyId: live.id });
      await prisma.ownerInsurancePolicy.delete({ where: { id: live.id } });
      expect((await prisma.fleetVehicle.findUniqueOrThrow({ where: { id } })).insurancePolicyId).toBeNull();
      await saveVehicle(ownerId, id, { ...input, insurancePolicyId: null });
      await archiveVehicle(ownerId, id, true);
      await prisma.mileageTrip.deleteMany({ where: { vehicleId: id } });
      await prisma.auditLog.deleteMany({ where: { entityId: id } });
      await prisma.fleetVehicle.delete({ where: { id } });
    } finally {
      await prisma.ownerInsurancePolicy.deleteMany({ where: { id: { in: policyIds } } });
    }
  });
});
