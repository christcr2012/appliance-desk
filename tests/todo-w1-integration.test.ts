import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { todoKey, snoozeTodo, unsnoozeTodo } from "@/domains/exceptions/todo";
import { businessDateKey } from "@/lib/business-date";
import type { ExceptionItem } from "@/domains/exceptions/rules";

const dbUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(dbUrl.hostname) &&
  dbUrl.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("W-1 durable snooze permissions and audit (disposable Postgres)", () => {
  const suffix = randomUUID().replaceAll("-", "");
  const ownerId = "w1-owner-" + suffix;
  const staffId = "w1-staff-" + suffix;
  const item: ExceptionItem = {
    category: "OVERDUE_JOB", severity: "medium", title: "Missed service appointment",
    detail: "Still needs attention", href: "/desk/jobs/job-record-" + suffix,
    since: new Date("2026-10-09T15:00:00Z"),
  };
  const key = todoKey(item);
  const resume = new Date(); resume.setUTCDate(resume.getUTCDate() + 3);
  const until = businessDateKey(resume);

  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: ownerId, email: suffix + "owner@example.test", role: "OWNER" },
      { id: staffId, email: suffix + "staff@example.test", role: "STAFF" },
    ] });
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "ExceptionSnooze", entityId: key } });
    await prisma.exceptionSnooze.deleteMany({ where: { key } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
  });
  it("refuses a staff actor and a missing live issue without creating state", async () => {
    await expect(snoozeTodo({ key, until, reason: "Awaiting parts", actorUserId: staffId, active: [item] })).rejects.toThrow();
    await expect(snoozeTodo({ key, until, reason: "Awaiting parts", actorUserId: ownerId, active: [] })).rejects.toThrow();
    expect(await prisma.exceptionSnooze.count({ where: { key } })).toBe(0);
  });
  it("persists a snooze, a revised reason and two attributed audit entries", async () => {
    await snoozeTodo({ key, until, reason: "Awaiting parts", actorUserId: ownerId, active: [item] });
    await snoozeTodo({ key, until, reason: "Rescheduled technician", actorUserId: ownerId, active: [item] });
    const record = await prisma.exceptionSnooze.findUniqueOrThrow({ where: { key } });
    expect(record.actorUserId).toBe(ownerId);
    expect(record.reason).toBe("Rescheduled technician");
    expect(await prisma.auditLog.count({ where: { entityType: "ExceptionSnooze", entityId: key, action: "todo.snoozed" } })).toBe(2);
  });
  it("rejects deactivated actors and reopens only for an active owner", async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { archivedAt: new Date() } });
    await expect(unsnoozeTodo({ key, actorUserId: ownerId })).rejects.toThrow();
    expect(await prisma.exceptionSnooze.count({ where: { key } })).toBe(1);
    await prisma.user.update({ where: { id: ownerId }, data: { archivedAt: null } });
    await unsnoozeTodo({ key, actorUserId: ownerId });
    expect(await prisma.exceptionSnooze.count({ where: { key } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityType: "ExceptionSnooze", entityId: key, action: "todo.unsnoozed" } })).toBe(1);
  });
});
