import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async () => ({ user: { id: "actor", role: "OWNER" } })),
}));

import { prisma } from "@/lib/prisma";
import { getRepairCounts, getRepairRequests } from "@/domains/maintenance/list";
import type { RepairListParams } from "@/domains/maintenance/list";

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

const T0 = new Date("2026-10-01T15:00:00Z");
const DAY = 86_400_000;

describe.skipIf(!enabled)("repairs list (AR-5 section 8)", () => {
  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const requestIds: string[] = [];
  let customerId = "";
  let assetNumber = "";

  const base: RepairListParams = { tab: "open", sort: "newest", q: "" };

  async function makeRequest(data: {
    status?: "SUBMITTED" | "REVIEWING" | "SCHEDULED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
    priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    openedAt: Date;
    problem?: string;
    withAppliance?: boolean;
    withVisit?: boolean;
  }) {
    let applianceId: string | undefined;
    if (data.withAppliance) {
      const type = await prisma.applianceType.create({
        data: { name: `AR5R Dryer ${tag}`, slug: `ar5r-dryer-${tag}` },
      });
      assetNumber = `AR5R-${tag}-001`;
      const appliance = await prisma.appliance.create({
        data: { assetNumber, applianceTypeId: type.id },
      });
      applianceId = appliance.id;
    }
    const request = await prisma.maintenanceRequest.create({
      data: {
        customerId,
        applianceId,
        status: data.status ?? "SUBMITTED",
        priority: data.priority ?? "NORMAL",
        openedAt: data.openedAt,
        problem: data.problem ?? `AR5R problem ${tag} — the drum squeaks loudly when it spins and the clothes come out still damp after a full cycle, every single time.`,
      },
    });
    requestIds.push(request.id);
    if (data.withVisit) {
      await prisma.job.create({
        data: {
          type: "MAINTENANCE_VISIT",
          status: "SCHEDULED",
          scheduledAt: new Date(T0.getTime() + 9 * DAY),
          customerId,
          maintenanceRequestId: request.id,
        },
      });
    }
    return request.id;
  }

  beforeAll(async () => {
    const customerUser = await prisma.user.create({
      data: { email: `ar5r-customer-${tag}@example.test`, name: `AR5R Customer ${tag}`, role: "CUSTOMER" },
    });
    userIds.push(customerUser.id);
    const customer = await prisma.customer.create({
      data: { userId: customerUser.id, referralCode: `AR5R-${tag}` },
    });
    customerId = customer.id;
    base.q = `AR5R Customer ${tag}`;

    await makeRequest({ status: "SUBMITTED", priority: "URGENT", openedAt: T0, withAppliance: true });
    await makeRequest({ status: "REVIEWING", priority: "HIGH", openedAt: new Date(T0.getTime() + DAY) });
    await makeRequest({ status: "SCHEDULED", priority: "NORMAL", openedAt: new Date(T0.getTime() + 2 * DAY), withVisit: true });
    await makeRequest({ status: "RESOLVED", openedAt: new Date(T0.getTime() + 3 * DAY) });
    await makeRequest({ status: "CLOSED", openedAt: new Date(T0.getTime() + 4 * DAY) });
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { maintenanceRequestId: { in: requestIds } } });
    await prisma.maintenanceRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.appliance.deleteMany({ where: { assetNumber } });
    await prisma.applianceType.deleteMany({ where: { slug: `ar5r-dryer-${tag}` } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("partitions requests into the four tabs", async () => {
    const counts = await getRepairCounts(base);
    expect(counts).toEqual({ open: 3, new: 1, fixed: 1, closed: 1 });
  });

  it("shapes the row: excerpt capped at 120 chars, appliance label, next visit", async () => {
    const open = await getRepairRequests(base);
    const withAppliance = open.rows.find((row) => row.applianceLabel !== null);
    expect(withAppliance?.applianceLabel).toBe(`AR5R Dryer ${tag} #${assetNumber}`);
    expect(withAppliance?.problemExcerpt.length).toBe(120);
    const withVisit = open.rows.find((row) => row.nextVisit !== null);
    expect(withVisit?.hasOpenVisit).toBe(true);
    expect(withVisit?.nextVisit?.scheduledAt.getTime()).toBe(T0.getTime() + 9 * DAY);
    const plain = open.rows.find((row) => row.status === "REVIEWING");
    expect(plain?.hasOpenVisit).toBe(false);
    expect(plain?.nextVisit).toBeNull();
  });

  it("filters and sorts by priority — URGENT before HIGH before NORMAL", async () => {
    const urgentOnly = await getRepairRequests({ ...base, priority: "URGENT" });
    expect(urgentOnly.rows.map((row) => row.priority)).toEqual(["URGENT"]);
    const byPriority = await getRepairRequests({ ...base, sort: "priority" });
    expect(byPriority.rows.map((row) => row.priority)).toEqual(["URGENT", "HIGH", "NORMAL"]);
  });

  it("finds a request by appliance number, exactly", async () => {
    const found = await getRepairRequests({ ...base, q: assetNumber });
    expect(found.rows).toHaveLength(1);
    const partial = await getRepairRequests({ ...base, q: assetNumber.slice(0, -1) });
    expect(partial.rows).toHaveLength(0);
  });

  it("grows the window through the cursor without repeats", async () => {
    let cursor: string | undefined;
    let seen: string[] = [];
    for (let page = 0; page < 4; page++) {
      const result = await getRepairRequests({ ...base, pageSize: 1, cursor });
      seen = result.rows.map((row) => row.id);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });
});
