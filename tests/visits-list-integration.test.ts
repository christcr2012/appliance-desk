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
import { getVisitCounts, getVisits } from "@/domains/jobs/visits-list";
import type { VisitListParams } from "@/domains/jobs/visits-list";

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

const NOW = new Date("2026-10-30T16:00:00Z"); // Friday 10:00 AM Denver
const HOUR = 3_600_000;

describe.skipIf(!enabled)("visits list (AR-5 section 4)", () => {
  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const customerIds: string[] = [];
  const jobIds: string[] = [];
  let ownerId = "";
  let staffId = "";
  let customerId = "";
  let assetNumber = "";
  const sameTimeJobIds: string[] = [];

  async function makeUser(role: "OWNER" | "STAFF", label: string) {
    const user = await prisma.user.create({
      data: { email: `ar5-${label}-${tag}@example.test`, name: `AR5 ${label}`, role },
    });
    userIds.push(user.id);
    return user.id;
  }

  async function makeJob(data: {
    status?: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
    type?: "DELIVERY" | "REMOVAL" | "MAINTENANCE_VISIT";
    scheduledAt?: Date | null;
    completedAt?: Date | null;
    assignedToUserId?: string | null;
    withAppliance?: boolean;
  }) {
    const job = await prisma.job.create({
      data: {
        type: data.type ?? "DELIVERY",
        status: data.status ?? "SCHEDULED",
        scheduledAt: data.scheduledAt ?? null,
        completedAt: data.completedAt ?? null,
        assignedToUserId: data.assignedToUserId ?? null,
        customerId,
      },
    });
    jobIds.push(job.id);
    if (data.withAppliance) {
      const type = await prisma.applianceType.create({
        data: { name: `AR5 Washer ${tag}`, slug: `ar5-washer-${tag}` },
      });
      assetNumber = `AR5-${tag}-001`;
      const appliance = await prisma.appliance.create({
        data: { assetNumber, applianceTypeId: type.id },
      });
      await prisma.jobAppliance.create({ data: { jobId: job.id, applianceId: appliance.id } });
    }
    return job.id;
  }

  // The shared lane database is seeded and other suites add jobs too, so every read is narrowed
  // to this suite's own customer by name (the bills-list rule: never assume an empty table).
  const base: VisitListParams = { tab: "upcoming", sort: "soonest", q: "" };

  beforeAll(async () => {
    ownerId = await makeUser("OWNER", "owner");
    staffId = await makeUser("STAFF", "staff");
    actor.current = { id: ownerId, role: "OWNER" };

    const customerUser = await prisma.user.create({
      data: { email: `ar5-customer-${tag}@example.test`, name: `AR5 Customer ${tag}`, role: "CUSTOMER" },
    });
    userIds.push(customerUser.id);
    const customer = await prisma.customer.create({
      data: { userId: customerUser.id, referralCode: `AR5-${tag}` },
    });
    customerIds.push(customer.id);
    customerId = customer.id;
    base.q = `AR5 Customer ${tag}`;
    await prisma.serviceAddress.create({
      data: { customerId, line1: `100 AR5 Lane ${tag}`, city: "Greeley", zip: "80631" },
    });

    // Five upcoming visits at the SAME time (cursor tie-break), one of them carrying the appliance.
    const sameTime = new Date(NOW.getTime() + 2 * HOUR);
    for (let i = 0; i < 5; i++) {
      sameTimeJobIds.push(await makeJob({ scheduledAt: sameTime, withAppliance: i === 2 }));
    }
    await makeJob({ scheduledAt: null }); // no-time
    await makeJob({ status: "COMPLETED", completedAt: new Date(NOW.getTime() - 2 * HOUR) });
    await makeJob({ status: "COMPLETED", completedAt: new Date(NOW.getTime() - 1 * HOUR) });
    await makeJob({ status: "CANCELLED", scheduledAt: sameTime });
    await makeJob({ scheduledAt: new Date(NOW.getTime() + 3 * HOUR), assignedToUserId: staffId });
    await makeJob({ scheduledAt: new Date(NOW.getTime() + 4 * HOUR), assignedToUserId: ownerId });
  });

  afterAll(async () => {
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.appliance.deleteMany({ where: { assetNumber } });
    await prisma.applianceType.deleteMany({ where: { slug: `ar5-washer-${tag}` } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.serviceAddress.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("partitions visits into the four tabs", async () => {
    const counts = await getVisitCounts(base, NOW);
    expect(counts).toEqual({ upcoming: 7, "no-time": 1, done: 2, cancelled: 1 });
    const noTime = await getVisits({ ...base, tab: "no-time" }, NOW);
    expect(noTime.rows).toHaveLength(1);
    expect(noTime.rows[0]!.scheduledAt).toBeNull();
  });

  it("walks identical timestamps through the cursor exactly once, in id order", async () => {
    // KIT 5.1: each call returns the whole window grown from the start (2, 4, 6, then all 7),
    // so the walk replaces the window each time instead of appending pages.
    const sizes: number[] = [];
    let seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 6; page++) {
      const result = await getVisits({ ...base, pageSize: 2, cursor }, NOW);
      seen = result.rows.map((row) => row.id);
      sizes.push(seen.length);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(sizes).toEqual([2, 4, 6, 7]);
    expect(new Set(seen).size).toBe(7);
    expect(seen.slice(0, 5)).toEqual([...sameTimeJobIds].sort());
  });

  it("shows Done newest first", async () => {
    const done = await getVisits({ ...base, tab: "done", sort: "latest" }, NOW);
    expect(done.rows.map((row) => row.completedAt?.getTime())).toEqual([
      NOW.getTime() - 1 * HOUR,
      NOW.getTime() - 2 * HOUR,
    ]);
  });

  it("finds a visit by appliance number, exactly", async () => {
    const found = await getVisits({ ...base, q: assetNumber }, NOW);
    expect(found.rows).toHaveLength(1);
    const partial = await getVisits({ ...base, q: assetNumber.slice(0, -1) }, NOW);
    expect(partial.rows).toHaveLength(0);
  });

  it("applies the who filter for OWNER/ADMIN and ignores it for STAFF", async () => {
    const mine = await getVisits({ ...base, who: "mine" }, NOW);
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0]!.assignedToUserId).toBe(ownerId);

    const unassigned = await getVisits({ ...base, who: "unassigned" }, NOW);
    expect(unassigned.rows).toHaveLength(5);

    actor.current = { id: staffId, role: "STAFF" };
    try {
      const staffView = await getVisits({ ...base, who: "mine" }, NOW);
      expect(staffView.rows).toHaveLength(7); // the filter is ignored: the shared list
    } finally {
      actor.current = { id: ownerId, role: "OWNER" };
    }
  });
});
