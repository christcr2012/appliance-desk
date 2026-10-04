import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const m = vi.hoisted(() => ({ jobs: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { job: { findMany: m.jobs }, businessSettings: { findUnique: async () => ({ defaultJobDurationMinutes: 120 }) } },
}));
vi.mock("@/lib/session", () => ({
  requireRole: async () => ({ user: { role: "OWNER" } }),
}));
import {
  dayKey,
  dispatchAnchor,
  weekDays,
  findConflictingJobIds,
} from "@/domains/jobs/dispatch";
import { addBusinessDays } from "@/lib/business-date";
import { getDispatchBoardJobs, getDriverJobsForToday } from "@/domains/jobs";
import DispatchPage from "@/app/desk/dispatch/page";
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());
it("anchors Colorado evenings and validates selected calendar dates without rollover", () => {
  const evening = new Date("2026-10-02T01:00:00Z");
  expect(dayKey(evening)).toBe("2026-10-01");
  for (const value of [undefined, "2026-02-30", "bad"])
    expect(dispatchAnchor(value, evening).toISOString()).toBe(
      "2026-10-01T06:00:00.000Z",
    );
  expect(dispatchAnchor("2026-12-31", evening).toISOString()).toBe(
    "2026-12-31T07:00:00.000Z",
  );
  expect(dayKey(addBusinessDays(dispatchAnchor("2026-12-31"), 1))).toBe(
    "2027-01-01",
  );
});
it.each([
  ["2026-03-08", 23],
  ["2026-11-01", 25],
])("resolves independent DST midnights for %s", (key, hours) => {
  const start = dispatchAnchor(key as string);
  const end = addBusinessDays(start, 1);
  expect((end.getTime() - start.getTime()) / 3_600_000).toBe(hours);
  const days = weekDays(start);
  expect(days).toHaveLength(7);
  expect(dayKey(days[0])).toBe(key);
  expect(new Set(days.map(dayKey)).size).toBe(7);
});
it("queries the driver's current Colorado day including its DST boundary", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T01:00:00Z"));
  m.jobs.mockResolvedValue([]);
  await getDriverJobsForToday();
  expect(m.jobs.mock.calls[0][0].where.scheduledAt).toEqual({
    gte: new Date("2026-11-01T06:00:00Z"),
    lt: new Date("2026-11-02T07:00:00Z"),
  });
});
it("flags adjacent-day conflicts while returning only visible-day jobs", async () => {
  const start = dispatchAnchor("2026-10-01");
  const end = addBusinessDays(start, 1);
  const before = {
    id: "before",
    scheduledAt: new Date("2026-10-01T05:30:00Z"),
  };
  const visible = {
    id: "visible",
    scheduledAt: new Date("2026-10-01T06:30:00Z"),
  };
  const exactEnd = { id: "end", scheduledAt: end };
  m.jobs
    .mockResolvedValueOnce([before, visible, exactEnd])
    .mockResolvedValueOnce([]);
  const result = await getDispatchBoardJobs(start, end);
  expect(result.scheduled).toEqual([visible]);
  expect(findConflictingJobIds(result.conflictCandidates)).toEqual(
    new Set(["before", "visible"]),
  );
  expect(m.jobs.mock.calls[0][0].where.scheduledAt).toEqual({
    gte: new Date("2026-09-30T18:00:00Z"),
    lt: new Date("2026-10-02T18:00:00Z"),
  });
});
it("renders Colorado day/time and a boundary conflict without leaking adjacent jobs", async () => {
  const fixture = {
    type: "DELIVERY",
    checklist: [],
    customer: null,
    serviceAddress: null,
  };
  m.jobs
    .mockResolvedValueOnce([
      {
        ...fixture,
        id: "before",
        scheduledAt: new Date("2026-10-01T05:30:00Z"),
      },
      {
        ...fixture,
        id: "visible",
        scheduledAt: new Date("2026-10-01T06:30:00Z"),
        assignedTo: { id: "u1", name: "Sam Driver", email: "sam@example.test" },
        durationMinutes: 45,
      },
    ])
    .mockResolvedValueOnce([]);
  const html = renderToStaticMarkup(
    await DispatchPage({
      searchParams: Promise.resolve({ date: "2026-10-01", view: "day" }),
    }),
  );
  expect(html).toContain("Thursday, October 1");
  expect(html).toContain("12:30 AM MDT");
  expect(html).toContain("Double-booked around this time");
  expect(html).toContain("Assigned to Sam Driver");
  expect(html).toContain("45 minutes");
  expect(html).toContain("for Sam Driver");
  expect(html).toContain("/desk/jobs/visible");
  expect(html).not.toContain("/desk/jobs/before");
});
