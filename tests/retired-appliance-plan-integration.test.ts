import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  addSalvagedParts, completeRetiredPlan, completeRetiredPlans, countRetiredAwaitingDecision, daysBetweenKeys,
  getSalvagedParts, listRetiredAppliances, reopenRetiredPlan, retirementIsOverdue, setRetiredPlan,
} from "@/domains/inventory/retired-plans";
import { findPartLedgerMismatches } from "@/domains/purchasing/ledger";
import { businessDateKey } from "@/lib/business-date";

// Batch M-2: what happens to a retired appliance.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";
const key = () => `plan-${randomUUID()}`;
const today = () => businessDateKey(new Date());

describe("retirement follow-up days (pure)", () => {
  it("counts whole Denver days and respects 0 = off", () => {
    expect(daysBetweenKeys("2026-10-01", "2026-10-31")).toBe(30);
    const retired = new Date("2026-10-01T18:00:00Z");
    expect(retirementIsOverdue(retired, new Date("2026-10-30T18:00:00Z"), 30)).toBe(false); // 29 days
    expect(retirementIsOverdue(retired, new Date("2026-10-31T18:00:00Z"), 30)).toBe(true); // 30 days
    expect(retirementIsOverdue(retired, new Date("2026-11-01T18:00:00Z"), 30)).toBe(true); // 31 days
    expect(retirementIsOverdue(retired, new Date("2027-01-01T18:00:00Z"), 0)).toBe(false);
    // 11 p.m. Denver on Oct 30 is already Oct 31 in UTC, but still the 29th day in Denver.
    expect(retirementIsOverdue(retired, new Date("2026-10-31T05:00:00Z"), 30)).toBe(false);
  });
});

describe.skipIf(!enabled)("retired appliance plans on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  let ownerId: string;
  let adminId: string;
  let typeId: string;
  let originalDays = 30;
  const created: string[] = [];

  const retired = async (opts: { retiredDaysAgo?: number } = {}) => {
    const id = `ret-${tag}-${randomUUID().slice(0, 6)}`;
    await prisma.appliance.create({ data: { id, assetNumber: `RET-${tag}-${created.length}`, applianceTypeId: typeId, status: "RETIRED" } });
    created.push(id);
    const at = new Date(Date.now() - (opts.retiredDaysAgo ?? 0) * 86_400_000);
    await prisma.auditLog.create({ data: { userId: ownerId, action: "appliance.unit.status", entityType: "Appliance", entityId: id, newValue: { status: "RETIRED" }, createdAt: at } });
    return id;
  };

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    adminId = `ret-admin-${tag}`;
    await prisma.user.create({ data: { id: adminId, email: `${tag}-admin@example.test`, role: "ADMIN", emailVerified: true } });
    typeId = `ret-type-${tag}`;
    await prisma.applianceType.create({ data: { id: typeId, name: `Retired Type ${tag}`, slug: `retired-type-${tag}` } });
    originalDays = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { retiredFollowUpDays: true } })).retiredFollowUpDays;
  });

  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { retiredFollowUpDays: originalDays } });
  });

  it("only a retired appliance can have a plan", async () => {
    const id = `ret-live-${tag}`;
    await prisma.appliance.create({ data: { id, assetNumber: `LIVE-${tag}`, applianceTypeId: typeId, status: "AVAILABLE" } });
    created.push(id);
    await expect(setRetiredPlan(ownerId, id, { choice: "SCRAP" })).rejects.toThrow(/Retire it first/);
  });

  it("a plan can be set, changed and cleared until it is done; OTHER needs a note", async () => {
    const id = await retired();
    await expect(setRetiredPlan(ownerId, id, { choice: "OTHER" })).rejects.toThrow(/note/);
    await setRetiredPlan(ownerId, id, { choice: "SCRAP" });
    await setRetiredPlan(ownerId, id, { choice: "OTHER", note: "Donated to the church" });
    expect((await prisma.retiredAppliancePlan.findUniqueOrThrow({ where: { applianceId: id } })).choice).toBe("OTHER");
    await setRetiredPlan(ownerId, id, { choice: null });
    expect(await prisma.retiredAppliancePlan.count({ where: { applianceId: id } })).toBe(0);
    await setRetiredPlan(ownerId, id, { choice: "DISPOSE" });
    await completeRetiredPlan(ownerId, id, { doneOnKey: today() });
    await expect(setRetiredPlan(ownerId, id, { choice: "SCRAP" })).rejects.toThrow(/already marked done/);
    // choosing, changing, finishing create no books entries
    expect(await prisma.journalEntry.count({ where: { sourceId: id } })).toBe(0);
  });

  it("a sell plan is not finished by hand, and a future date is refused", async () => {
    const id = await retired();
    await setRetiredPlan(ownerId, id, { choice: "SELL" });
    await expect(completeRetiredPlan(ownerId, id, { doneOnKey: today() })).rejects.toThrow(/rung up/);
    const other = await retired();
    await setRetiredPlan(ownerId, other, { choice: "SCRAP" });
    await expect(completeRetiredPlan(ownerId, other, { doneOnKey: "2999-01-01" })).rejects.toThrow(/future/);
  });

  it("a truckload is marked done together or not at all, and strip plans are excluded", async () => {
    const a = await retired(); const b = await retired(); const strip = await retired();
    await setRetiredPlan(ownerId, a, { choice: "SCRAP" });
    await setRetiredPlan(ownerId, b, { choice: "DISPOSE" });
    await setRetiredPlan(ownerId, strip, { choice: "STRIP" });
    await expect(completeRetiredPlans(ownerId, [a, b, strip], today())).rejects.toThrow(/one at a time/);
    expect((await prisma.retiredAppliancePlan.findMany({ where: { applianceId: { in: [a, b] } } })).every((p) => p.doneOn === null)).toBe(true);
    expect(await completeRetiredPlans(ownerId, [a, b], today())).toEqual({ marked: 2 });
    expect((await listRetiredAppliances(ownerId, "DONE")).map((r) => r.id)).toEqual(expect.arrayContaining([a, b]));
    expect(await completeRetiredPlans(ownerId, [a, b], today())).toEqual({ marked: 2 }); // repeat changes nothing
  });

  it("strip for parts adds parts at $0 once under retry, needs the remainder choice, and keeps the plan", async () => {
    const id = await retired();
    await setRetiredPlan(ownerId, id, { choice: "STRIP" });
    const existing = await prisma.partRecord.create({ data: { modelNumber: `RET-${tag}`, partNumber: "ELEM-1", partName: "Heating element" } });
    const opKey = key();
    const lines = [
      { partRecordId: existing.id, quantity: 1, note: "tested good" },
      { newPart: { modelNumber: `RET-${tag}`, partNumber: "BELT-2", partName: "Drum belt" }, quantity: 2 },
    ];
    const first = await addSalvagedParts(ownerId, id, opKey, lines);
    expect(first.replayed).toBe(false);
    const again = await addSalvagedParts(ownerId, id, opKey, lines);
    expect(again.replayed).toBe(true);
    const parts = await getSalvagedParts(id);
    expect(parts.map((p) => p.quantityDelta).sort()).toEqual([1, 2]);
    const rows = await prisma.partStockMovement.findMany({ where: { applianceId: id } });
    expect(rows.every((r) => r.kind === "SALVAGE" && r.unitCostCents === 0 && r.resaleUnits === 0)).toBe(true);
    expect(await findPartLedgerMismatches(prisma, first.partRecordIds)).toEqual([]);
    // the same part number is reused, never duplicated
    expect(await prisma.partRecord.count({ where: { modelNumber: `RET-${tag}`, partNumber: "BELT-2" } })).toBe(1);

    await expect(setRetiredPlan(ownerId, id, { choice: "SCRAP" })).rejects.toThrow(/stay/);
    await expect(completeRetiredPlan(ownerId, id, { doneOnKey: today() })).rejects.toThrow(/rest/);
    await completeRetiredPlan(ownerId, id, { doneOnKey: today(), remainder: "SCRAPPED" });
    await expect(addSalvagedParts(ownerId, id, key(), lines)).rejects.toThrow(/already marked done/);
    expect(await prisma.journalEntry.count({ where: { sourceId: id } })).toBe(0);
  });

  it("parts can't be taken from an appliance that is not planned for stripping", async () => {
    const id = await retired();
    await setRetiredPlan(ownerId, id, { choice: "SCRAP" });
    await expect(addSalvagedParts(ownerId, id, key(), [{ newPart: { modelNumber: "X", partNumber: "Y" }, quantity: 1 }])).rejects.toThrow(/Strip it for parts/);
  });

  it("only the owner can reopen a finished plan, and it needs a reason", async () => {
    const id = await retired();
    await setRetiredPlan(ownerId, id, { choice: "DISPOSE" });
    await completeRetiredPlan(ownerId, id, { doneOnKey: today() });
    await expect(reopenRetiredPlan(adminId, id, "mistake")).rejects.toThrow();
    await expect(reopenRetiredPlan(ownerId, id, "  ")).rejects.toThrow(/why/);
    await reopenRetiredPlan(ownerId, id, "Wrong appliance");
    const plan = await prisma.retiredAppliancePlan.findUniqueOrThrow({ where: { applianceId: id } });
    expect(plan.doneOn).toBeNull();
    expect(plan.reopenReason).toBe("Wrong appliance");
  });

  it("the Today count includes no-plan and unfinished appliances older than the owner's days, and 0 turns it off", async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { retiredFollowUpDays: 30 } });
    const base = await countRetiredAwaitingDecision();
    const old = await retired({ retiredDaysAgo: 31 });
    const fresh = await retired({ retiredDaysAgo: 10 });
    const oldDone = await retired({ retiredDaysAgo: 40 });
    await setRetiredPlan(ownerId, oldDone, { choice: "DISPOSE" });
    await completeRetiredPlan(ownerId, oldDone, { doneOnKey: today() });
    expect(await countRetiredAwaitingDecision()).toBe(base + 1);
    await setRetiredPlan(ownerId, fresh, { choice: "SCRAP" });
    expect(await countRetiredAwaitingDecision()).toBe(base + 1);
    await setRetiredPlan(ownerId, old, { choice: "SCRAP" }); // planned but not done is still waiting
    expect(await countRetiredAwaitingDecision()).toBe(base + 1);
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { retiredFollowUpDays: 0 } });
    expect(await countRetiredAwaitingDecision()).toBe(0);
  });

  it("every list filter works", async () => {
    const id = await retired();
    expect((await listRetiredAppliances(ownerId, "DECIDE_LATER")).some((r) => r.id === id)).toBe(true);
    await setRetiredPlan(ownerId, id, { choice: "SCRAP" });
    expect((await listRetiredAppliances(ownerId, "DECIDE_LATER")).some((r) => r.id === id)).toBe(false);
    expect((await listRetiredAppliances(ownerId, "SCRAP")).some((r) => r.id === id)).toBe(true);
    expect((await listRetiredAppliances(ownerId, "ALL")).some((r) => r.id === id)).toBe(true);
  });
});
