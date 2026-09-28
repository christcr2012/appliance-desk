import { describe, it, expect, vi, beforeEach } from "vitest";

// Real gap fixed 2026-09-27 (found by a code review, see
// docs/DECISIONS.md): updateJobStatus used to read a job's status, check
// the transition was allowed, then write unconditionally — two
// overlapping requests for the same job could both pass the check and
// the second write would silently clobber the first with no warning.
// This proves the fix's actual guard: the write itself must be an atomic
// conditional updateMany requiring the status to still match what was
// just read, and a count of anything other than 1 must abort rather than
// silently proceeding — the same pattern already proven for appliance
// reservations in tests/agreements-reservation.test.ts.

const jobFindUniqueOrThrow = vi.fn();
const jobUpdateMany = vi.fn();
const auditLogCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    job: {
      findUniqueOrThrow: (...args: unknown[]) => jobFindUniqueOrThrow(...args),
      updateMany: (...args: unknown[]) => jobUpdateMany(...args),
    },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
  },
}));

describe("updateJobStatus — atomic conditional update", () => {
  beforeEach(() => {
    jobFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "job-1",
      status: "SCHEDULED",
      completedAt: null,
      completionNotes: null,
    });
    jobUpdateMany.mockReset();
    auditLogCreate.mockReset().mockResolvedValue({});
  });

  it("writes via a conditional updateMany requiring the status just read, not a plain update", async () => {
    jobUpdateMany.mockResolvedValue({ count: 1 });
    const { updateJobStatus } = await import("@/domains/jobs");

    await updateJobStatus("user-1", "job-1", "IN_PROGRESS");

    expect(jobUpdateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "SCHEDULED" },
      data: expect.objectContaining({ status: "IN_PROGRESS" }),
    });
    expect(auditLogCreate).toHaveBeenCalled();
  });

  it("aborts — and never logs the change — when the conditional update loses the race (count 0)", async () => {
    jobUpdateMany.mockResolvedValue({ count: 0 });
    const { updateJobStatus } = await import("@/domains/jobs");

    await expect(updateJobStatus("user-1", "job-1", "IN_PROGRESS")).rejects.toThrow(
      /changed by someone else/,
    );
    expect(auditLogCreate).not.toHaveBeenCalled();
  });
});
