import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

// The actor is set per test through the mocked session (the bills-list pattern).
const { actor } = vi.hoisted(() => ({
  actor: { current: { id: "", role: "OWNER" as string } },
}));
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async () => ({ user: { id: actor.current.id, role: actor.current.role } })),
}));

import { prisma } from "@/lib/prisma";
import { getDispatchBoardJobs } from "@/domains/jobs";

// Disposable CI Postgres only (same gate as the other integration tests).
const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const enabled =
  process.env.CI === "true" &&
  url !== null &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const RANGE_START = new Date("2026-01-01T00:00:00Z");
const RANGE_END = new Date("2027-01-01T00:00:00Z");
const IN_RANGE = new Date("2026-10-30T15:00:00Z");

describe.skipIf(!enabled)("dispatch board who filter (AR-5 section 3)", () => {
  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const jobIds: string[] = [];
  let ownerId = "";
  let staffId = "";
  let customerId = "";
  let staffJobId = "";
  let unassignedJobId = "";

  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: { email: `ar5b-owner-${tag}@example.test`, name: `AR5B Owner ${tag}`, role: "OWNER" },
    });
    const staff = await prisma.user.create({
      data: { email: `ar5b-staff-${tag}@example.test`, name: `AR5B Staff ${tag}`, role: "STAFF" },
    });
    userIds.push(owner.id, staff.id);
    ownerId = owner.id;
    staffId = staff.id;
    actor.current = { id: ownerId, role: "OWNER" };

    const customerUser = await prisma.user.create({
      data: { email: `ar5b-customer-${tag}@example.test`, name: `AR5B Customer ${tag}`, role: "CUSTOMER" },
    });
    userIds.push(customerUser.id);
    const customer = await prisma.customer.create({
      data: { userId: customerUser.id, referralCode: `AR5B-${tag}` },
    });
    customerId = customer.id;

    const staffJob = await prisma.job.create({
      data: { type: "DELIVERY", status: "SCHEDULED", scheduledAt: IN_RANGE, assignedToUserId: staffId, customerId: customer.id },
    });
    const unassignedJob = await prisma.job.create({
      data: { type: "REMOVAL", status: "SCHEDULED", scheduledAt: IN_RANGE, customerId: customer.id },
    });
    const ownerJob = await prisma.job.create({
      data: { type: "DELIVERY", status: "SCHEDULED", scheduledAt: IN_RANGE, assignedToUserId: ownerId, customerId: customer.id },
    });
    staffJobId = staffJob.id;
    unassignedJobId = unassignedJob.id;
    jobIds.push(staffJob.id, unassignedJob.id, ownerJob.id);

    // 55 waiting visits of our own — enough to prove the 51-row cap on their own.
    const waiting = await prisma.job.createMany({
      data: Array.from({ length: 55 }, () => ({
        type: "DELIVERY" as const,
        status: "SCHEDULED" as const,
        scheduledAt: null,
        customerId: customer.id,
      })),
    });
    expect(waiting.count).toBe(55);
    const waitingRows = await prisma.job.findMany({
      where: { customerId: customer.id, scheduledAt: null },
      select: { id: true },
    });
    jobIds.push(...waitingRows.map((row) => row.id));
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("caps the waiting list at 51 rows (50 shown + the more-waiting signal)", async () => {
    const board = await getDispatchBoardJobs(RANGE_START, RANGE_END);
    expect(board.unscheduled.length).toBe(51);
  });

  it("who= a member narrows both board queries to that person", async () => {
    const board = await getDispatchBoardJobs(RANGE_START, RANGE_END, staffId);
    expect(board.scheduled.map((job) => job.id)).toContain(staffJobId);
    expect(board.scheduled.every((job) => job.assignedToUserId === staffId)).toBe(true);
    expect(board.unscheduled.every((job) => job.assignedToUserId === staffId)).toBe(true);
  });

  it("who=unassigned shows only visits with nobody assigned", async () => {
    const board = await getDispatchBoardJobs(RANGE_START, RANGE_END, "unassigned");
    expect(board.scheduled.map((job) => job.id)).toContain(unassignedJobId);
    expect(board.scheduled.every((job) => job.assignedToUserId === null)).toBe(true);
    expect(board.unscheduled.length).toBe(51);
    expect(board.unscheduled.every((job) => job.assignedToUserId === null)).toBe(true);
  });

  it("who=mine means the signed-in owner", async () => {
    const board = await getDispatchBoardJobs(RANGE_START, RANGE_END, "mine");
    expect(board.scheduled.length).toBeGreaterThan(0);
    expect(board.scheduled.every((job) => job.assignedToUserId === ownerId)).toBe(true);
  });

  it("ignores the who filter for STAFF — the board stays the shared calendar", async () => {
    actor.current = { id: staffId, role: "STAFF" };
    try {
      const board = await getDispatchBoardJobs(RANGE_START, RANGE_END, "mine");
      expect(board.scheduled.map((job) => job.id)).toContain(unassignedJobId);
    } finally {
      actor.current = { id: ownerId, role: "OWNER" };
    }
  });
});
