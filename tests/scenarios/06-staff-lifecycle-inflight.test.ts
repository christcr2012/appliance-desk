// PLAN scenario 6 (BATCH-F WU-F3): a staff member is created, given in-flight work (a scheduled visit and an assigned task), then
// removed. Their sessions end at once, the work stays visible and the owner can hand it to someone else, nothing is deleted, the
// removed login can no longer write, and the four roles still hold at the query boundary. Stripe, email and SMS are faked.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The signed-in person is whoever `acting.userId` names; the "session" exists only while a Session row exists for them,
// exactly like a real login that was signed out everywhere.
const acting = vi.hoisted(() => ({ userId: "" }));
const reset = vi.hoisted(() => ({ requests: [] as string[] }));
vi.mock("@/lib/auth", async () => {
  const { prisma } = await import("@/lib/prisma");
  const { sendPasswordEmail } = await import("@/lib/password-email");
  return {
    auth: {
      api: {
        getSession: async () => {
          const live = await prisma.session.findFirst({ where: { userId: acting.userId, expiresAt: { gt: new Date() } } });
          if (!live) return null;
          const user = await prisma.user.findUniqueOrThrow({ where: { id: acting.userId }, select: { id: true, role: true, archivedAt: true } });
          return { user };
        },
        requestPasswordReset: async ({ body }: { body: { email: string } }) => {
          reset.requests.push(body.email);
          // The real reset flow hands the message to the password-email sender; the provider is faked above.
          await sendPasswordEmail({ to: body.email, subject: "Set your password", text: "scenario" });
          return { status: true };
        },
      },
      $context: Promise.resolve({ password: { hash: async (password: string) => `scenario-hash:${password.length}` } }),
    },
  };
});
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: true }) }));
vi.mock("@/domains/security/two-factor", () => ({ twoFactorEnrollmentRequired: async () => false }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { prisma } from "@/lib/prisma";
import { createStaffAccount, deactivateStaffAccount, getAssignableTeamMembers, reactivateStaffAccount } from "@/domains/staff";
import { createJob, updateJobStatus } from "@/domains/jobs";
import { scheduleJob } from "@/domains/jobs/scheduling";
import { createTask, getTaskAssignees, updateTask } from "@/domains/tasks";
import { purgeScenarioQueues } from "../helpers/scenario-order";

const scenarioStartedAt = new Date();
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("scenario 6: staff lifecycle with work in flight", () => {
  const tag = randomUUID().replaceAll("-", "");
  let owner = "";
  let customerUserId = "";
  let staffId = "";
  let jobId = "";
  let taskId = "";
  const loginAs = async (userId: string) => {
    acting.userId = userId;
    await prisma.session.create({ data: { userId, token: `sc6-${tag}-${randomUUID()}`, expiresAt: new Date(Date.now() + 3_600_000) } });
  };

  beforeAll(async () => {
    owner = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER", archivedAt: null } })).id;
    customerUserId = (await prisma.user.create({ data: { email: `${tag}-cust@example.test`, name: "SC6 Customer", role: "CUSTOMER", emailVerified: true } })).id;
  });
  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    await prisma.staffTask.deleteMany({ where: { id: taskId || "none" } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [staffId, jobId, taskId].filter(Boolean) } }] } });
    await prisma.job.deleteMany({ where: { id: jobId || "none" } });
    await prisma.session.deleteMany({ where: { userId: { in: [staffId, customerUserId, owner].filter(Boolean) }, token: { startsWith: `sc6-${tag}` } } });
    await prisma.account.deleteMany({ where: { userId: { in: [staffId, customerUserId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: { in: [staffId, customerUserId].filter(Boolean) } } });
  });

  it("creates the staff login with an invitation, and only an active team member can be given work", async () => {
    const { account, activationEmailSent } = await createStaffAccount(owner, { name: "Scenario Six Staff", email: `${tag}-staff@example.test` });
    staffId = account.id;
    expect(account.role).toBe("STAFF");
    expect(activationEmailSent).toBe(true);
    expect(reset.requests).toContain(`${tag}-staff@example.test`);
    expect(await prisma.auditLog.count({ where: { entityId: staffId, action: "staff.create" } })).toBe(1);
    await expect(createStaffAccount(owner, { name: "Again", email: `${tag}-staff@example.test` })).rejects.toThrow(/already in use/);
    expect((await getAssignableTeamMembers()).map((m) => m.id)).toContain(staffId);
  });

  it("gives them a scheduled visit and a task, and the roles hold at the query boundary", async () => {
    await loginAs(owner);
    const job = await createJob(owner, { type: "MAINTENANCE_VISIT", scheduledAt: new Date(Date.now() + 86_400_000), assignedToUserId: staffId, notes: `SC6 ${tag}` });
    jobId = job.id;
    const task = await createTask({ note: `SC6 ${tag} call the customer`, assigneeUserId: staffId, priority: "HIGH" });
    taskId = task.id;
    expect(await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ assignedToUserId: staffId, status: "SCHEDULED" });
    expect(task.assigneeUserId).toBe(staffId);

    // A customer login reaches none of the team's lists or writes; the owner sees the staff member as assignable.
    await loginAs(customerUserId);
    await expect(getTaskAssignees()).rejects.toThrow();
    await expect(createTask({ note: "customer must not create tasks" })).rejects.toThrow();
    await expect(createJob(customerUserId, { type: "MAINTENANCE_VISIT" })).rejects.toThrow(/no longer has access/);
    expect(await prisma.staffTask.count({ where: { note: "customer must not create tasks" } })).toBe(0);

    // Staff may work their own visit, but a staff login cannot create or reschedule visits (OWNER/ADMIN only).
    await loginAs(staffId);
    await expect(createJob(staffId, { type: "MAINTENANCE_VISIT" })).rejects.toThrow(/no longer has access/);
    expect((await updateJobStatus(staffId, jobId, "IN_PROGRESS")).status).toBe("IN_PROGRESS");
  });

  it("removing the login signs them out at once, keeps their work, and the owner can hand it over", async () => {
    await loginAs(owner);
    await deactivateStaffAccount(owner, staffId);
    const gone = await prisma.user.findUniqueOrThrow({ where: { id: staffId } });
    expect(gone.archivedAt).toBeInstanceOf(Date);
    expect(await prisma.session.count({ where: { userId: staffId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: staffId, action: "staff.deactivate" } })).toBe(1);

    // They can no longer act: no session, and even a direct write is refused at the transaction.
    acting.userId = staffId;
    await expect(createTask({ note: "removed staff must not write" })).rejects.toThrow();
    await expect(updateJobStatus(staffId, jobId, "CANCELLED")).rejects.toThrow(/no longer has access/);
    expect((await getAssignableTeamMembers()).map((m) => m.id)).not.toContain(staffId);

    // Nothing was deleted: the visit and task are still there, still assigned, so the owner can see them and move them.
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    const task = await prisma.staffTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(job.assignedToUserId).toBe(staffId);
    expect(task.assigneeUserId).toBe(staffId);
    expect(await prisma.staffTask.count({ where: { note: "removed staff must not write" } })).toBe(0);

    // The removed login cannot be chosen as the new owner of work; the owner takes it over instead.
    await loginAs(owner);
    await expect(updateTask(task.id, task.version, { note: task.note, assigneeUserId: staffId })).rejects.toThrow(/active team member/);
    await updateTask(task.id, task.version, { note: task.note, assigneeUserId: owner });
    await scheduleJob(owner, { jobId, expectedVersion: job.version, scheduledAt: new Date(Date.now() + 2 * 86_400_000), durationMinutes: 60, assignedToUserId: owner, confirmedConflictJobIds: [] });
    expect((await prisma.staffTask.findUniqueOrThrow({ where: { id: taskId } })).assigneeUserId).toBe(owner);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).assignedToUserId).toBe(owner);
    expect(await prisma.auditLog.count({ where: { entityId: taskId } })).toBeGreaterThanOrEqual(2);
  });

  it("restoring the login brings back access without any deletion", async () => {
    await reactivateStaffAccount(owner, staffId);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: staffId } })).archivedAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: staffId, action: "staff.reactivate" } })).toBe(1);
    expect((await getAssignableTeamMembers()).map((m) => m.id)).toContain(staffId);
  });
});
