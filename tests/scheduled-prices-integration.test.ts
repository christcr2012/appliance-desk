import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import {
  applyDueScheduledPriceChanges, cancelScheduledPriceChange, listScheduledPriceChanges, scheduleAppliancePriceChange,
} from "@/domains/pricing/scheduled";

// Batch O-4 on real Postgres: schedule, one change per day, who may, apply once at the start day, cancel, and the safe
// failure paths. Uses its own appliance types, so it does not touch the shared settings row.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

const dayKey = (offsetDays: number) => businessDateKey(new Date(Date.now() + offsetDays * 86_400_000));
const startOf = (key: string) => businessDateFromKey(key)!;

describe.skipIf(!enabled)("scheduled price changes on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  let ownerId: string;
  const adminId = `sp-admin-${tag}`;
  const staffId = `sp-staff-${tag}`;
  const types: string[] = [];

  const makeType = async (price = 5_000, isActive = true) => {
    const id = `sp-type-${tag}-${types.length}`;
    await prisma.applianceType.create({ data: { id, name: `Test ${tag} ${types.length}`, slug: `test-${tag}-${types.length}`, monthlyPriceCents: price, isActive } });
    types.push(id);
    return id;
  };
  const price = async (id: string) => (await prisma.applianceType.findUniqueOrThrow({ where: { id } })).monthlyPriceCents;

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.user.createMany({ data: [
      { id: adminId, name: "Price Admin", email: `${tag}-admin@example.test`, role: "ADMIN", emailVerified: true },
      { id: staffId, name: "Price Staff", email: `${tag}-staff@example.test`, role: "STAFF", emailVerified: true },
    ] });
  });
  afterAll(async () => {
    await prisma.scheduledPriceChange.deleteMany({ where: { applianceTypeId: { in: types } } });
    await prisma.pricingRule.deleteMany({ where: { applianceTypeId: { in: types } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: types } }, { userId: { in: [adminId, staffId] } }] } });
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: adminId } });
    await prisma.applianceType.deleteMany({ where: { id: { in: types } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, staffId] } } });
  });

  it("saves a waiting change without touching the price, and refuses a second one for the same day", async () => {
    const t = await makeType(5_000);
    const key = dayKey(3);
    const row = await scheduleAppliancePriceChange(adminId, { applianceTypeId: t, newPriceCents: 6_000, effectiveOn: key, note: "fall increase" });
    expect(row.status).toBe("PENDING");
    expect(row.priceAtSchedulingCents).toBe(5_000);
    expect(await price(t)).toBe(5_000);
    await expect(scheduleAppliancePriceChange(ownerId, { applianceTypeId: t, newPriceCents: 6_500, effectiveOn: key }))
      .rejects.toThrow(/already a price change scheduled/);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: t, action: "pricing.schedule" } });
    expect(audit?.userId).toBe(adminId);
    const listed = await listScheduledPriceChanges();
    expect(listed.pending.some((r) => r.id === row.id && r.applianceTypeName.startsWith("Test"))).toBe(true);
  });

  it("refuses staff, a limited admin and a retired appliance type", async () => {
    const t = await makeType(5_000);
    const input = { applianceTypeId: t, newPriceCents: 6_000, effectiveOn: dayKey(4) };
    await expect(scheduleAppliancePriceChange(staffId, input)).rejects.toThrow(/no longer has access/);
    await prisma.staffCapabilityOverride.create({ data: { userId: adminId, capability: "EDIT_SETTINGS", allowed: false, updatedByUserId: ownerId } });
    await expect(scheduleAppliancePriceChange(adminId, input)).rejects.toThrow(/has not given you permission/);
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: adminId } });
    const retired = await makeType(5_000, false);
    await expect(scheduleAppliancePriceChange(adminId, { ...input, applianceTypeId: retired })).rejects.toThrow(/retired/);
    expect(await prisma.scheduledPriceChange.count({ where: { applianceTypeId: { in: [t, retired] } } })).toBe(0);
  });

  it("applies on the start day exactly once, with the normal history and audit rows, and never earlier", async () => {
    const t = await makeType(5_000);
    const key = dayKey(5);
    const row = await scheduleAppliancePriceChange(adminId, { applianceTypeId: t, newPriceCents: 6_000, effectiveOn: key });
    // Other test files share this database and add or remove rental lines while this one runs, so compare line by line:
    // every line that existed before must still have the same price afterwards.
    const rentLinesBefore = await prisma.rentalLine.findMany({ select: { id: true, monthlyPriceCents: true }, take: 5000 });

    // The evening before: nothing happens.
    const before = new Date(startOf(key).getTime() - 60 * 60 * 1000);
    await applyDueScheduledPriceChanges(before);
    expect(await price(t)).toBe(5_000);

    // Early on the start day: applied.
    const onDay = new Date(startOf(key).getTime() + 4 * 60 * 60 * 1000);
    const first = await applyDueScheduledPriceChanges(onDay);
    expect(first.applied).toBeGreaterThanOrEqual(1);
    expect(await price(t)).toBe(6_000);
    const done = await prisma.scheduledPriceChange.findUniqueOrThrow({ where: { id: row.id } });
    expect(done.status).toBe("APPLIED");
    expect(done.priceBeforeApplyCents).toBe(5_000);
    expect(await prisma.pricingRule.count({ where: { applianceTypeId: t, oldValueCents: 5_000, newValueCents: 6_000 } })).toBe(1);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: t, action: "pricing.update" } });
    expect(audit?.userId).toBe(adminId);
    expect(JSON.stringify(audit?.newValue)).toContain(row.id);

    // Run again, even much later: nothing applies twice.
    const again = await applyDueScheduledPriceChanges(new Date(onDay.getTime() + 7 * 86_400_000));
    expect(again.applied).toBe(0);
    expect(await prisma.pricingRule.count({ where: { applianceTypeId: t } })).toBe(1);

    // Signed rentals keep their own price: this job never touches rental lines.
    const rentLinesAfter = new Map((await prisma.rentalLine.findMany({ select: { id: true, monthlyPriceCents: true }, take: 5000 })).map((l) => [l.id, l.monthlyPriceCents]));
    for (const line of rentLinesBefore) {
      if (rentLinesAfter.has(line.id)) expect(rentLinesAfter.get(line.id)).toBe(line.monthlyPriceCents);
    }
  });

  it("when two changes for one appliance are both due, the later start day wins", async () => {
    const t = await makeType(5_000);
    const early = dayKey(6);
    const late = dayKey(9);
    await scheduleAppliancePriceChange(ownerId, { applianceTypeId: t, newPriceCents: 6_000, effectiveOn: late });
    await scheduleAppliancePriceChange(ownerId, { applianceTypeId: t, newPriceCents: 5_500, effectiveOn: early });
    await applyDueScheduledPriceChanges(new Date(startOf(late).getTime() + 3 * 60 * 60 * 1000));
    expect(await price(t)).toBe(6_000);
    expect(await prisma.pricingRule.count({ where: { applianceTypeId: t } })).toBe(2);
  });

  it("a cancelled change never applies, and a finished one cannot be cancelled", async () => {
    const t = await makeType(5_000);
    const key = dayKey(7);
    const row = await scheduleAppliancePriceChange(ownerId, { applianceTypeId: t, newPriceCents: 7_000, effectiveOn: key });
    const cancelled = await cancelScheduledPriceChange(adminId, row.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledByUserId).toBe(adminId);
    await expect(cancelScheduledPriceChange(adminId, row.id)).rejects.toThrow(/already been applied or cancelled/);
    await applyDueScheduledPriceChanges(new Date(startOf(key).getTime() + 3 * 60 * 60 * 1000));
    expect(await price(t)).toBe(5_000);

    const t2 = await makeType(5_000);
    const key2 = dayKey(8);
    const row2 = await scheduleAppliancePriceChange(ownerId, { applianceTypeId: t2, newPriceCents: 7_000, effectiveOn: key2 });
    await applyDueScheduledPriceChanges(new Date(startOf(key2).getTime() + 3 * 60 * 60 * 1000));
    await expect(cancelScheduledPriceChange(ownerId, row2.id)).rejects.toThrow(/already been applied or cancelled/);
    // The same day can be scheduled again once the first one is no longer waiting.
    const t3 = await makeType(5_000);
    const r3 = await scheduleAppliancePriceChange(ownerId, { applianceTypeId: t3, newPriceCents: 7_000, effectiveOn: key });
    await cancelScheduledPriceChange(ownerId, r3.id);
    await expect(scheduleAppliancePriceChange(ownerId, { applianceTypeId: t3, newPriceCents: 7_100, effectiveOn: key })).resolves.toMatchObject({ status: "PENDING" });
  });

  it("applies every due change even when more than one batch is due", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 55; i += 1) ids.push(await makeType(5_000));
    const key = dayKey(2);
    await prisma.scheduledPriceChange.createMany({
      data: ids.map((applianceTypeId) => ({
        applianceTypeId, newPriceCents: 5_500, effectiveOn: startOf(key), priceAtSchedulingCents: 5_000, createdByUserId: ownerId,
      })),
    });
    const result = await applyDueScheduledPriceChanges(new Date(startOf(key).getTime() + 3 * 60 * 60 * 1000));
    expect(result.applied).toBeGreaterThanOrEqual(55);
    expect(await prisma.scheduledPriceChange.count({ where: { applianceTypeId: { in: ids }, status: "PENDING" } })).toBe(0);
    expect(await prisma.applianceType.count({ where: { id: { in: ids }, monthlyPriceCents: 5_500 } })).toBe(55);
  });

  it("fails safely, leaving the price alone, when the person who scheduled it has since been limited or the type retired", async () => {
    const t = await makeType(5_000);
    const key = dayKey(10);
    const row = await scheduleAppliancePriceChange(adminId, { applianceTypeId: t, newPriceCents: 6_000, effectiveOn: key });
    await prisma.staffCapabilityOverride.create({ data: { userId: adminId, capability: "EDIT_SETTINGS", allowed: false, updatedByUserId: ownerId } });
    const result = await applyDueScheduledPriceChanges(new Date(startOf(key).getTime() + 3 * 60 * 60 * 1000));
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: adminId } });
    expect(result.failed).toBeGreaterThanOrEqual(1);
    const failed = await prisma.scheduledPriceChange.findUniqueOrThrow({ where: { id: row.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.failureMessage).toMatch(/permission/);
    expect(await price(t)).toBe(5_000);

    const t2 = await makeType(5_000);
    const key2 = dayKey(11);
    const row2 = await scheduleAppliancePriceChange(ownerId, { applianceTypeId: t2, newPriceCents: 6_000, effectiveOn: key2 });
    await prisma.applianceType.update({ where: { id: t2 }, data: { isActive: false } });
    await applyDueScheduledPriceChanges(new Date(startOf(key2).getTime() + 3 * 60 * 60 * 1000));
    expect((await prisma.scheduledPriceChange.findUniqueOrThrow({ where: { id: row2.id } })).status).toBe("FAILED");
    expect(await price(t2)).toBe(5_000);
  });
});
