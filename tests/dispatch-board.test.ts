import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findConflictingJobIds,
  dayKey,
  weekDays,
  ASSUMED_JOB_DURATION_MINUTES,
} from "@/domains/jobs/dispatch";
import {
  defaultChecklistFor,
  parseChecklist,
  checklistProgress,
  DEFAULT_JOB_CHECKLISTS,
} from "@/domains/jobs/checklist";

// Dispatch board (2026-09-28, /desk/dispatch) — pure conflict-detection
// and checklist logic, plus the thin DB wrappers in src/domains/jobs.

describe("findConflictingJobIds", () => {
  it("flags two jobs scheduled at the exact same time", () => {
    const jobs = [
      { id: "a", scheduledAt: new Date("2026-09-28T09:00:00") },
      { id: "b", scheduledAt: new Date("2026-09-28T09:00:00") },
    ];
    expect(findConflictingJobIds(jobs)).toEqual(new Set(["a", "b"]));
  });

  it("flags two jobs within the assumed duration window", () => {
    const jobs = [
      { id: "a", scheduledAt: new Date("2026-09-28T09:00:00") },
      {
        id: "b",
        scheduledAt: new Date(
          new Date("2026-09-28T09:00:00").getTime() +
            (ASSUMED_JOB_DURATION_MINUTES - 10) * 60 * 1000,
        ),
      },
    ];
    expect(findConflictingJobIds(jobs)).toEqual(new Set(["a", "b"]));
  });

  it("doesn't flag jobs spaced further apart than the assumed duration", () => {
    const jobs = [
      { id: "a", scheduledAt: new Date("2026-09-28T09:00:00") },
      { id: "b", scheduledAt: new Date("2026-09-28T13:00:00") },
    ];
    expect(findConflictingJobIds(jobs)).toEqual(new Set());
  });

  it("never flags unscheduled jobs", () => {
    const jobs = [
      { id: "a", scheduledAt: null },
      { id: "b", scheduledAt: null },
    ];
    expect(findConflictingJobIds(jobs)).toEqual(new Set());
  });

  it("flags a chain of three overlapping jobs together, not just adjacent pairs", () => {
    const jobs = [
      { id: "a", scheduledAt: new Date("2026-09-28T09:00:00") },
      { id: "b", scheduledAt: new Date("2026-09-28T09:30:00") },
      { id: "c", scheduledAt: new Date("2026-09-28T10:00:00") },
    ];
    expect(findConflictingJobIds(jobs)).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("dayKey", () => {
  it("formats a date as YYYY-MM-DD in local time", () => {
    expect(dayKey(new Date("2026-09-06T01:00:00Z"))).toBe("2026-09-05");
  });
});

describe("weekDays", () => {
  it("returns 7 consecutive days starting on Sunday", () => {
    // 2026-09-28 is a Monday.
    const days = weekDays(new Date("2026-09-28T18:00:00Z"));
    expect(days).toHaveLength(7);
    expect(days[0].toISOString()).toBe("2026-09-27T06:00:00.000Z");
    expect(dayKey(days[0])).toBe("2026-09-27");
    expect(dayKey(days[6])).toBe("2026-10-03");
  });
});

describe("job checklist defaults", () => {
  it("has a non-empty checklist for every job type", () => {
    for (const items of Object.values(DEFAULT_JOB_CHECKLISTS)) {
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it("defaultChecklistFor starts every item unchecked", () => {
    const checklist = defaultChecklistFor("DELIVERY");
    expect(checklist.every((i) => i.checked === false)).toBe(true);
  });
});

describe("parseChecklist", () => {
  it("falls back to the default checklist when nothing's been saved yet", () => {
    expect(parseChecklist([], "REMOVAL")).toEqual(defaultChecklistFor("REMOVAL"));
    expect(parseChecklist(null, "REMOVAL")).toEqual(defaultChecklistFor("REMOVAL"));
  });

  it("returns the saved checklist when it's valid", () => {
    const saved = [{ item: "Custom step", checked: true }];
    expect(parseChecklist(saved, "DELIVERY")).toEqual(saved);
  });

  it("falls back to the default for a malformed stored value", () => {
    expect(parseChecklist([{ item: "no checked field" }], "SWAP")).toEqual(
      defaultChecklistFor("SWAP"),
    );
  });
});

describe("checklistProgress", () => {
  it("counts checked vs total", () => {
    expect(
      checklistProgress([
        { item: "a", checked: true },
        { item: "b", checked: false },
        { item: "c", checked: true },
      ]),
    ).toEqual({ done: 2, total: 3 });
  });
});

// ---------------------------------------------------------------------------
// DB wrappers (mocked prisma, same pattern as tests/customer-workspace.test.ts)
// ---------------------------------------------------------------------------

const jobFindMany = vi.fn();
const jobFindUniqueOrThrow = vi.fn();
const jobUpdate = vi.fn();
const auditLogCreate = vi.fn();
const assertActiveTeamActor = vi.fn();

vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }),
}));

vi.mock("@/lib/team-actor", () => ({
  assertActiveTeamActor: (...args: unknown[]) => assertActiveTeamActor(...args),
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    job: {
      findMany: (...args: unknown[]) => jobFindMany(...args),
      findUniqueOrThrow: (...args: unknown[]) => jobFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => jobUpdate(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => auditLogCreate(...args),
    },
  };

  return {
    prisma: {
      ...tx,
      $transaction: async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
    },
  };
});

vi.mock("@/domains/inventory/lifecycle", () => ({
  applianceStatusOnJobCompleted: vi.fn(),
}));
vi.mock("@/domains/billing/checkout", () => ({
  startRecurringBillingForAgreement: vi.fn(),
}));

beforeEach(() => {
  jobFindMany.mockReset();
  jobFindUniqueOrThrow.mockReset();
  jobUpdate.mockReset();
  auditLogCreate.mockReset();
  assertActiveTeamActor.mockReset();
});

describe("getDispatchBoardJobs", () => {
  it("queries scheduled (in-range, active-status) jobs and unscheduled active jobs separately", async () => {
    const visit = {
      id: "job-1",
      scheduledAt: new Date("2026-09-28T18:00:00Z"),
    };
    jobFindMany
      .mockResolvedValueOnce([visit])
      .mockResolvedValueOnce([{ id: "job-2" }]);
    const { getDispatchBoardJobs } = await import("@/domains/jobs");

    const start = new Date("2026-09-28T00:00:00");
    const end = new Date("2026-09-29T00:00:00");
    const result = await getDispatchBoardJobs(start, end);

    expect(result).toEqual({
      scheduled: [visit],
      unscheduled: [{ id: "job-2" }],
      conflictCandidates: [visit],
    });

    const [scheduledArgs] = jobFindMany.mock.calls[0];
    expect(scheduledArgs.where).toEqual({
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      scheduledAt: {
        gte: new Date(start.getTime() - 120 * 60 * 1000),
        lt: new Date(end.getTime() + 120 * 60 * 1000),
      },
    });

    const [unscheduledArgs] = jobFindMany.mock.calls[1];
    expect(unscheduledArgs.where).toEqual({
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      scheduledAt: null,
    });
  });
});

describe("getJobChecklist / updateJobChecklist", () => {
  it("getJobChecklist parses the stored value against the job's type", async () => {
    jobFindUniqueOrThrow.mockResolvedValue({ type: "REMOVAL", checklist: [] });
    const { getJobChecklist } = await import("@/domains/jobs");

    expect(await getJobChecklist("job-1")).toEqual(defaultChecklistFor("REMOVAL"));
  });

  it("updateJobChecklist saves the checklist as given after fencing the active actor", async () => {
    jobFindUniqueOrThrow.mockResolvedValue({ checklist: [] });
    jobUpdate.mockResolvedValue({});
    auditLogCreate.mockResolvedValue({});
    const { updateJobChecklist } = await import("@/domains/jobs");
    const checklist = [{ item: "Custom", checked: true }];

    await updateJobChecklist("staff-1", "job-1", checklist);

    expect(assertActiveTeamActor).toHaveBeenCalledWith(
      expect.any(Object),
      "staff-1",
    );
    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { checklist },
    });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        userId: "staff-1",
        action: "job.checklist.update",
        entityType: "Job",
        entityId: "job-1",
        oldValue: { checklist: [] },
        newValue: { checklist },
      },
    });
  });
});
