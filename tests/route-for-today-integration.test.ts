import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { businessDayBounds } from "@/lib/business-date";
import { getRouteForToday } from "@/domains/jobs/route";

// Disposable CI Postgres only (same gate as the other integration tests).
const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const enabled =
  process.env.CI === "true" &&
  url !== null &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("route for today person filter (AR-5 section 5)", () => {
  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const jobIds: string[] = [];
  let ownerId = "";
  let staffAId = "";
  let staffBId = "";
  let customerId = "";
  let ownJobId = "";
  let otherJobId = "";
  let ownerJobId = "";
  let unassignedAId = "";
  let unassignedBId = "";
  let originalSetting = true;
  let settingsRowExisted = false;

  const { start } = businessDayBounds();
  const at = (hours: number) => new Date(start.getTime() + hours * 3_600_000);

  async function setUnassignedAllowed(value: boolean) {
    await prisma.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", staffMayWorkUnassignedJobs: value },
      update: { staffMayWorkUnassignedJobs: value },
    });
  }

  beforeAll(async () => {
    const existing = await prisma.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { staffMayWorkUnassignedJobs: true },
    });
    settingsRowExisted = existing !== null;
    originalSetting = existing?.staffMayWorkUnassignedJobs ?? true;

    const owner = await prisma.user.create({
      data: { email: `ar5r-owner-${tag}@example.test`, name: `AR5R Owner ${tag}`, role: "OWNER" },
    });
    const staffA = await prisma.user.create({
      data: { email: `ar5r-staffa-${tag}@example.test`, name: `AR5R Staff A ${tag}`, role: "STAFF" },
    });
    const staffB = await prisma.user.create({
      data: { email: `ar5r-staffb-${tag}@example.test`, name: `AR5R Staff B ${tag}`, role: "STAFF" },
    });
    ownerId = owner.id;
    staffAId = staffA.id;
    staffBId = staffB.id;
    userIds.push(owner.id, staffA.id, staffB.id);

    const customerUser = await prisma.user.create({
      data: { email: `ar5r-customer-${tag}@example.test`, name: `AR5R Customer ${tag}`, role: "CUSTOMER" },
    });
    userIds.push(customerUser.id);
    const customer = await prisma.customer.create({
      data: { userId: customerUser.id, phone: "9705550188", referralCode: `R${tag}` },
    });
    customerId = customer.id;
    const address = await prisma.serviceAddress.create({
      data: {
        customerId: customer.id,
        line1: "1200 Route Way",
        city: "Greeley",
        state: "CO",
        zip: "80631",
        unitLabel: "Unit 4",
        accessNotes: "Gate code 4321",
      },
    });

    async function makeJob(data: Record<string, unknown>) {
      const job = await prisma.job.create({
        data: {
          type: "DELIVERY",
          status: "SCHEDULED",
          customerId: customer.id,
          serviceAddressId: address.id,
          ...data,
        },
      });
      jobIds.push(job.id);
      return job.id;
    }

    ownJobId = await makeJob({ assignedToUserId: staffAId, scheduledAt: at(1) });
    otherJobId = await makeJob({ assignedToUserId: staffBId, scheduledAt: at(2) });
    unassignedAId = await makeJob({ assignedToUserId: null, scheduledAt: at(3) });
    unassignedBId = await makeJob({ assignedToUserId: null, scheduledAt: at(3) });
    ownerJobId = await makeJob({ assignedToUserId: ownerId, scheduledAt: at(4) });
    await makeJob({ assignedToUserId: staffAId, scheduledAt: null });
    await makeJob({ assignedToUserId: staffAId, scheduledAt: at(5), customerPickupHandoff: true });
    await makeJob({ assignedToUserId: staffAId, scheduledAt: at(6), status: "COMPLETED" });
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.serviceAddress.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (settingsRowExisted) {
      await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: { staffMayWorkUnassignedJobs: originalSetting },
      });
    } else {
      await prisma.businessSettings.deleteMany({ where: { id: "singleton" } });
    }
  });

  const ids = (stops: { id: string }[]) => stops.map((s) => s.id);

  it("staff see their own visits plus unassigned ones while the setting allows", async () => {
    await setUnassignedAllowed(true);
    const stops = await getRouteForToday({ actor: { userId: staffAId, role: "STAFF" } });
    expect(ids(stops)).toContain(ownJobId);
    expect(ids(stops)).toContain(unassignedAId);
    expect(ids(stops)).toContain(unassignedBId);
    expect(ids(stops)).not.toContain(otherJobId);
    expect(ids(stops)).not.toContain(ownerJobId);
    // Same-time unassigned stops order by id (route order is stable).
    const pair = stops.filter((s) => s.id === unassignedAId || s.id === unassignedBId);
    expect(ids(pair)).toEqual([...ids(pair)].sort());
  });

  it("staff lose the unassigned visits when the setting is off", async () => {
    await setUnassignedAllowed(false);
    const stops = await getRouteForToday({ actor: { userId: staffAId, role: "STAFF" } });
    expect(ids(stops)).toEqual([ownJobId]);
  });

  it("a staff actor asking for everyone still gets only the staff view", async () => {
    await setUnassignedAllowed(true);
    const stops = await getRouteForToday({ actor: { userId: staffAId, role: "STAFF" }, who: "everyone" });
    expect(ids(stops)).not.toContain(otherJobId);
    expect(ids(stops)).not.toContain(ownerJobId);
  });

  it("owner defaults to mine (own + unassigned, no setting check) and can switch to everyone", async () => {
    await setUnassignedAllowed(false);
    const mine = await getRouteForToday({ actor: { userId: ownerId, role: "OWNER" } });
    expect(ids(mine)).toContain(ownerJobId);
    expect(ids(mine)).toContain(unassignedAId);
    expect(ids(mine)).not.toContain(ownJobId);

    const everyone = await getRouteForToday({ actor: { userId: ownerId, role: "OWNER" }, who: "everyone" });
    expect(ids(everyone)).toEqual(expect.arrayContaining([ownJobId, otherJobId, ownerJobId, unassignedAId, unassignedBId]));
  });

  it("unit label and access notes ride along only where the privacy read allows them", async () => {
    await setUnassignedAllowed(true);
    const stops = await getRouteForToday({ actor: { userId: staffAId, role: "STAFF" } });
    const own = stops.find((s) => s.id === ownJobId);
    expect(own?.unitLabel).toBe("Unit 4");
    expect(own?.accessNotes).toBe("Gate code 4321");
    const unassigned = stops.find((s) => s.id === unassignedAId);
    expect(unassigned?.unitLabel).toBeNull();
    expect(unassigned?.accessNotes).toBeNull();
  });

  it("refuses a non-team actor", async () => {
    await expect(
      getRouteForToday({ actor: { userId: staffAId, role: "CUSTOMER" } }),
    ).rejects.toThrow("Only the team can see a route.");
  });
});
