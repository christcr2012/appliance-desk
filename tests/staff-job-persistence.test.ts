import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
const actor = vi.hoisted(() => ({ id: "", role: "STAFF" }));
vi.mock("@/lib/session", () => ({ requireRole: async () => ({ user: actor }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { prisma } from "@/lib/prisma";
import { getDeskJobById } from "@/domains/desk-access";
import { updateApplianceStatusFromJobAction } from "@/app/desk/jobs/actions";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
describe.skipIf(!enabled)("staff job provenance and writes in disposable Postgres", () => {
  const tag = randomUUID(); const jobId = `staff-job-${tag}`;
  const ids = ["original", "replacement", "unrelated"].map(kind => `staff-${tag}-${kind}`);
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...ids, jobId] } } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.appliance.deleteMany({ where: { id: { in: ids } } });
  });
  it("uses recorded incoming intent, strips finance, rejects unrelated writes and persists linked staff updates", async () => {
    actor.id = (await prisma.user.findFirstOrThrow({ where: { role: "STAFF" } })).id;
    const type = await prisma.applianceType.findFirstOrThrow();
    await prisma.appliance.createMany({ data: ids.map(id => ({ id, assetNumber: id, applianceTypeId: type.id, status: "RESERVED", acquisitionCostCents: 932187 })) });
    await prisma.job.create({ data: { id: jobId, type: "SWAP", status: "COMPLETED", partsCostCents: 8675309, appliances: { create: ids.slice(0, 2).map(applianceId => ({ applianceId })) } } });
    await prisma.auditLog.createMany({ data: [
      { action: "appliance.unit.status", entityType: "Appliance", entityId: ids[1], newValue: { jobId, reason: "Swap started", status: "RESERVED" } },
      { action: "appliance.unit.status", entityType: "Appliance", entityId: ids[0], newValue: { jobId: "other-job", reason: "Swap started", status: "RESERVED" } },
      { action: "appliance.unit.status", entityType: "Appliance", entityId: ids[2], newValue: { jobId, reason: "Swap started", status: "RESERVED" } },
    ] });
    const job = await getDeskJobById(jobId);
    expect(job?.swapReplacementIds).toEqual([ids[1]]);
    expect(JSON.stringify(job)).not.toMatch(/partsCostCents|laborCostCents|acquisitionCostCents|8675309|932187/);
    expect((await updateApplianceStatusFromJobAction(ids[2], "RENTED", jobId)).status).toBe("error");
    expect((await updateApplianceStatusFromJobAction(ids[0], "RENTED")).status).toBe("error");
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: ids[2] } })).status).toBe("RESERVED");
    expect((await updateApplianceStatusFromJobAction(ids[1], "RENTED", jobId)).status).toBe("success");
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: ids[1] } })).status).toBe("RENTED");
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: ids[0] } })).status).toBe("RESERVED");
    expect(await prisma.auditLog.count({ where: { userId: actor.id, entityId: ids[1], newValue: { path: ["status"], equals: "RENTED" } } })).toBe(1);
    expect((await getDeskJobById(jobId))?.swapReplacementIds).toEqual([ids[1]]);
  });
});
