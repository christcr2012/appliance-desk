import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  role: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/prisma", () => ({
  prisma: { staffTask: { count: m.count, findMany: m.findMany } },
}));
import {
  getTaskWorkspace,
  getDueTaskSummary,
  parseTaskFilter,
  taskFilterWhere,
} from "@/domains/tasks/workspace";
beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue({ user: { id: "staff", role: "STAFF" } });
  m.count.mockResolvedValue(62);
  m.findMany.mockResolvedValue([]);
});
const now = new Date("2026-10-01T05:00:00Z");
it("clamps pagination, limits records, and retains a stable tie-breaker", async () => {
  const result = await getTaskWorkspace("all", 900, now);
  expect(result).toMatchObject({ page: 3, totalCount: 62, totalPages: 3 });
  expect(m.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      take: 25,
      skip: 50,
      where: { completedAt: null },
      orderBy: [
        { priority: "desc" },
        { dueDate: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
        { id: "asc" },
      ],
    }),
  );
  expect(m.findMany.mock.calls[0][0].select).not.toHaveProperty("createdBy");
});
it.each([NaN, Infinity, -9, 0, 2.5])(
  "handles invalid page %s",
  async (page) => {
    expect((await getTaskWorkspace("all", page)).page).toBe(1);
  },
);
it("filters by stored date-only deadline against Colorado today", () => {
  expect(taskFilterWhere("today", now)).toEqual({
    completedAt: null,
    dueDate: { gte: new Date("2026-09-30"), lt: new Date("2026-10-01") },
  });
  expect(taskFilterWhere("overdue", now)).toEqual({
    completedAt: null,
    dueDate: { lt: new Date("2026-09-30") },
  });
  expect(taskFilterWhere("upcoming", now)).toEqual({
    completedAt: null,
    dueDate: { gte: new Date("2026-10-01") },
  });
  expect(taskFilterWhere("undated", now)).toEqual({
    completedAt: null,
    dueDate: null,
  });
  expect(parseTaskFilter("invalid")).toBe("all");
});
it("bounds Today records but counts all due and overdue tasks independently", async () => {
  m.count.mockResolvedValueOnce(30).mockResolvedValueOnce(22);
  const result = await getDueTaskSummary(now);
  expect(result).toMatchObject({ totalCount: 30, overdueCount: 22 });
  expect(m.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      take: 6,
      where: { completedAt: null, dueDate: { lt: new Date("2026-10-01") } },
    }),
  );
});
it.each([() => getTaskWorkspace("all", 1), () => getDueTaskSummary()])(
  "denies access before task queries",
  async (query) => {
    m.role.mockRejectedValue(new Error("unauthorized"));
    await expect(query()).rejects.toThrow("unauthorized");
    expect(m.count).not.toHaveBeenCalled();
    expect(m.findMany).not.toHaveBeenCalled();
  },
);

it("uses the current identity for Mine and preserves team visibility", async () => {
  await getTaskWorkspace("today", 1, now, "mine");
  expect(m.count).toHaveBeenLastCalledWith({
    where: expect.objectContaining({
      assigneeUserId: "staff",
      completedAt: null,
    }),
  });
  await getTaskWorkspace("all", 1, now, "unassigned");
  expect(m.count).toHaveBeenLastCalledWith({
    where: { completedAt: null, assigneeUserId: null },
  });
  await getTaskWorkspace("all", 1, now, "completed");
  expect(m.count).toHaveBeenLastCalledWith({
    where: { completedAt: { not: null } },
  });
  expect(m.findMany.mock.calls[0][0].select.lead).toBe(false);
});
