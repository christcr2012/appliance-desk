import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
import { prisma } from "@/lib/prisma";
import {
  createTask,
  updateTask,
  completeTask,
  reopenTask,
} from "@/domains/tasks";
const target = new URL(
  process.env.DATABASE_URL ?? "postgresql://localhost/unset",
);
const enabled =
  process.env.CI === "true" &&
  !process.env.VERCEL &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";
describe.skipIf(!enabled)(
  "task assignment with real disposable Postgres",
  () => {
    const tag = randomUUID();
    const owner = `task-owner-${tag}`;
    const staff = `task-staff-${tag}`;
    const tasks: string[] = [];
    beforeAll(async () => {
      await prisma.user.createMany({
        data: [
          { id: owner, email: `${owner}@example.test`, role: "OWNER" },
          { id: staff, email: `${staff}@example.test`, role: "STAFF" },
        ],
      });
      m.role.mockResolvedValue({ user: { id: owner, role: "OWNER" } });
    });
    afterAll(async () => {
      await prisma.auditLog.deleteMany({ where: { userId: owner } });
      await prisma.staffTask.deleteMany({ where: { id: { in: tasks } } });
      await prisma.user.deleteMany({ where: { id: { in: [owner, staff] } } });
    });
    async function task() {
      const created = await createTask({
        note: "Synthetic follow-up",
        assigneeUserId: staff,
        priority: "HIGH",
        dueDate: "2026-11-02",
      });
      tasks.push(created.id);
      return created;
    }
    it("allows exactly one concurrent edit and audits only its committed version", async () => {
      const initial = await task();
      const result = await Promise.allSettled([
        updateTask(initial.id, 1, { note: "Writer A", assigneeUserId: staff }),
        updateTask(initial.id, 1, { note: "Writer B", assigneeUserId: staff }),
      ]);
      expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(result.filter((r) => r.status === "rejected")).toHaveLength(1);
      const saved = await prisma.staffTask.findUniqueOrThrow({
        where: { id: initial.id },
      });
      expect(saved.version).toBe(2);
      expect(["Writer A", "Writer B"]).toContain(saved.note);
      expect(
        await prisma.auditLog.count({
          where: { entityId: saved.id, action: "task.update" },
        }),
      ).toBe(1);
    });
    it("repeats completion safely and reopens only a matching version", async () => {
      const initial = await task();
      const results = await Promise.allSettled([
        completeTask(initial.id, 1),
        completeTask(initial.id, 1),
      ]);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
      await completeTask(initial.id, 1);
      expect(
        await prisma.auditLog.count({
          where: { entityId: initial.id, action: "task.complete" },
        }),
      ).toBe(1);
      await expect(reopenTask(initial.id, 1)).rejects.toThrow(
        "Someone changed",
      );
      await reopenTask(initial.id, 2);
      expect(
        await prisma.staffTask.findUnique({ where: { id: initial.id } }),
      ).toMatchObject({ completedAt: null, version: 3 });
    });
    it("rejects deactivated assignee and actor without creating tasks or audits", async () => {
      await prisma.user.update({
        where: { id: staff },
        data: { archivedAt: new Date() },
      });
      const before = await prisma.staffTask.count({
        where: { createdByUserId: owner },
      });
      await expect(
        createTask({ note: "Refuse inactive", assigneeUserId: staff }),
      ).rejects.toThrow("active team member");
      expect(
        await prisma.staffTask.count({ where: { createdByUserId: owner } }),
      ).toBe(before);
      m.role.mockResolvedValue({ user: { id: staff, role: "STAFF" } });
      await expect(
        createTask({ note: "Refuse stale session" }),
      ).rejects.toThrow("active team member");
      expect(await prisma.auditLog.count({ where: { userId: staff } })).toBe(0);
    });
  },
);
