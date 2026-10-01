import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }),
}));
import { prisma } from "@/lib/prisma";
import { getDispatchBoardJobs, getDriverJobsForToday } from "@/domains/jobs";
import { dispatchAnchor, findConflictingJobIds } from "@/domains/jobs/dispatch";
import { addBusinessDays } from "@/lib/business-date";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";
describe.skipIf(!enabled)(
  "Colorado dispatch queries in disposable CI Postgres",
  () => {
    const tag = randomUUID();
    const ids = [
      "before",
      "early",
      "late",
      "after",
      "unscheduled",
      "cancelled",
    ].map((kind) => `calendar-${tag}-${kind}`);
    afterAll(async () => {
      vi.useRealTimers();
      await prisma.job.deleteMany({ where: { id: { in: ids } } });
    });
    it("detects conflicts across both day boundaries without displaying neighboring or closed jobs", async () => {
      const times = [
        "2026-11-01T05:30:00Z",
        "2026-11-01T06:30:00Z",
        "2026-11-02T06:30:00Z",
        "2026-11-02T07:30:00Z",
        null,
        "2026-11-01T12:00:00Z",
      ];
      await prisma.job.createMany({
        data: ids.map((id, i) => ({
          id,
          type: "MAINTENANCE_VISIT",
          status: i === 5 ? "CANCELLED" : "SCHEDULED",
          scheduledAt: times[i] ? new Date(times[i]!) : null,
        })),
      });
      const start = dispatchAnchor("2026-11-01");
      const result = await getDispatchBoardJobs(
        start,
        addBusinessDays(start, 1),
      );
      expect(
        result.scheduled
          .filter((job) => ids.includes(job.id))
          .map((job) => job.id),
      ).toEqual([ids[1], ids[2]]);
      expect(result.unscheduled.some((job) => job.id === ids[4])).toBe(true);
      const conflicts = findConflictingJobIds(result.conflictCandidates);
      expect(conflicts.has(ids[1])).toBe(true);
      expect(conflicts.has(ids[2])).toBe(true);
      expect(result.conflictCandidates.some((job) => job.id === ids[5])).toBe(
        false,
      );
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-02T01:00:00Z"));
      const driver = await getDriverJobsForToday();
      expect(
        driver.filter((job) => ids.includes(job.id)).map((job) => job.id),
      ).toEqual([ids[1], ids[2]]);
      vi.useRealTimers();
    });
  },
);
