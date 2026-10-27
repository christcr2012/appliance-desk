import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createJob } from "@/domains/jobs";
import { scheduleJob } from "@/domains/jobs/scheduling";
import { listTeamCertifications, removeTeamCertification, saveTeamCertification } from "@/domains/certifications/actions";

// OPS-2: a sealed-system repair can only be given to someone with a refrigerant certification on file.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("sealed-system repair gate (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 8);
  const certified = `ops2s-cert-${tag}`;
  const uncertified = `ops2s-plain-${tag}`;
  const adminId = `ops2s-admin-${tag}`;
  let ownerId = "";
  const jobs: string[] = [];

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    for (const [id, role] of [[certified, "STAFF"], [uncertified, "STAFF"], [adminId, "ADMIN"]] as const) {
      await prisma.user.create({ data: { id, name: `Tech ${id}`, email: `${id}@example.test`, role, emailVerified: true } });
    }
  });

  afterAll(async () => {
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.job.deleteMany({ where: { id: { in: jobs } } });
    await prisma.teamCertification.deleteMany({ where: { userId: { in: [certified, uncertified, adminId, ownerId] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [certified, uncertified, adminId, ownerId, ...jobs] } }, { userId: { in: [adminId] } }] } });
    await prisma.user.deleteMany({ where: { id: { in: [certified, uncertified, adminId] } } });
  });

  it("lets only the owner record or remove a certification, for an active team member", async () => {
    await expect(saveTeamCertification(adminId, certified, { certificationNumber: "T1-123" })).rejects.toThrow();
    await expect(saveTeamCertification(ownerId, certified, { certificationNumber: "  " })).rejects.toThrow(/number/);
    await expect(saveTeamCertification(ownerId, "missing", { certificationNumber: "T1-123" })).rejects.toThrow(/active team member/);
    await saveTeamCertification(ownerId, certified, { certificationNumber: "T1-123", issuedOnKey: "2024-05-01" });
    const list = await listTeamCertifications();
    expect(list.find((p) => p.id === certified)?.certification?.certificationNumber).toBe("T1-123");
    expect(list.find((p) => p.id === uncertified)?.certification).toBeNull();
    await saveTeamCertification(ownerId, certified, { certificationNumber: "T1-456" });
    expect(await prisma.teamCertification.count({ where: { userId: certified } })).toBe(1);
  });

  it("refuses to give a sealed-system repair to someone without a certification, at creation and at reassignment", async () => {
    const when = new Date(Date.now() + 5 * 86_400_000);
    await expect(createJob(ownerId, { type: "MAINTENANCE_VISIT", scheduledAt: when, assignedToUserId: uncertified, sealedSystem: true })).rejects.toThrow(/Hire a certified technician/);
    await expect(createJob(ownerId, { type: "DELIVERY", scheduledAt: when, sealedSystem: true })).rejects.toThrow(/Only a repair visit/);
    const ok = await createJob(ownerId, { type: "MAINTENANCE_VISIT", scheduledAt: when, assignedToUserId: certified, sealedSystem: true });
    jobs.push(ok.id);
    expect(ok.sealedSystem).toBe(true);
    // Unassigned is allowed (nobody is doing it yet); an ordinary repair has no such rule.
    const later = new Date(when.getTime() + 6 * 3_600_000);
    const open = await createJob(ownerId, { type: "MAINTENANCE_VISIT", scheduledAt: later, sealedSystem: true });
    const ordinary = await createJob(ownerId, { type: "MAINTENANCE_VISIT", scheduledAt: when, assignedToUserId: uncertified });
    jobs.push(open.id, ordinary.id);
    // Reassigning the open sealed job: refused to the uncertified person, allowed to the certified one.
    const base = { jobId: open.id, scheduledAt: later, durationMinutes: null, confirmedConflictJobIds: [] as string[] };
    await expect(scheduleJob(ownerId, { ...base, expectedVersion: open.version, assignedToUserId: uncertified })).rejects.toThrow(/Hire a certified technician/);
    const fresh = await prisma.job.findUniqueOrThrow({ where: { id: open.id }, select: { version: true, assignedToUserId: true } });
    expect(fresh.assignedToUserId).toBeNull();
    await scheduleJob(ownerId, { ...base, expectedVersion: fresh.version, assignedToUserId: certified });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: open.id } })).assignedToUserId).toBe(certified);
    // The owner is held to the same rule as everyone else.
    await expect(createJob(ownerId, { type: "MAINTENANCE_VISIT", scheduledAt: when, assignedToUserId: ownerId, sealedSystem: true })).rejects.toThrow(/Hire a certified technician/);
  });

  it("stops allowing new assignments once the certification is removed, without touching visits already assigned", async () => {
    const when = new Date(Date.now() + 6 * 86_400_000);
    await removeTeamCertification(ownerId, certified);
    await expect(createJob(ownerId, { type: "MAINTENANCE_VISIT", scheduledAt: when, assignedToUserId: certified, sealedSystem: true })).rejects.toThrow(/Hire a certified technician/);
    expect(jobs.length).toBeGreaterThan(0);
    const kept = await prisma.job.findMany({ where: { id: { in: jobs }, assignedToUserId: certified } });
    expect(kept.length).toBeGreaterThan(0);
  });
});
