// OPS-3: the delivery vehicle, its mileage log and the owner's mileage settings. Every write checks the
// acting team member inside the transaction and locks the row it changes. Nothing here contacts anyone or moves money.
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey, businessDayBounds } from "@/lib/business-date";
import { checkVehicleInput, purposeFromJobTypes, tripMiles, type VehicleInput } from "./rules";

export class VehicleError extends Error {}
const t = (v: string | undefined, max: number) => (v ?? "").trim().slice(0, max);

export async function saveVehicle(actorUserId: string, vehicleId: string | null, input: VehicleInput): Promise<string> {
  const problem = checkVehicleInput(input, Number(businessDateKey(new Date()).slice(0, 4)));
  if (problem) throw new VehicleError(problem);
  const lastMaintenanceOn = input.lastMaintenanceOnKey ? businessDateFromKey(input.lastMaintenanceOnKey) : null;
  const medicalCardExpiresOn = input.medicalCardExpiresOnKey ? businessDateFromKey(input.medicalCardExpiresOnKey) : null;
  if (input.lastMaintenanceOnKey && !lastMaintenanceOn) throw new VehicleError("Pick a real date for the last service.");
  if (input.medicalCardExpiresOnKey && !medicalCardExpiresOn) throw new VehicleError("Pick a real date for the medical card.");
  const data = {
    nickname: t(input.nickname, 60), year: input.year, make: t(input.make, 60), model: t(input.model, 60), vin: t(input.vin, 17).toUpperCase() || null,
    plate: t(input.plate, 12).toUpperCase() || null, gvwrLbs: input.gvwrLbs, registrationMonth: input.registrationMonth ?? null,
    odometerAtPurchase: input.odometerAtPurchase, maintenanceEveryMiles: input.maintenanceEveryMiles || null, maintenanceEveryMonths: input.maintenanceEveryMonths || null,
    lastMaintenanceOn, lastMaintenanceMiles: input.lastMaintenanceMiles ?? null, medicalCardExpiresOn, notes: t(input.notes, 400) || null,
    insurancePolicyId: input.insurancePolicyId || null,
  };
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    if (data.insurancePolicyId) {
      // Lock the policy first (the order the insurance screen uses). A NEW link must be a live policy; keeping the link
      // a vehicle already has is always allowed, so saving an unrelated change never fails or drops it.
      await tx.$queryRaw`SELECT "id" FROM "OwnerInsurancePolicy" WHERE "id" = ${data.insurancePolicyId} FOR UPDATE`;
      const current = vehicleId ? await tx.fleetVehicle.findUnique({ where: { id: vehicleId }, select: { insurancePolicyId: true } }) : null;
      const policy = await tx.ownerInsurancePolicy.findUnique({ where: { id: data.insurancePolicyId }, select: { archivedAt: true } });
      if (!policy || (policy.archivedAt && current?.insurancePolicyId !== data.insurancePolicyId)) throw new VehicleError("Pick an insurance policy that is still on your list.");
    }
    if (vehicleId) {
      await tx.$queryRaw`SELECT "id" FROM "FleetVehicle" WHERE "id" = ${vehicleId} FOR UPDATE`;
      if (!(await tx.fleetVehicle.findUnique({ where: { id: vehicleId }, select: { id: true } }))) throw new VehicleError("Couldn't find that vehicle.");
      await tx.fleetVehicle.update({ where: { id: vehicleId }, data });
      await tx.auditLog.create({ data: { userId: actorUserId, action: "vehicle.updated", entityType: "FleetVehicle", entityId: vehicleId, newValue: { gvwrLbs: data.gvwrLbs, insurancePolicyId: data.insurancePolicyId } } });
      return vehicleId;
    }
    const made = await tx.fleetVehicle.create({ data: { ...data, createdByUserId: actorUserId } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "vehicle.added", entityType: "FleetVehicle", entityId: made.id, newValue: { gvwrLbs: data.gvwrLbs } } });
    return made.id;
  });
}

export async function archiveVehicle(actorUserId: string, vehicleId: string, archive: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "FleetVehicle" WHERE "id" = ${vehicleId} FOR UPDATE`;
    if (!(await tx.fleetVehicle.findUnique({ where: { id: vehicleId }, select: { id: true } }))) throw new VehicleError("Couldn't find that vehicle.");
    await tx.fleetVehicle.update({ where: { id: vehicleId }, data: { archivedAt: archive ? new Date() : null } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: archive ? "vehicle.archived" : "vehicle.restored", entityType: "FleetVehicle", entityId: vehicleId } });
  });
}

/** The latest odometer reading known for the vehicle. */
export async function latestOdometer(db: Pick<typeof prisma, "mileageTrip" | "fleetVehicle">, vehicleId: string): Promise<number> {
  const vehicle = await db.fleetVehicle.findUniqueOrThrow({ where: { id: vehicleId }, select: { odometerAtPurchase: true, lastMaintenanceMiles: true } });
  const [end, start] = await Promise.all([
    db.mileageTrip.aggregate({ where: { vehicleId }, _max: { endOdometer: true } }),
    db.mileageTrip.aggregate({ where: { vehicleId }, _max: { startOdometer: true } }),
  ]);
  return Math.max(vehicle.odometerAtPurchase, vehicle.lastMaintenanceMiles ?? 0, end._max.endOdometer ?? 0, start._max.startOdometer ?? 0);
}

/** The driver starts the day: records the starting odometer. One route trip per vehicle per day. */
export async function startRouteDay(actorUserId: string, vehicleId: string, startOdometer: number, now = new Date()): Promise<string> {
  if (!Number.isInteger(startOdometer) || startOdometer < 0 || startOdometer > 2_000_000) throw new VehicleError("Enter the odometer reading as a whole number.");
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN", "STAFF"]);
    await tx.$queryRaw`SELECT "id" FROM "FleetVehicle" WHERE "id" = ${vehicleId} FOR UPDATE`;
    const vehicle = await tx.fleetVehicle.findUnique({ where: { id: vehicleId }, select: { archivedAt: true } });
    if (!vehicle || vehicle.archivedAt) throw new VehicleError("Couldn't find that vehicle.");
    const tripDate = businessDayBounds(now).start;
    const existing = await tx.mileageTrip.findFirst({ where: { vehicleId, tripDate, source: "ROUTE" }, select: { id: true } });
    if (existing) throw new VehicleError("Today's trip was already started for this vehicle.");
    const unfinished = await tx.mileageTrip.findFirst({ where: { vehicleId, source: "ROUTE", endOdometer: null }, orderBy: { tripDate: "desc" }, select: { tripDate: true } });
    if (unfinished) throw new VehicleError(`The trip from ${businessDateKey(unfinished.tripDate)} was never finished. Enter its ending reading first.`);
    const known = await latestOdometer(tx, vehicleId);
    if (startOdometer < known) throw new VehicleError(`That's lower than the last reading we have (${known.toLocaleString("en-US")}). Check the number.`);
    const jobs = await tx.job.findMany({ where: { scheduledAt: { gte: tripDate, lt: businessDayBounds(now).end }, status: { not: "CANCELLED" }, customerPickupHandoff: false }, select: { type: true } });
    const trip = await tx.mileageTrip.create({
      data: { vehicleId, tripDate, startOdometer, purpose: purposeFromJobTypes(jobs.map((j) => j.type)), source: "ROUTE", stops: jobs.length, createdByUserId: actorUserId },
    });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "vehicle.trip_started", entityType: "MileageTrip", entityId: trip.id, newValue: { startOdometer } } });
    return trip.id;
  });
}

/** The driver finishes the day: records the ending odometer and works out the miles. */
export async function finishRouteDay(actorUserId: string, tripId: string, endOdometer: number): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN", "STAFF"]);
    await tx.$queryRaw`SELECT "id" FROM "MileageTrip" WHERE "id" = ${tripId} FOR UPDATE`;
    const trip = await tx.mileageTrip.findUnique({ where: { id: tripId } });
    if (!trip) throw new VehicleError("Couldn't find that trip.");
    if (trip.endOdometer != null) throw new VehicleError("That trip was already finished.");
    let miles: number;
    try { miles = tripMiles(trip.startOdometer, endOdometer); } catch (error) { throw new VehicleError(error instanceof Error ? error.message : "Check the readings."); }
    await tx.mileageTrip.update({ where: { id: tripId }, data: { endOdometer, miles } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "vehicle.trip_finished", entityType: "MileageTrip", entityId: tripId, newValue: { miles } } });
    return miles;
  });
}

/** A trip that isn't a route day (a supply run, say). */
export async function addManualTrip(actorUserId: string, input: { vehicleId: string; dateKey: string; startOdometer: number; endOdometer: number; purpose: string; notes?: string }): Promise<void> {
  const date = businessDateFromKey(input.dateKey);
  if (!date) throw new VehicleError("Pick the date of the trip.");
  if (input.dateKey > businessDateKey(new Date())) throw new VehicleError("The trip can't be in the future.");
  const purpose = t(input.purpose, 120);
  if (!purpose) throw new VehicleError("Say what the trip was for (for example, buying parts).");
  let miles: number;
  try { miles = tripMiles(input.startOdometer, input.endOdometer); } catch (error) { throw new VehicleError(error instanceof Error ? error.message : "Check the readings."); }
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "FleetVehicle" WHERE "id" = ${input.vehicleId} FOR UPDATE`;
    if (!(await tx.fleetVehicle.findUnique({ where: { id: input.vehicleId }, select: { id: true } }))) throw new VehicleError("Couldn't find that vehicle.");
    // The odometer can only be counted once: a new trip may not share any miles with a trip already on file.
    const overlapping = await tx.mileageTrip.findFirst({
      where: {
        vehicleId: input.vehicleId,
        OR: [
          { endOdometer: { not: null }, startOdometer: { lt: input.endOdometer }, AND: [{ endOdometer: { gt: input.startOdometer } }] },
          { endOdometer: null, startOdometer: { gte: input.startOdometer, lt: input.endOdometer } },
        ],
      },
      select: { startOdometer: true, endOdometer: true },
    });
    if (overlapping) throw new VehicleError(`Those miles overlap a trip already recorded (${overlapping.startOdometer.toLocaleString("en-US")}${overlapping.endOdometer != null ? `–${overlapping.endOdometer.toLocaleString("en-US")}` : ", not finished"}). Check the readings so no mile is counted twice.`);
    const trip = await tx.mileageTrip.create({
      data: { vehicleId: input.vehicleId, tripDate: date, startOdometer: input.startOdometer, endOdometer: input.endOdometer, miles, purpose, source: "MANUAL", notes: t(input.notes, 300) || null, createdByUserId: actorUserId },
    });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "vehicle.trip_added", entityType: "MileageTrip", entityId: trip.id, newValue: { miles, purpose } } });
  });
}

export async function recordMaintenance(actorUserId: string, vehicleId: string, dateKey: string, miles: number): Promise<void> {
  const date = businessDateFromKey(dateKey);
  if (!date) throw new VehicleError("Pick the date of the service.");
  if (!Number.isInteger(miles) || miles < 0 || miles > 2_000_000) throw new VehicleError("Enter the odometer reading at the service.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "FleetVehicle" WHERE "id" = ${vehicleId} FOR UPDATE`;
    if (!(await tx.fleetVehicle.findUnique({ where: { id: vehicleId }, select: { id: true } }))) throw new VehicleError("Couldn't find that vehicle.");
    await tx.fleetVehicle.update({ where: { id: vehicleId }, data: { lastMaintenanceOn: date, lastMaintenanceMiles: miles } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "vehicle.maintenance_recorded", entityType: "FleetVehicle", entityId: vehicleId, newValue: { dateKey, miles } } });
  });
}

/** Owner settings: how vehicle costs are claimed, and whether the medical card is asked for. */
export async function saveVehicleSettings(actorUserId: string, input: { mileageMethod: "STANDARD_RATE" | "ACTUAL_COSTS"; medicalCardRequired: boolean }): Promise<void> {
  if (input.mileageMethod !== "STANDARD_RATE" && input.mileageMethod !== "ACTUAL_COSTS") throw new VehicleError("Choose a method.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const before = await tx.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {}, select: { mileageMethod: true, vehicleMedicalCardRequired: true } });
    await tx.businessSettings.update({ where: { id: "singleton" }, data: { mileageMethod: input.mileageMethod, vehicleMedicalCardRequired: input.medicalCardRequired } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "settings.vehicle", entityType: "BusinessSettings", entityId: "singleton", oldValue: before, newValue: input } });
  });
}
