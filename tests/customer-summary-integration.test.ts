import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }) }));

import { prisma } from "@/lib/prisma";
import { getCustomerSummary } from "@/domains/customers/record";
import { getBillTotals } from "@/domains/billing/bills-list";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";
const DAY = 86_400_000;

// AR-0b (CUSTOMER-RECORD 3): the record's numbers come only from this customer's rows.
describe.skipIf(!enabled)("customer record summary", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const people = ["a", "b"].map((key) => ({ key, userId: `cs-u-${key}-${tag}`, customerId: `cs-c-${key}-${tag}`, addressId: `cs-ad-${key}-${tag}` }));
  const [a, b] = people;

  beforeAll(async () => {
    for (const p of people) {
      await prisma.user.create({ data: { id: p.userId, email: `cs-${p.key}-${tag}@example.test`, name: `Summary ${p.key}`, role: "CUSTOMER" } });
      await prisma.customer.create({ data: { id: p.customerId, userId: p.userId, referralCode: `CS${p.key}${tag}` } });
      await prisma.serviceAddress.create({ data: { id: p.addressId, customerId: p.customerId, line1: "1402 10th Ave", city: "Greeley", zip: "80631" } });
    }
    const now = Date.now();
    const agreement = (p: (typeof people)[number], status: "ACTIVE" | "ENDED" | "SCHEDULED", cents: number, nextBillingDate: Date | null) =>
      prisma.rentalAgreement.create({
        data: {
          customerId: p.customerId,
          serviceAddressId: p.addressId,
          status,
          nextBillingDate,
          lines: { create: [{ label: "Washer @ $40/mo", monthlyPriceCents: cents, listPriceCents: cents }] },
        },
      });
    await agreement(a, "ACTIVE", 4000, new Date(now + 10 * DAY));
    await agreement(a, "ACTIVE", 3000, new Date(now + 3 * DAY));
    await agreement(a, "ENDED", 9900, null);
    await agreement(a, "SCHEDULED", 5500, null);
    await agreement(b, "ACTIVE", 12345, new Date(now + 1 * DAY));
    await prisma.invoice.createMany({
      data: [
        { customerId: a.customerId, status: "OPEN", dueDate: new Date(now - 3 * DAY), amountDueCents: 7000 },
        { customerId: a.customerId, status: "PARTIALLY_PAID", dueDate: new Date(now + 3 * DAY), amountDueCents: 7000, amountPaidCents: 2000 },
        { customerId: a.customerId, status: "PAID", dueDate: new Date(now - 30 * DAY), amountDueCents: 7000, amountPaidCents: 7000 },
        { customerId: b.customerId, status: "OPEN", dueDate: new Date(now - 3 * DAY), amountDueCents: 99999 },
      ],
    });
  });

  afterAll(async () => {
    const customerIds = people.map((p) => p.customerId);
    await prisma.invoice.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreement: { customerId: { in: customerIds } } } });
    await prisma.rentalAgreement.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.serviceAddress.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: people.map((p) => p.userId) } } });
  });

  it("owes equals the Bills screen's open total; rent sums only active rentals; next bill is the earliest; never another customer's rows", async () => {
    const now = new Date();
    const summary = await getCustomerSummary(a.customerId, now);
    const open = await getBillTotals({ status: "open", sort: "due-asc", customerId: a.customerId }, now);
    expect(summary.owedCents).toBe(open.owedCents);
    expect(summary.owedCents).toBe(7000 + 5000);
    expect(summary.monthlyRentCents).toBe(7000);
    expect(summary.nextBill?.rentCents).toBe(3000);
    expect(summary.status).toBe("active");
    expect(summary.liveRentalCount).toBe(3);
    expect(summary.renting).toBe("Washer");
    expect(summary.city).toBe("Greeley");
    expect(summary.primaryAddress).toBe("1402 10th Ave, Greeley");
    expect(summary.oldestOpenBillId).not.toBeNull();
    const oldest = await prisma.invoice.findUniqueOrThrow({ where: { id: summary.oldestOpenBillId! }, select: { customerId: true, status: true } });
    expect(oldest).toEqual({ customerId: a.customerId, status: "OPEN" });
    const other = await getCustomerSummary(b.customerId, now);
    expect(other.owedCents).toBe(99999);
    expect(other.monthlyRentCents).toBe(12345);
  });
});
