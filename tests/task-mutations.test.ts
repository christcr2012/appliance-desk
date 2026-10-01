import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  role: vi.fn(),
  transaction: vi.fn(),
  lock: vi.fn(),
  user: vi.fn(),
  create: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  audit: vi.fn(),
  lead: vi.fn(),
  customer: vi.fn(),
  job: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
import {
  createTask,
  updateTask,
  completeTask,
  reopenTask,
  deleteTask,
} from "@/domains/tasks";
const original = {
  id: "task",
  note: "Call",
  dueDate: null,
  priority: "NORMAL",
  assigneeUserId: null,
  version: 2,
  completedAt: null,
  customerId: "customer",
  leadId: null,
  jobId: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue({ user: { id: "actor", role: "STAFF" } });
  m.user.mockResolvedValue({ id: "actor", role: "STAFF" });
  m.find.mockResolvedValue(original);
  m.create.mockResolvedValue({ ...original, version: 1 });
  m.update.mockResolvedValue({ count: 1 });
  m.remove.mockResolvedValue({ count: 1 });
  m.transaction.mockImplementation((fn) =>
    fn({
      $queryRaw: m.lock,
      user: { findFirst: m.user },
      staffTask: {
        create: m.create,
        findUnique: m.find,
        updateMany: m.update,
        deleteMany: m.remove,
      },
      auditLog: { create: m.audit },
      lead: { findUnique: m.lead },
      customer: { findFirst: m.customer },
      job: { findFirst: m.job },
    }),
  );
});
it("denies unknown sessions before any transaction", async () => {
  m.role.mockRejectedValue(new Error("denied"));
  await expect(createTask({ note: "Call" })).rejects.toThrow("denied");
  expect(m.transaction).not.toHaveBeenCalled();
});
it.each(["2026-02-30", "2026-13-01", "tomorrow", "2026-09-30T00:00:00Z"])(
  "rejects invalid due date %s at the domain boundary",
  async (dueDate) => {
    await expect(createTask({ note: "Call", dueDate })).rejects.toThrow();
    expect(m.transaction).not.toHaveBeenCalled();
  },
);
it("creates date-only deadlines, default priority/unassigned and one atomic audit", async () => {
  await createTask({ note: " Call ", dueDate: "2026-09-30" });
  expect(m.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      note: "Call",
      dueDate: new Date("2026-09-30"),
      priority: "NORMAL",
      assigneeUserId: null,
      createdByUserId: "actor",
    }),
  });
  expect(m.lock).toHaveBeenCalledOnce();
  expect(m.audit).toHaveBeenCalledWith({
    data: expect.objectContaining({
      action: "task.create",
      userId: "actor",
      entityId: "task",
    }),
  });
});
it("rejects deactivated actor even with a formerly valid session", async () => {
  m.user.mockResolvedValue(null);
  await expect(createTask({ note: "Call" })).rejects.toThrow(
    "active team member",
  );
  expect(m.create).not.toHaveBeenCalled();
});
it("rejects missing/customer/deactivated assignee and requires active staff roles", async () => {
  m.user
    .mockResolvedValueOnce({ id: "actor", role: "STAFF" })
    .mockResolvedValueOnce(null);
  await expect(
    createTask({ note: "Call", assigneeUserId: "inactive" }),
  ).rejects.toThrow("active team member");
  expect(m.user).toHaveBeenLastCalledWith(
    expect.objectContaining({
      where: {
        id: "inactive",
        archivedAt: null,
        role: { in: ["OWNER", "ADMIN", "STAFF"] },
      },
    }),
  );
  expect(m.create).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
});
it("denies staff lead links before reading the hidden lead", async () => {
  await expect(createTask({ note: "Call", leadId: "hidden" })).rejects.toThrow(
    "unavailable",
  );
  expect(m.lead).not.toHaveBeenCalled();
  expect(m.create).not.toHaveBeenCalled();
});
it.each(["customerId", "jobId"])("rejects unavailable %s", async (field) => {
  await expect(
    createTask({ note: "Call", [field]: "missing" }),
  ).rejects.toThrow("unavailable");
  expect(m.create).not.toHaveBeenCalled();
});
it("keeps original record links on edits and increments a checked version", async () => {
  await updateTask("task", 2, {
    note: "New text",
    priority: "HIGH",
    customerId: "other",
  });
  expect(m.update).toHaveBeenCalledWith({
    where: { id: "task", version: 2 },
    data: {
      note: "New text",
      dueDate: null,
      priority: "HIGH",
      assigneeUserId: null,
      version: { increment: 1 },
    },
  });
  expect(m.audit).toHaveBeenCalledWith({
    data: expect.objectContaining({
      action: "task.update",
      oldValue: expect.objectContaining({ version: 2 }),
      newValue: expect.objectContaining({ version: 3, note: "New text" }),
    }),
  });
});
it.each([1, 0, NaN, 2.5])(
  "rejects stale/invalid version %s without overwrites",
  async (version) => {
    await expect(
      updateTask("task", version, { note: "Stale text" }),
    ).rejects.toThrow();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  },
);
it("detects a competing writer between read and write", async () => {
  m.update.mockResolvedValue({ count: 0 });
  await expect(updateTask("task", 2, { note: "Stale" })).rejects.toThrow(
    "Someone changed",
  );
  expect(m.audit).not.toHaveBeenCalled();
});
it("completes once and safely accepts repeated completion without extra audit", async () => {
  await completeTask("task", 2);
  expect(m.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: { completedAt: expect.any(Date), version: { increment: 1 } },
    }),
  );
  m.find.mockResolvedValue({
    ...original,
    completedAt: new Date(),
    version: 3,
  });
  await completeTask("task", 2);
  expect(m.update).toHaveBeenCalledOnce();
  expect(m.audit).toHaveBeenCalledOnce();
});
it("reopens with a checked version and audits the state change", async () => {
  m.find.mockResolvedValue({ ...original, completedAt: new Date() });
  await reopenTask("task", 2);
  expect(m.update).toHaveBeenCalledWith({
    where: { id: "task", version: 2 },
    data: { completedAt: null, version: { increment: 1 } },
  });
});
it("does not delete a task edited concurrently", async () => {
  m.remove.mockResolvedValue({ count: 0 });
  await expect(deleteTask("task", 2)).rejects.toThrow("Someone changed");
  expect(m.audit).not.toHaveBeenCalled();
});
