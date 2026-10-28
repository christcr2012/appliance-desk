import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const role = vi.hoisted(() => ({ current: "OWNER" as string }));
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async () => ({ user: { id: "rentals-test", role: role.current } })),
}));

import { prisma } from "@/lib/prisma";
import {
  getRentals,
  getRentalCounts,
  type RentalsParams,
} from "@/domains/agreements/rentals-list";
import { listRentalEndingSoon } from "@/domains/exceptions/turning-points-attention";

// AR-4a / RENTALS spec sections 2 + 7: tabs, the ending-soon preset equals
// the To do rule's rows, search by appliance number, staff rows carry no
// money (type + runtime), and the growing cursor window shows every row
// exactly once. Runs only against the local throwaway test database.
const ready = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return (
      process.env.CI === "true" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.pathname === "/appliance_desk_test"
    );
  } catch {
    return false;
  }
})();

const DAY = 86_400_000;
const tag = `rlt-${Date.now().toString(36)}`;
const ids: string[] = [];
let customerA = "";
let customerB = "";
let addressA = "";
let addressB = "";
let endingSoonId = "";
let renewedId = "";
let assetAgreementId = "";

async function makeCustomer(name: string, email: string) {
  const user = await prisma.user.create({
    data: { name, email, role: "CUSTOMER" },
  });
  const customer = await prisma.customer.create({
    data: { userId: user.id, referralCode: `REF-${email}` },
  });
  const address = await prisma.serviceAddress.create({
    data: {
      customerId: customer.id,
      line1: `${tag} Main St`,
      city: "Greeley",
      zip: "80631",
    },
  });
  return { customerId: customer.id, addressId: address.id, userId: user.id };
}

async function makeAgreement(
  customerId: string,
  addressId: string,
  data: Record<string, unknown>,
) {
  const a = await prisma.rentalAgreement.create({
    data: { customerId, serviceAddressId: addressId, ...data },
  });
  ids.push(a.id);
  return a.id;
}

describe.skipIf(!ready)("rentals list (real Postgres)", () => {
  beforeAll(async () => {
    const a = await makeCustomer("Rentals Alice", `${tag}-a@example.test`);
    const b = await makeCustomer("Rentals Bob", `${tag}-b@example.test`);
    customerA = a.customerId;
    addressA = a.addressId;
    customerB = b.customerId;
    addressB = b.addressId;
    const now = Date.now();
    // Ending within the notice window but already renewed -> excluded.
    renewedId = await makeAgreement(customerA, addressA, {
      status: "ACTIVE",
      termMonths: 12,
      startDate: new Date(now - 300 * DAY),
      endDate: new Date(now + 5 * DAY),
    });
    await makeAgreement(customerA, addressA, {
      status: "SCHEDULED",
      renewedFromAgreementId: renewedId,
      termMonths: 12,
      startDate: new Date(now + 5 * DAY),
    });
    // The one true ending-soon row.
    endingSoonId = await makeAgreement(customerB, addressB, {
      status: "ACTIVE",
      termMonths: 6,
      startDate: new Date(now - 170 * DAY),
      endDate: new Date(now + 3 * DAY),
    });
    // Active but outside the window; active month-to-month.
    await makeAgreement(customerA, addressA, {
      status: "ACTIVE",
      termMonths: 12,
      startDate: new Date(now - 30 * DAY),
      endDate: new Date(now + 90 * DAY),
    });
    await makeAgreement(customerB, addressB, {
      status: "ACTIVE",
      termMonths: null,
      startDate: new Date(now - 30 * DAY),
    });
    // An agreement whose line carries an assigned appliance (search target).
    assetAgreementId = await makeAgreement(customerA, addressA, {
      status: "ACTIVE",
      termMonths: null,
      startDate: new Date(now - 10 * DAY),
    });
    const type = await prisma.applianceType.create({
      data: { name: `Washer ${tag}`, slug: `washer-${tag}` },
    });
    const appliance = await prisma.appliance.create({
      data: { assetNumber: `RLT-${tag}`, applianceTypeId: type.id, status: "RENTED" },
    });
    const line = await prisma.rentalLine.create({
      data: {
        agreementId: assetAgreementId,
        label: "Washer",
        monthlyPriceCents: 6000,
        listPriceCents: 6000,
      },
    });
    await prisma.applianceAssignment.create({
      data: { rentalLineId: line.id, applianceId: appliance.id },
    });
    await makeAgreement(customerB, addressB, { status: "DRAFT" });
    await makeAgreement(customerB, addressB, {
      status: "ENDED",
      startDate: new Date(now - 400 * DAY),
      endDate: new Date(now - 40 * DAY),
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.applianceAssignment.deleteMany({
      where: { rentalLine: { agreementId: { in: ids } } },
    });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: ids } } });
    await prisma.appliance.deleteMany({ where: { assetNumber: `RLT-${tag}` } });
    await prisma.applianceType.deleteMany({ where: { name: `Washer ${tag}` } });
    await prisma.serviceAddress.deleteMany({
      where: { id: { in: [addressA, addressB] } },
    });
    await prisma.customer.deleteMany({
      where: { id: { in: [customerA, customerB] } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: tag } },
    });
  });

  const base: RentalsParams = { status: "active", sort: "newest" };

  it("tabs and counts agree", async () => {
    const active = await getRentals(base, new Date());
    expect(active.staff).toBe(false);
    if (!active.staff) {
      const mine = active.rows.filter((r) => ids.includes(r.id));
      expect(mine).toHaveLength(5);
    }
    const drafts = await getRentals({ ...base, status: "drafts" }, new Date());
    expect(drafts.rows.filter((r) => ids.includes(r.id))).toHaveLength(1);
    const counts = await getRentalCounts({ ...base, q: tag }, new Date());
    // q=tag matches both customers' addresses (line1 carries the tag).
    expect(counts.active).toBe(5);
    expect(counts.drafts).toBe(1);
    expect(counts.ended).toBe(1);
    expect(counts.signing).toBe(0);
  });

  it("ending-soon rows equal the To do rule's rows", async () => {
    const now = new Date();
    const listed = await getRentals({ ...base, ends: "ending-soon" }, now);
    const listedIds = listed.rows.map((r) => r.id).filter((id) => ids.includes(id));
    const todo = await listRentalEndingSoon(50, now);
    const todoIds = todo.rows
      .map((r) => r.href.split("/")[3])
      .filter((id) => ids.includes(id));
    expect(listedIds.sort()).toEqual(todoIds.sort());
    expect(listedIds).toEqual([endingSoonId]);
    expect(listedIds).not.toContain(renewedId);
  });

  it("search finds a rental by its appliance number", async () => {
    const found = await getRentals({ ...base, q: `RLT-${tag}` }, new Date());
    expect(found.rows.map((r) => r.id)).toEqual([assetAgreementId]);
  });

  it("staff rows carry no money and no line labels at runtime", async () => {
    role.current = "STAFF";
    try {
      const listed = await getRentals(base, new Date());
      expect(listed.staff).toBe(true);
      if (listed.staff) {
        const row = listed.rows.find((r) => r.id === assetAgreementId);
        expect(row).toBeTruthy();
        expect(row).not.toHaveProperty("monthlyCents");
        // No line rows at all for staff: a line label is owner-written text
        // that can carry a price, so staff get the appliance count only
        // (the pre-AR-4a list's staff branch did the same).
        expect(row).not.toHaveProperty("lines");
        expect(row!.applianceCount).toBe(1);
        expect(JSON.stringify(row)).not.toContain("Washer");
      }
    } finally {
      role.current = "OWNER";
    }
  });

  it("the growing cursor window shows every row exactly once", async () => {
    // 120 extra drafts make the default 50-row window meaningful.
    const bulk = Array.from({ length: 120 }, () => ({
      customerId: customerB,
      serviceAddressId: addressB,
      status: "DRAFT" as const,
    }));
    const created = await prisma.rentalAgreement.createManyAndReturn({
      data: bulk,
      select: { id: true },
    });
    const bulkIds = created.map((c) => c.id);
    ids.push(...bulkIds);
    try {
      const first = await getRentals({ ...base, status: "drafts" }, new Date());
      const firstMine = first.rows.filter((r) => bulkIds.includes(r.id));
      expect(firstMine).toHaveLength(50);
      expect(first.nextCursor).toBeTruthy();
      const second = await getRentals(
        { ...base, status: "drafts", cursor: first.nextCursor! },
        new Date(),
      );
      const secondMine = second.rows.filter((r) => bulkIds.includes(r.id));
      expect(secondMine).toHaveLength(100);
      const third = await getRentals(
        { ...base, status: "drafts", cursor: second.nextCursor! },
        new Date(),
      );
      const thirdMine = third.rows.filter((r) => bulkIds.includes(r.id));
      expect(thirdMine).toHaveLength(120);
      expect(third.nextCursor).toBeNull();
      const seen = new Set(thirdMine.map((r) => r.id));
      expect(seen.size).toBe(120);
    } finally {
      await prisma.rentalAgreement.deleteMany({ where: { id: { in: bulkIds } } });
      ids.splice(0, ids.length, ...ids.filter((id) => !bulkIds.includes(id)));
    }
  }, 120_000);
});
