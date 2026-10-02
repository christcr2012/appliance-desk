import { describe, it, expect, vi, beforeEach } from "vitest";

// This focused unit suite proves the job-status compare-and-set behavior.
// The separate real-Postgres staff-offboarding integration test proves the
// team-actor row-lock fence; mocking it here keeps these assertions about the
// job's own state race rather than coupling two concurrency mechanisms.

const jobFindUniqueOrThrow = vi.fn();
const jobUpdateMany = vi.fn();
const auditLogCreate = vi.fn();
const assertActiveTeamActor = vi.fn();

vi.mock("@/lib/team-actor", () => ({
  assertActiveTeamActor: (...args: unknown[]) => assertActiveTeamActor(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    job: {
      findUniqueOrThrow: (...args: unknown[]) => jobFindUniqueOrThrow(...args),
      updateMany: (...args: unknown[]) => jobUpdateMany(...args),
    },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
    $transaction: (callback: (tx: unknown) => unknown) =>
      callback({
        job: {
          updateMany: (...args: unknown[]) => jobUpdateMany(...args),
          findUniqueOrThrow: (...args: unknown[]) => jobFindUniqueOrThrow(...args),
        },
        auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
      }),
  },
}));

describe("updateJobStatus — atomic conditional update", () => {
  beforeEach(() => {
    assertActiveTeamActor.mockReset().mockResolvedValue({
      id: "user-1",
      role: "STAFF",
      archivedAt: null,
    });
    jobFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "job-1",
      status: "SCHEDULED",
      completedAt: null,
      completionNotes: null,
    });
    jobUpdateMany.mockReset();
    auditLogCreate.mockReset().mockResolvedValue({});
  });

  it("checks the actor inside the transaction and conditionally writes the status just read", async () => {
    jobUpdateMany.mockResolvedValue({ count: 1 });
    const { updateJobStatus } = await import("@/domains/jobs");

    await updateJobStatus("user-1", "job-1", "IN_PROGRESS");

    expect(assertActiveTeamActor).toHaveBeenCalled();
    expect(jobUpdateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "SCHEDULED" },
      data: expect.objectContaining({ status: "IN_PROGRESS" }),
    });
    expect(auditLogCreate).toHaveBeenCalled();
  });

  it("aborts — and never logs the change — when the conditional update loses the race", async () => {
    jobUpdateMany.mockResolvedValue({ count: 0 });
    const { updateJobStatus } = await import("@/domains/jobs");

    await expect(updateJobStatus("user-1", "job-1", "IN_PROGRESS")).rejects.toThrow(
      /changed by someone else/,
    );
    expect(auditLogCreate).not.toHaveBeenCalled();
  });
});
