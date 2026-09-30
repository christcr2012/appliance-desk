import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  lead: { count: vi.fn(), findMany: vi.fn() },
  estimate: { findMany: vi.fn() },
}));
const guard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/session", () => ({ requireRole: guard }));
import {
  leadFilters,
  leadWorkspaceWhere,
  getLeadWorkspace,
  getLeadEstimates,
} from "@/domains/leads/workspace";
beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({ user: { role: "OWNER" } });
  db.lead.count.mockResolvedValue(101);
  db.lead.findMany.mockResolvedValue([]);
});
it("normalizes input and bounds the search", () => {
  expect(
    leadFilters({
      status: "INVALID",
      view: "bad",
      q: "x".repeat(200),
      page: "-2",
    }),
  ).toMatchObject({
    status: undefined,
    view: "all",
    page: 1,
    q: "x".repeat(100),
  });
});
it("derives awaiting reply from real estimate states", () => {
  expect(leadWorkspaceWhere(leadFilters({ view: "awaiting-reply" }))).toEqual({
    estimates: { some: { status: { in: ["SENT", "VIEWED"] } } },
  });
});
it("no-next-task means no open linked task on an active lead", () => {
  expect(leadWorkspaceWhere(leadFilters({ view: "no-next-task" }))).toEqual({
    tasks: { none: { completedAt: null } },
    status: { in: ["NEW", "CONTACTED"] },
  });
  expect(
    leadWorkspaceWhere(leadFilters({ status: "LOST", view: "no-next-task" }))
      .status,
  ).toBe("LOST");
});
it("count and page share filters; rows and related previews are bounded", async () => {
  const data = await getLeadWorkspace({
    status: "CONTACTED",
    q: " Jane ",
    view: "awaiting-reply",
    page: "99",
  });
  const count = db.lead.count.mock.calls[0][0],
    query = db.lead.findMany.mock.calls[0][0];
  expect(query.where).toEqual(count.where);
  expect(query).toMatchObject({ take: 25, skip: 100 });
  expect(query.orderBy.at(-1)).toEqual({ id: "desc" });
  expect(query.select.notes).toBeUndefined();
  expect(query.select.notesLog).toMatchObject({
    take: 1,
    select: { createdAt: true },
  });
  expect(query.select.tasks.take).toBe(1);
  expect(query.select.estimates.take).toBe(1);
  expect(data.filter.q).toBe("Jane");
});
it("requires owner/admin before querying", async () => {
  guard.mockRejectedValue(new Error("denied"));
  await expect(getLeadWorkspace({})).rejects.toThrow("denied");
  await expect(getLeadEstimates("l1")).rejects.toThrow("denied");
  expect(db.lead.count).not.toHaveBeenCalled();
  expect(db.estimate.findMany).not.toHaveBeenCalled();
});
