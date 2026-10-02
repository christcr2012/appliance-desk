import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { updateJobStatus } from "@/domains/jobs";

const target = new URL(
  process.env.DATABASE_URL ?? "postgresql://localhost/unset",
);
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("staff offboarding transaction fence", () => {
  const tag = randomUUID();
  let staffId: string;
  let jobId: string;

  beforeAll(async () => {
    staffId = (
      await prisma.user.create({
        data: {
          email: `staff-fence-${tag}@example.test`,
          name: "Staff Fence Test",
          role: "STAFF",
          emailVerified: true,
        },
      })
    ).id;
    jobId = (
      await prisma.job.create({ data: { type: "DELIVERY", status: "SCHEDULED" } })
    ).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: jobId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.session.deleteMany({ where: { userId: staffId } });
    await prisma.account.deleteMany({ where: { userId: staffId } });
    await prisma.user.deleteMany({ where: { id: staffId } });
  });

  it("rejects a business write that was already in flight when offboarding commits first", async () => {
    let markArchiveLocked!: () => void;
    const archiveLocked = new Promise<void>((resolve) => {
      markArchiveLocked = resolve;
    });
    let releaseArchive!: () => void;
    const archiveRelease = new Promise<void>((resolve) => {
      releaseArchive = resolve;
    });

    const offboarding = prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: staffId },
        data: { archivedAt: new Date() },
      });
      // Signal only after PostgreSQL has taken the row's write lock. The
      // mutation starts while this transaction is still open and therefore
      // blocks at assertActiveTeamActor's FOR SHARE until we commit.
      markArchiveLocked();
      await archiveRelease;
    });

    await archiveLocked;
    const mutation = updateJobStatus(staffId, jobId, "IN_PROGRESS");

    // Give the second transaction an event-loop turn to reach the row lock;
    // correctness does not depend on this delay — if it arrives later it still
    // sees archivedAt after the offboarding transaction commits.
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseArchive();
    await offboarding;

    await expect(mutation).rejects.toThrow(/no longer has access/i);

    const stored = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(stored.status).toBe("SCHEDULED");
    expect(
      await prisma.auditLog.count({
        where: { entityId: jobId, action: "job.status" },
      }),
    ).toBe(0);
  });
});
