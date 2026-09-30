import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ role: vi.fn(), count: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog: { count: mocks.count, findMany: mocks.find } } }));
import { getActivityCount, getActivityPage, getActivitySummary } from "@/domains/activity";

beforeEach(() => {
  vi.resetAllMocks(); mocks.role.mockResolvedValue({ user: { role: "STAFF" } });
  mocks.count.mockResolvedValue(0); mocks.find.mockResolvedValue([]);
});

it("filters staff entries, totals and summaries by the same operational allowlist", async () => {
  const since = new Date(0);
  await getActivityCount(since); await getActivityPage(0, 25, since); await getActivitySummary(since);
  const where = mocks.count.mock.calls[0][0].where;
  expect(where.createdAt).toEqual({ gte: since });
  expect(where.action.in).toContain("job.status");
  expect(where.action.in.some((x: string) => /^(billing|settings|pricing|estimate)\./.test(x))).toBe(false);
  expect(where.action.in).not.toContain("job.repairCosts");
  for (const [query] of mocks.find.mock.calls) expect(query.where).toEqual(where);
  expect(mocks.find.mock.calls[0][0].select).not.toHaveProperty("metadata");
  expect(mocks.find.mock.calls[0][0].select).not.toHaveProperty("data");
});

it.each(["OWNER", "ADMIN"])("preserves full activity for %s without arbitrary metadata in the page DTO", async role => {
  mocks.role.mockResolvedValue({ user: { role } });
  await getActivityPage(0, 25);
  expect(mocks.find.mock.calls[0][0].where).toEqual({});
  expect(Object.keys(mocks.find.mock.calls[0][0].select).sort()).toEqual([
    "action", "createdAt", "entityId", "entityType", "id", "user",
  ]);
});

it("does not expose counts to unauthorized callers", async () => {
  mocks.role.mockRejectedValue(new Error("unauthorized"));
  await expect(getActivityCount()).rejects.toThrow("unauthorized");
  expect(mocks.count).not.toHaveBeenCalled();
});
