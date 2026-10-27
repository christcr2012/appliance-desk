import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { completeYearlyCheckup, saveContinuityProfile, setChargesPaused } from "@/domains/continuity/actions";
import { runAutomation } from "@/domains/automation/runs";
import { loadContinuity } from "@/domains/continuity/reads";
import { listContinuityAttention } from "@/domains/exceptions/continuity-attention";

// OPS-8 on real Postgres.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("continuity (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 8);
  const staffId = `ops8-staff-${tag}`;
  const adminId = `ops8-admin-${tag}`;
  const ruleKeys = [`late-fees`, `backup`];
  let ownerId = "";
  let saved: Record<string, unknown> | null = null;
  const december = new Date("2026-12-10T18:00:00Z");

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.user.create({ data: { id: staffId, email: `${staffId}@example.test`, role: "STAFF", emailVerified: true } });
    await prisma.user.create({ data: { id: adminId, email: `${adminId}@example.test`, role: "ADMIN", emailVerified: true } });
    saved = await prisma.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {} });
  });

  afterAll(async () => {
    await prisma.yearlyCheckup.deleteMany({ where: { completedByUserId: ownerId, year: { in: [2031, 2032] } } });
    await prisma.automationRun.deleteMany({ where: { ruleKey: { in: ruleKeys }, runKey: { contains: "2031-" } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: [staffId, adminId] } }, { userId: ownerId, action: { startsWith: "continuity." } }] } });
    if (saved) {
      await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: {
          continuityEmergencyName: saved.continuityEmergencyName as string | null, continuityEmergencyContact: saved.continuityEmergencyContact as string | null,
          continuitySuccessorName: saved.continuitySuccessorName as string | null, continuitySuccessorContact: saved.continuitySuccessorContact as string | null,
          continuityCpaName: saved.continuityCpaName as string | null, continuityCpaContact: saved.continuityCpaContact as string | null,
          continuityAttorneyName: saved.continuityAttorneyName as string | null, continuityAttorneyContact: saved.continuityAttorneyContact as string | null,
          continuityRecordsNote: saved.continuityRecordsNote as string | null, continuityReviewedAt: saved.continuityReviewedAt as Date | null,
          chargesPausedAt: null, chargesPausedByUserId: null, chargesPausedNote: null,
        },
      });
    }
    await prisma.user.deleteMany({ where: { id: { in: [staffId, adminId] } } });
  });

  it("only the owner saves the details; it is audited and shows on the page", async () => {
    await expect(saveContinuityProfile(staffId, { continuityCpaName: "X" })).rejects.toThrow();
    await expect(saveContinuityProfile(adminId, { continuityCpaName: "X" })).rejects.toThrow();
    await saveContinuityProfile(ownerId, { continuityCpaName: "Pat Lee", continuityCpaContact: "pat@cpa.example", continuityRecordsNote: "password manager" });
    const view = await loadContinuity(new Date());
    expect(view.profile.continuityCpaName).toBe("Pat Lee");
    expect(view.gaps).toContain("an emergency contact");
    expect(await prisma.auditLog.count({ where: { userId: ownerId, action: "continuity.profile_saved" } })).toBeGreaterThan(0);
  });

  it("the pause switch is owner-only, audited once per real change, and stops only the charge and reminder jobs", async () => {
    await expect(setChargesPaused(staffId, true, null)).rejects.toThrow();
    await expect(setChargesPaused(adminId, true, null)).rejects.toThrow();
    const auditBefore = await prisma.auditLog.count({ where: { userId: ownerId, action: "continuity.charges_paused" } });
    expect(await setChargesPaused(ownerId, true, "out of town")).toEqual({ changed: true, paused: true });
    expect(await setChargesPaused(ownerId, true, "again")).toEqual({ changed: false, paused: true });
    expect(await prisma.auditLog.count({ where: { userId: ownerId, action: "continuity.charges_paused" } })).toBe(auditBefore + 1);

    const when = new Date("2031-03-05T15:00:00Z");
    let ran = 0;
    const paused = await runAutomation({ ruleKey: "late-fees", now: when, work: async () => { ran += 1; return { counts: {} }; } });
    expect(paused.outcome).toBe("PAUSED");
    const safety = await runAutomation({ ruleKey: "backup", now: when, work: async () => { ran += 10; return { counts: {} }; } });
    expect(safety.outcome).toBe("RAN");
    expect(ran).toBe(10);

    const attention = await listContinuityAttention(new Date());
    expect(attention.some((r) => r.todoKey === "continuity:charges-paused" && r.href === "/desk/continuity")).toBe(true);

    expect(await setChargesPaused(ownerId, false, null)).toEqual({ changed: true, paused: false });
    expect((await listContinuityAttention(new Date())).some((r) => r.todoKey === "continuity:charges-paused")).toBe(false);
    expect(await prisma.auditLog.count({ where: { userId: ownerId, action: "continuity.charges_resumed" } })).toBeGreaterThan(0);
  });

  it("the December check-up shows on the owner's To do, finishes once, and then goes away", async () => {
    const year = 2026;
    await prisma.yearlyCheckup.deleteMany({ where: { year } });
    expect((await listContinuityAttention(december)).some((r) => r.todoKey === `continuity:checkup:${year}`)).toBe(true);
    expect((await listContinuityAttention(new Date("2026-11-20T18:00:00Z"))).some((r) => r.todoKey?.startsWith("continuity:checkup"))).toBe(false);
    await expect(completeYearlyCheckup(staffId, ["insurance"], null, december)).rejects.toThrow();
    await completeYearlyCheckup(ownerId, ["insurance", "bogus", "taxes"], "all good", december);
    const row = await prisma.yearlyCheckup.findUniqueOrThrow({ where: { year } });
    expect(row.ticked).toEqual(["insurance", "taxes"]);
    await expect(completeYearlyCheckup(ownerId, [], null, december)).rejects.toThrow(/already finished/);
    expect((await listContinuityAttention(december)).some((r) => r.todoKey === `continuity:checkup:${year}`)).toBe(false);
    await prisma.yearlyCheckup.delete({ where: { year } });
  });
});
