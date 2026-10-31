import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async () => ({ user: { id: "fleet-test", role: "OWNER" } })),
}));

import { prisma } from "@/lib/prisma";
import { getFleet, getFleetCounts, type FleetParams } from "@/domains/inventory/fleet-list";

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

// AR-6 section 3: tabs, the three search rules, counts that match the
// filtered population, and cursor paging that walks same-instant units
// exactly once (fix 7).
const MARK = "AR6F";

function params(overrides: Partial<FleetParams> = {}): FleetParams {
  return { tab: "all", q: "", sort: "newest", ...overrides };
}

describe.skipIf(!enabled)("getFleet / getFleetCounts", () => {
  let typeId = "";
  let customerId = "";
  let customerName = "";
  let addressId = "";
  const ids: string[] = [];

  async function unit(data: {
    assetNumber: string;
    status: "AVAILABLE" | "RENTED" | "MAINTENANCE" | "AWAITING_PICKUP";
    model?: string;
    serialNumber?: string;
    createdAt?: Date;
  }) {
    const row = await prisma.appliance.create({
      data: {
        assetNumber: data.assetNumber,
        applianceTypeId: typeId,
        status: data.status,
        manufacturer: "GE",
        model: data.model ?? `${MARK} Washer`,
        serialNumber: data.serialNumber,
        ...(data.createdAt ? { createdAt: data.createdAt } : {}),
      },
    });
    ids.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    // Self-clean leftovers from any earlier failed run of this suite.
    const stale = await prisma.appliance.findMany({
      where: { assetNumber: { startsWith: MARK } },
      select: { id: true },
    });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: stale.map((a) => a.id) } } });
    await prisma.appliance.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });
    await prisma.applianceType.deleteMany({ where: { slug: { startsWith: "ar6f" } } });

    const type = await prisma.applianceType.create({
      data: { name: `${MARK} Washer ${Date.now()}`, slug: `ar6f-${Date.now()}` },
    });
    typeId = type.id;
    // A Customer row needs a linked user; borrow the seeded test customer
    // (only this test's own address + custody episode are created/removed).
    const customer = await prisma.customer.findFirstOrThrow({
      include: { user: { select: { name: true, email: true } } },
    });
    customerId = customer.id;
    customerName = customer.companyName ?? customer.user.name ?? customer.user.email;

    // Three units created at the SAME instant (the purchase case).
    const instant = new Date("2026-10-01T12:00:00Z");
    await unit({ assetNumber: `${MARK}-101`, status: "AVAILABLE", createdAt: instant });
    await unit({ assetNumber: `${MARK}-102`, status: "AVAILABLE", createdAt: instant });
    await unit({ assetNumber: `${MARK}-103`, status: "AVAILABLE", createdAt: instant });
    const rented = await unit({ assetNumber: `${MARK}-104`, status: "RENTED", serialNumber: "SN-AR6F-9" });
    await unit({ assetNumber: `${MARK}-105`, status: "MAINTENANCE", model: `${MARK} Dryer` });
    await unit({ assetNumber: `${MARK}-106`, status: "AWAITING_PICKUP" });
    const address = await prisma.serviceAddress.create({
      data: { customerId, line1: "1 Fleet Way", city: "Greeley", state: "CO", zip: "80631" },
    });
    addressId = address.id;
    await prisma.applianceCustodyEpisode.create({
      data: { applianceId: rented, customerId, serviceAddressId: address.id, startEvidence: "MANUAL" },
    });
  });

  afterAll(async () => {
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: ids } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.appliance.deleteMany({ where: { id: { in: ids } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
  });

  it("tabs filter by their status sets; retired never appears", async () => {
    const ready = await getFleet(params({ tab: "ready", q: MARK }));
    expect(ready.rows.map((r) => r.assetNumber).sort()).toEqual([`${MARK}-101`, `${MARK}-102`, `${MARK}-103`]);
    expect(ready.rows.every((r) => r.status === "AVAILABLE")).toBe(true);
    const out = await getFleet(params({ tab: "out", q: MARK }));
    expect(out.rows.map((r) => r.assetNumber)).toEqual([`${MARK}-104`]);
    const work = await getFleet(params({ tab: "needs-work", q: MARK }));
    expect(work.rows.map((r) => r.assetNumber)).toEqual([`${MARK}-105`]);
  });

  it("search: number prefix, serial exact, model contains", async () => {
    const byNumber = await getFleet(params({ q: `${MARK}-10` }));
    expect(byNumber.rows.length).toBe(6);
    const bySerial = await getFleet(params({ q: "sn-ar6f-9" }));
    expect(bySerial.rows.map((r) => r.assetNumber)).toEqual([`${MARK}-104`]);
    const serialPartial = await getFleet(params({ q: "SN-AR6F" }));
    expect(serialPartial.rows.length).toBe(0); // exact only, not contains
    const byModel = await getFleet(params({ q: "dryer" }));
    expect(byModel.rows.map((r) => r.assetNumber)).toEqual([`${MARK}-105`]);
  });

  it("the rented row carries the open custody's customer and city, batched", async () => {
    const out = await getFleet(params({ tab: "out", q: MARK }));
    expect(out.rows[0].custody).toEqual({ customerName, city: "Greeley" });
    const ready = await getFleet(params({ tab: "ready", q: MARK }));
    expect(ready.rows.every((r) => r.custody === null)).toBe(true);
  });

  it("counts match the filtered population", async () => {
    const counts = await getFleetCounts(params({ q: MARK }));
    expect(counts).toEqual({ all: 6, ready: 3, out: 1, "coming-back": 1, "needs-work": 1 });
  });

  it("cursor walks the three same-instant units exactly once (newest)", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 6; page++) {
      const result = await getFleet(params({ tab: "ready", q: MARK, cursor }), 2);
      seen.push(...result.rows.map((r) => r.assetNumber));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(seen.sort()).toEqual([`${MARK}-101`, `${MARK}-102`, `${MARK}-103`]);
    expect(new Set(seen).size).toBe(3);
  });

  it("number sort pages in asset-number order", async () => {
    const page1 = await getFleet(params({ q: MARK, sort: "number" }), 4);
    expect(page1.rows.map((r) => r.assetNumber)).toEqual([
      `${MARK}-101`, `${MARK}-102`, `${MARK}-103`, `${MARK}-104`,
    ]);
    const page2 = await getFleet(params({ q: MARK, sort: "number", cursor: page1.nextCursor ?? undefined }), 4);
    expect(page2.rows.map((r) => r.assetNumber)).toEqual([`${MARK}-105`, `${MARK}-106`]);
    expect(page2.nextCursor).toBeNull();
  });
});
