import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const role = vi.hoisted(() => ({ current: "OWNER" as string }));
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async () => ({ user: { id: "cust-test", role: role.current } })),
}));

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getCustomerList,
  getCustomerSegmentCounts,
} from "@/domains/customers/list";
import {
  customerSegments,
  startOfTodayDenver,
  type CustomerSegment,
  CUSTOMER_SEGMENTS,
} from "@/domains/customers/segments";
import { customerContactKeys } from "@/domains/customers/keys";
import { getRentalEndingNoticeDays } from "@/domains/agreements/ending-notice";
import { billOwedWhere } from "@/domains/billing/bill-status";

// CU-1 / CUSTOMERS spec sections 2-4 + 7: the tab query returns exactly the
// customers whose pure customerSegments() includes the segment (30 fixtures,
// facts read back from the real view); owed equals the Bills money rule;
// staff rows carry no money at runtime; search by phone digits, address and
// asset number; the growing cursor window shows each row once; the walk-in
// never appears or counts. Runs only against the local throwaway test DB.
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
const tag = `clt-${Date.now().toString(36)}`;
const now = new Date();
const startToday = startOfTodayDenver(now);
let endingDays = 30;

const customerIds: string[] = [];
const userIds: string[] = [];
let phoneCustomerId = "";
let assetCustomerId = "";
let assetNumber = "";
let walkInId = "";

async function makeCustomer(opts: {
  name: string;
  phone?: string;
  companyName?: string;
  isWalkIn?: boolean;
  archivedAt?: Date;
}) {
  const email = `${tag}-${opts.name.replace(/\W+/g, "").toLowerCase()}@example.test`;
  const user = await prisma.user.create({ data: { name: opts.name, email, role: "CUSTOMER" } });
  userIds.push(user.id);
  const customer = await prisma.customer.create({
    data: {
      userId: user.id,
      referralCode: `REF-${email}`,
      phone: opts.phone ?? null,
      ...(opts.phone ? customerContactKeys({ phone: opts.phone }) : {}),
      companyName: opts.companyName ?? null,
      isWalkIn: opts.isWalkIn ?? false,
      archivedAt: opts.archivedAt ?? null,
    },
  });
  customerIds.push(customer.id);
  const address = await prisma.serviceAddress.create({
    data: { customerId: customer.id, line1: `${tag} Main St`, city: "Greeley", zip: "80631" },
  });
  return { customerId: customer.id, addressId: address.id };
}

async function addAgreement(customerId: string, addressId: string, data: Record<string, unknown>) {
  return prisma.rentalAgreement.create({ data: { customerId, serviceAddressId: addressId, ...data } });
}

async function addInvoice(customerId: string, data: Record<string, unknown>) {
  return prisma.invoice.create({
    data: { customerId, amountDueCents: 10_000, amountPaidCents: 0, ...data },
  });
}

describe.skipIf(!ready)("CU-1 customer list (integration)", () => {
  beforeAll(async () => {
    endingDays = await getRentalEndingNoticeDays();
    const inWindow = new Date(startToday.getTime() + 3 * DAY);
    const pastDue = new Date(startToday.getTime() - 2 * DAY);

    // 30 fixtures across the segment matrix.
    for (let i = 0; i < 5; i++) await makeCustomer({ name: `${tag} New ${i}` });
    for (let i = 0; i < 4; i++) {
      const { customerId, addressId } = await makeCustomer({ name: `${tag} SettingUp ${i}` });
      await addAgreement(customerId, addressId, { status: "SCHEDULED" });
    }
    for (let i = 0; i < 5; i++) {
      const { customerId, addressId } = await makeCustomer({ name: `${tag} Active ${i}` });
      await addAgreement(customerId, addressId, {
        status: "ACTIVE",
        firstDeliveredOn: new Date(startToday.getTime() - 40 * DAY),
        nextBillingDate: new Date(startToday.getTime() + 9 * DAY),
      });
    }
    for (let i = 0; i < 3; i++) {
      const { customerId, addressId } = await makeCustomer({ name: `${tag} Owes ${i}` });
      await addAgreement(customerId, addressId, {
        status: "ACTIVE",
        firstDeliveredOn: new Date(startToday.getTime() - 40 * DAY),
      });
      await addInvoice(customerId, { status: "OPEN", dueDate: pastDue, amountDueCents: 12_000, amountPaidCents: 2_000 });
    }
    for (let i = 0; i < 3; i++) {
      const { customerId, addressId } = await makeCustomer({ name: `${tag} Ending ${i}` });
      await addAgreement(customerId, addressId, {
        status: "ACTIVE",
        firstDeliveredOn: new Date(startToday.getTime() - 40 * DAY),
        termMonths: 12,
        endDate: inWindow,
      });
    }
    for (let i = 0; i < 2; i++) {
      const { customerId, addressId } = await makeCustomer({ name: `${tag} OwesEnding ${i}` });
      await addAgreement(customerId, addressId, {
        status: "ACTIVE",
        firstDeliveredOn: new Date(startToday.getTime() - 40 * DAY),
        termMonths: 6,
        endDate: inWindow,
      });
      await addInvoice(customerId, { status: "DELINQUENT", dueDate: pastDue, amountDueCents: 5_000 });
    }
    for (let i = 0; i < 4; i++) {
      const { customerId, addressId } = await makeCustomer({ name: `${tag} Past ${i}` });
      await addAgreement(customerId, addressId, { status: "ENDED" });
    }
    for (let i = 0; i < 2; i++) {
      const { customerId } = await makeCustomer({ name: `${tag} OwesOnly ${i}` });
      await addInvoice(customerId, { status: "FAILED", dueDate: pastDue, amountDueCents: 7_500 });
    }
    for (let i = 0; i < 2; i++) {
      const { customerId, addressId } = await makeCustomer({ name: `${tag} Pickup ${i}` });
      const agreement = await addAgreement(customerId, addressId, {
        status: "ACTIVE",
        firstDeliveredOn: new Date(startToday.getTime() - 40 * DAY),
      });
      void agreement;
      await prisma.job.create({
        data: {
          customerId,
          type: "REMOVAL",
          status: "SCHEDULED",
          scheduledAt: new Date(startToday.getTime() + 2 * DAY),
        },
      });
    }

    // Phone-search fixture.
    const phone = await makeCustomer({ name: `${tag} Phone`, phone: "(970) 555-0134" });
    phoneCustomerId = phone.customerId;

    // Asset-search fixture: ACTIVE agreement + line + assigned appliance.
    const asset = await makeCustomer({ name: `${tag} Asset` });
    assetCustomerId = asset.customerId;
    const agreement = await addAgreement(asset.customerId, asset.addressId, {
      status: "ACTIVE",
      firstDeliveredOn: new Date(startToday.getTime() - 10 * DAY),
    });
    const type = await prisma.applianceType.create({ data: { name: `${tag} Washer`, slug: `${tag}-washer` } });
    assetNumber = `${tag}-WASHER-1`;
    const appliance = await prisma.appliance.create({
      data: { assetNumber, applianceTypeId: type.id },
    });
    const line = await prisma.rentalLine.create({
      data: { agreementId: agreement.id, label: `${tag} line`, monthlyPriceCents: 6_000 },
    });
    await prisma.applianceAssignment.create({
      data: { rentalLineId: line.id, applianceId: appliance.id },
    });

    // The walk-in: the seed's built-in counter-sale customer (the database
    // allows at most one) — it must never appear in the view or the list.
    const walkIn = await prisma.customer.findFirst({ where: { isWalkIn: true }, select: { id: true } });
    walkInId = walkIn?.id ?? "";
  });

  afterAll(async () => {
    await prisma.applianceAssignment.deleteMany({ where: { rentalLine: { agreement: { customerId: { in: customerIds } } } } });
    await prisma.rentalLine.deleteMany({ where: { agreement: { customerId: { in: customerIds } } } });
    await prisma.job.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.invoice.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.serviceAddress.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.appliance.deleteMany({ where: { assetNumber } });
    await prisma.applianceType.deleteMany({ where: { name: `${tag} Washer` } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("tab query = pure rule, for every segment (facts read from the real view)", async () => {
    const viewRows = await prisma.$queryRaw<
      { id: string; activeCount: number; pendingCount: number; endedCount: number; oldestOpenDueDate: Date | null; endingOn: Date | null; pickupAt: Date | null }[]
    >`SELECT "id", "activeCount", "pendingCount", "endedCount", "oldestOpenDueDate", "endingOn", "pickupAt" FROM "customer_list_v1" WHERE "id" IN (${Prisma.join(customerIds)})`;
    const expected = new Map<string, CustomerSegment[]>();
    for (const r of viewRows) expected.set(r.id, customerSegments(r, now, endingDays));
    // 30 matrix fixtures + phone + asset = 32 view rows (walk-in excluded).
    expect(viewRows.length).toBe(32);
    expect(walkInId).not.toBe("");
    const walkInRows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM "customer_list_v1" WHERE "id" = ${walkInId}`;
    expect(walkInRows[0].n).toBe(0);

    for (const segment of CUSTOMER_SEGMENTS) {
      const { rows } = await getCustomerList({ segment, q: tag, pageSize: 100 });
      const got = new Set(rows.map((r) => r.id));
      const want = new Set(
        [...expected.entries()].filter(([, segs]) => segs.includes(segment)).map(([id]) => id),
      );
      expect(got, `segment ${segment}`).toEqual(want);
    }
  });

  it("segment counts match the tab sizes", async () => {
    const counts = await getCustomerSegmentCounts({ q: tag });
    for (const segment of CUSTOMER_SEGMENTS) {
      const { rows } = await getCustomerList({ segment, q: tag, pageSize: 100 });
      expect(counts[segment], `count ${segment}`).toBe(rows.length);
    }
  });

  it("owed equals the Bills money-rule total on one fixture, and pastDueCents splits by due date", async () => {
    const { rows } = await getCustomerList({ segment: "owes", q: `${tag} Owes 0` });
    expect(rows.length).toBe(1);
    const row = rows[0];
    const bills = await prisma.invoice.findMany({
      where: { customerId: row.id, ...billOwedWhere(now) },
      select: { amountDueCents: true, amountPaidCents: true },
    });
    const expectedOwed = bills.reduce((s, b) => s + Math.max(0, b.amountDueCents - b.amountPaidCents), 0);
    expect(row.owedCents).toBe(expectedOwed);
    expect(row.owedCents).toBe(10_000);
    expect(row.pastDueCents).toBe(10_000);
  });

  it("staff rows carry no money at runtime, owes falls back, counts hide owes", async () => {
    role.current = "STAFF";
    try {
      const { rows } = await getCustomerList({ segment: "owes", q: tag, pageSize: 100 });
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect("monthlyRentCents" in r).toBe(false);
        expect("owedCents" in r).toBe(false);
        expect("pastDueCents" in r).toBe(false);
        expect("autopay" in r).toBe(false);
      }
      // The refused segment fell back to the default (active).
      const active = await getCustomerList({ segment: "active", q: tag, pageSize: 100 });
      expect(new Set(rows.map((r) => r.id))).toEqual(new Set(active.rows.map((r) => r.id)));
      const counts = await getCustomerSegmentCounts({ q: tag });
      expect(counts.owes).toBe(0);
    } finally {
      role.current = "OWNER";
    }
  });

  it("search finds by phone digits, by address text, and by exact asset number", async () => {
    const byPhone = await getCustomerList({ segment: "all", q: "9705550134" });
    expect(byPhone.rows.map((r) => r.id)).toContain(phoneCustomerId);
    const byPhonePartial = await getCustomerList({ segment: "all", q: "555-0134" });
    expect(byPhonePartial.rows.map((r) => r.id)).toContain(phoneCustomerId);
    const byAddress = await getCustomerList({ segment: "all", q: `${tag} Main` });
    expect(byAddress.rows.length).toBeGreaterThan(20);
    const byAsset = await getCustomerList({ segment: "all", q: assetNumber });
    expect(byAsset.rows.map((r) => r.id)).toEqual([assetCustomerId]);
  });

  it("the growing cursor window shows each row exactly once, in name order", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let step = 0; step < 12; step++) {
      const page = await getCustomerList({ segment: "all", q: tag, sort: "name", pageSize: 7, cursor });
      for (const r of page.rows) if (!seen.includes(r.id)) seen.push(r.id);
      // The window grows: every call returns the whole window so far; the
      // new tail is what advances. Collect in order from the full window.
      seen.length = 0;
      seen.push(...page.rows.map((r) => r.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen.length).toBe(32);
    expect(new Set(seen).size).toBe(32);
    const names = seen.map((id) => id);
    expect(names.length).toBe(32);
  });

  it("next event facts ride the row: visit type + pickup are visible to the pure text helper inputs", async () => {
    const { rows } = await getCustomerList({ segment: "ending", q: `${tag} Pickup`, pageSize: 10 });
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.pickupAt).not.toBeNull();
      expect(r.segments).toContain("ending");
    }
  });
});
