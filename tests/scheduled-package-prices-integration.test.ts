import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import {
  applyDueScheduledPriceChanges, cancelScheduledPriceChange, listScheduledPriceChanges, scheduleAppliancePriceChange,
  schedulePackagePriceChange,
} from "@/domains/pricing/scheduled";

// Batch O-4 part 2 on real Postgres: price changes with a start date for a rental set (package), including who may,
// one per day, applying once, history rows, failure paths, and that the one-target database rule holds.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

const dayKey = (offsetDays: number) => businessDateKey(new Date(Date.now() + offsetDays * 86_400_000));
const startOf = (key: string) => businessDateFromKey(key)!;

describe.skipIf(!enabled)("scheduled set price changes on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  let ownerId: string;
  const adminId = `spk-admin-${tag}`;
  const staffId = `spk-staff-${tag}`;
  const typeId = `spk-type-${tag}`;
  const sets: string[] = [];

  const makeSet = async (price = 9_000, isActive = true) => {
    const id = `spk-set-${tag}-${sets.length}`;
    await prisma.rentalPackage.create({
      data: {
        id, name: `Set ${tag} ${sets.length}`, slug: `set-${tag}-${sets.length}`, monthlyPriceCents: price, isActive,
        components: { create: [{ applianceTypeId: typeId, quantity: 1 }] },
      },
    });
    sets.push(id);
    return id;
  };
  const price = async (id: string) => (await prisma.rentalPackage.findUniqueOrThrow({ where: { id } })).monthlyPriceCents;
  const dueTime = (key: string) => new Date(startOf(key).getTime() + 3 * 60 * 60 * 1000);

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.user.createMany({ data: [
      { id: adminId, name: "Set Admin", email: `${tag}-spkadmin@example.test`, role: "ADMIN", emailVerified: true },
      { id: staffId, name: "Set Staff", email: `${tag}-spkstaff@example.test`, role: "STAFF", emailVerified: true },
    ] });
    await prisma.applianceType.create({ data: { id: typeId, name: `Set part ${tag}`, slug: `set-part-${tag}`, monthlyPriceCents: 5_000 } });
  });
  afterAll(async () => {
    await prisma.scheduledPriceChange.deleteMany({ where: { OR: [{ packageId: { in: sets } }, { applianceTypeId: typeId }] } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: sets } }, { userId: { in: [adminId, staffId] } }] } });
    await prisma.pricingRule.deleteMany({ where: { label: { startsWith: `Set ${tag}` } } });
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: adminId } });
    await prisma.rentalPackage.deleteMany({ where: { id: { in: sets } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, staffId] } } });
  });

  it("saves a waiting change without touching the price, refuses a second one for the same day, and lists it as a set", async () => {
    const s = await makeSet(9_000);
    const key = dayKey(3);
    const row = await schedulePackagePriceChange(adminId, { packageId: s, newPriceCents: 9_500, effectiveOn: key, note: "fall" });
    expect(row.status).toBe("PENDING");
    expect(row.applianceTypeId).toBeNull();
    expect(row.priceAtSchedulingCents).toBe(9_000);
    expect(await price(s)).toBe(9_000);
    await expect(schedulePackagePriceChange(ownerId, { packageId: s, newPriceCents: 9_600, effectiveOn: key }))
      .rejects.toThrow(/already a price change scheduled/);
    const listed = await listScheduledPriceChanges();
    expect(listed.pending.some((r) => r.id === row.id && r.kind === "SET" && r.targetName === `Set ${tag} 0`)).toBe(true);
  });

  it("refuses staff, a limited admin, a retired set, a missing set and a bad date, writing nothing", async () => {
    const s = await makeSet(9_000);
    const retired = await makeSet(9_000, false);
    const input = { packageId: s, newPriceCents: 9_500, effectiveOn: dayKey(4) };
    await expect(schedulePackagePriceChange(staffId, input)).rejects.toThrow();
    await prisma.staffCapabilityOverride.create({ data: { userId: adminId, capability: "EDIT_SETTINGS", allowed: false, updatedByUserId: ownerId } });
    await expect(schedulePackagePriceChange(adminId, input)).rejects.toThrow(/permission/i);
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: adminId } });
    await expect(schedulePackagePriceChange(adminId, { ...input, packageId: retired })).rejects.toThrow(/retired/);
    await expect(schedulePackagePriceChange(adminId, { ...input, packageId: "nope" })).rejects.toThrow(/Couldn't find/);
    await expect(schedulePackagePriceChange(adminId, { ...input, effectiveOn: dayKey(0) })).rejects.toThrow(/after today/);
    expect(await prisma.scheduledPriceChange.count({ where: { packageId: { in: [s, retired] } } })).toBe(0);
  });

  it("applies on the start day exactly once with the normal history and audit rows, and never earlier", async () => {
    const s = await makeSet(9_000);
    const key = dayKey(5);
    const row = await schedulePackagePriceChange(adminId, { packageId: s, newPriceCents: 9_900, effectiveOn: key });
    await applyDueScheduledPriceChanges(new Date(startOf(key).getTime() - 60 * 60 * 1000));
    expect(await price(s)).toBe(9_000);

    const first = await applyDueScheduledPriceChanges(dueTime(key));
    expect(first.applied).toBeGreaterThanOrEqual(1);
    expect(await price(s)).toBe(9_900);
    const done = await prisma.scheduledPriceChange.findUniqueOrThrow({ where: { id: row.id } });
    expect(done.status).toBe("APPLIED");
    expect(done.priceBeforeApplyCents).toBe(9_000);
    expect(await prisma.pricingRule.count({ where: { label: `Set ${tag} ${sets.indexOf(s)} — set price`, oldValueCents: 9_000, newValueCents: 9_900 } })).toBe(1);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: s, action: "package.update" } });
    expect(audit?.userId).toBe(adminId);
    expect(JSON.stringify(audit?.newValue)).toContain(row.id);

    const again = await applyDueScheduledPriceChanges(new Date(dueTime(key).getTime() + 7 * 86_400_000));
    expect(again.applied).toBe(0);
    expect(await prisma.pricingRule.count({ where: { label: `Set ${tag} ${sets.indexOf(s)} — set price` } })).toBe(1);
  });

  it("when two changes for one set are both due, the later start day wins; cancel rules match appliance changes", async () => {
    const s = await makeSet(9_000);
    const early = dayKey(6);
    const late = dayKey(9);
    await schedulePackagePriceChange(ownerId, { packageId: s, newPriceCents: 10_000, effectiveOn: late });
    await schedulePackagePriceChange(ownerId, { packageId: s, newPriceCents: 9_100, effectiveOn: early });
    await applyDueScheduledPriceChanges(dueTime(late));
    expect(await price(s)).toBe(10_000);

    const c = await makeSet(9_000);
    const key = dayKey(7);
    const row = await schedulePackagePriceChange(ownerId, { packageId: c, newPriceCents: 7_000, effectiveOn: key });
    const cancelled = await cancelScheduledPriceChange(adminId, row.id);
    expect(cancelled.status).toBe("CANCELLED");
    const cancelAudit = await prisma.auditLog.findFirst({ where: { entityId: c, action: "pricing.schedule_cancel" } });
    expect(cancelAudit?.entityType).toBe("RentalPackage");
    await expect(cancelScheduledPriceChange(adminId, row.id)).rejects.toThrow(/already been applied or cancelled/);
    await applyDueScheduledPriceChanges(dueTime(key));
    expect(await price(c)).toBe(9_000);
  });

  it("fails safely, leaving the price alone, when the scheduler was since limited or the set retired", async () => {
    const s = await makeSet(9_000);
    const key = dayKey(10);
    const row = await schedulePackagePriceChange(adminId, { packageId: s, newPriceCents: 9_800, effectiveOn: key });
    await prisma.staffCapabilityOverride.create({ data: { userId: adminId, capability: "EDIT_SETTINGS", allowed: false, updatedByUserId: ownerId } });
    const result = await applyDueScheduledPriceChanges(dueTime(key));
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: adminId } });
    expect(result.failed).toBeGreaterThanOrEqual(1);
    const failed = await prisma.scheduledPriceChange.findUniqueOrThrow({ where: { id: row.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.failureMessage).toMatch(/permission/);
    expect(await price(s)).toBe(9_000);

    const s2 = await makeSet(9_000);
    const key2 = dayKey(11);
    const row2 = await schedulePackagePriceChange(ownerId, { packageId: s2, newPriceCents: 9_800, effectiveOn: key2 });
    await prisma.rentalPackage.update({ where: { id: s2 }, data: { isActive: false } });
    await applyDueScheduledPriceChanges(dueTime(key2));
    const f2 = await prisma.scheduledPriceChange.findUniqueOrThrow({ where: { id: row2.id } });
    expect(f2.status).toBe("FAILED");
    expect(f2.failureMessage).toMatch(/retired/);
    expect(await price(s2)).toBe(9_000);
  });

  it("the database refuses a change with no target or with both targets", async () => {
    const s = await makeSet(9_000);
    const base = { newPriceCents: 1, effectiveOn: startOf(dayKey(20)), priceAtSchedulingCents: 1, createdByUserId: ownerId };
    await expect(prisma.scheduledPriceChange.create({ data: { ...base } })).rejects.toThrow();
    await expect(prisma.scheduledPriceChange.create({ data: { ...base, packageId: s, applianceTypeId: typeId } })).rejects.toThrow();
    // An appliance change still works next to set changes.
    await expect(scheduleAppliancePriceChange(ownerId, { applianceTypeId: typeId, newPriceCents: 5_100, effectiveOn: dayKey(21) })).resolves.toMatchObject({ packageId: null });
  });
});
