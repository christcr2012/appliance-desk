import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }) }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));

import { prisma } from "@/lib/prisma";
import { getCustomerNextSteps } from "@/domains/customers/record";
import { todoKey } from "@/domains/exceptions/todo";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";
const DAY = 86_400_000;

// AR-0b (CUSTOMER-RECORD 3): next steps are read for this customer only, so the business-wide To do cap never hides them.
describe.skipIf(!enabled)("customer-scoped next steps", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const ownerId = `ns-owner-${tag}`;
  const people = ["a", "b", "crowd"].map((key) => ({ key, userId: `ns-u-${key}-${tag}`, customerId: `ns-c-${key}-${tag}` }));
  const [a, b, crowd] = people;
  let aBill = "";
  let aSnoozed = "";
  let bBill = "";

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerId, email: `ns-owner-${tag}@example.test`, name: "Owner", role: "OWNER" } });
    for (const p of people) {
      await prisma.user.create({ data: { id: p.userId, email: `ns-${p.key}-${tag}@example.test`, name: `Next ${p.key}`, role: "CUSTOMER" } });
      await prisma.customer.create({ data: { id: p.customerId, userId: p.userId, referralCode: `NS${p.key}${tag}`.slice(0, 30) } });
    }
    const now = Date.now();
    // 55 past-due bills for someone else, all older than this customer's, so the business-wide cap of 50 is full.
    await prisma.invoice.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        customerId: crowd.customerId,
        status: "OPEN" as const,
        dueDate: new Date(now - (4000 + i) * DAY),
        amountDueCents: 1000,
      })),
    });
    aBill = (await prisma.invoice.create({ data: { customerId: a.customerId, status: "OPEN", dueDate: new Date(now - 3 * DAY), amountDueCents: 7000 } })).id;
    aSnoozed = (await prisma.invoice.create({ data: { customerId: a.customerId, status: "OPEN", dueDate: new Date(now - 4 * DAY), amountDueCents: 5000 } })).id;
    bBill = (await prisma.invoice.create({ data: { customerId: b.customerId, status: "OPEN", dueDate: new Date(now - 3 * DAY), amountDueCents: 9000 } })).id;
    const href = `/desk/billing/customer/${a.customerId}/invoice/${aSnoozed}`;
    await prisma.exceptionSnooze.create({
      data: {
        key: todoKey({ category: "PAST_DUE_INVOICE", href, title: "" }),
        category: "PAST_DUE_INVOICE",
        href,
        snoozedUntil: new Date(now + 5 * DAY),
        reason: "Waiting on the customer",
        actorUserId: ownerId,
      },
    });
  });

  afterAll(async () => {
    const customerIds = people.map((p) => p.customerId);
    await prisma.exceptionSnooze.deleteMany({ where: { actorUserId: ownerId } });
    await prisma.deposit.deleteMany({ where: { agreement: { customerId: { in: customerIds } } } });
    await prisma.rentalAgreement.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.serviceAddress.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.invoice.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, ...people.map((p) => p.userId)] } } });
  });

  it("finds this customer's past-due bill past the business-wide cap, leaves out snoozed ones and never shows another customer's", async () => {
    const steps = await getCustomerNextSteps(a.customerId);
    const hrefs = steps.map((step) => step.href);
    expect(hrefs).toContain(`/desk/billing/customer/${a.customerId}/invoice/${aBill}`);
    expect(hrefs).not.toContain(`/desk/billing/customer/${a.customerId}/invoice/${aSnoozed}`);
    expect(hrefs.some((h) => h.includes(bBill) || h.includes(b.customerId) || h.includes(crowd.customerId))).toBe(false);
    expect(steps.length).toBeLessThanOrEqual(3);
    const forB = await getCustomerNextSteps(b.customerId);
    expect(forB.map((s) => s.href)).toEqual([`/desk/billing/customer/${b.customerId}/invoice/${bBill}`]);
  });

  it("finds this customer's deposit decision even when 500+ older deposits exist elsewhere", async () => {
    const now = Date.now();
    const address = await prisma.serviceAddress.create({ data: { customerId: crowd.customerId, line1: "1 Crowd St", city: "Greeley", zip: "80631" } });
    const crowdAgreement = await prisma.rentalAgreement.create({
      data: { customerId: crowd.customerId, serviceAddressId: address.id, status: "ENDED", endDate: new Date(now - 30 * DAY) },
    });
    await prisma.deposit.createMany({
      data: Array.from({ length: 505 }, (_, i) => ({ agreementId: crowdAgreement.id, amountCents: 1000, createdAt: new Date(now - (5000 - i) * DAY) })),
    });
    const aAddress = await prisma.serviceAddress.create({ data: { customerId: a.customerId, line1: "2 Own St", city: "Greeley", zip: "80631" } });
    const aAgreement = await prisma.rentalAgreement.create({
      data: { customerId: a.customerId, serviceAddressId: aAddress.id, status: "ENDED", endDate: new Date(now - 10 * DAY) },
    });
    const deposit = await prisma.deposit.create({ data: { agreementId: aAgreement.id, amountCents: 7500 } });
    const hrefs = (await getCustomerNextSteps(a.customerId)).map((s) => s.href);
    // Next steps keep the three most pressing; the past-due bill is high and the deposit medium, so check the read directly too.
    const { listDepositDecisionAttention } = await import("@/domains/exceptions/money-turning-points");
    const scoped = await listDepositDecisionAttention(50, new Date(), { customerId: a.customerId });
    expect(scoped.rows.map((r) => r.href)).toEqual([`/desk/billing/deposits/${encodeURIComponent(deposit.id)}`]);
    expect(hrefs.length).toBeGreaterThan(0);
  });

  it("still finds an unsnoozed bill when the three oldest are snoozed", async () => {
    const now = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push((await prisma.invoice.create({ data: { customerId: b.customerId, status: "OPEN", dueDate: new Date(now - (20 + i) * DAY), amountDueCents: 1000 } })).id);
    }
    for (const id of ids.slice(1)) {
      const href = `/desk/billing/customer/${b.customerId}/invoice/${id}`;
      await prisma.exceptionSnooze.create({
        data: { key: todoKey({ category: "PAST_DUE_INVOICE", href, title: "" }), category: "PAST_DUE_INVOICE", href, snoozedUntil: new Date(now + 5 * DAY), reason: "Waiting on the customer", actorUserId: ownerId },
      });
    }
    const hrefs = (await getCustomerNextSteps(b.customerId)).map((s) => s.href);
    expect(hrefs).toContain(`/desk/billing/customer/${b.customerId}/invoice/${ids[0]}`);
    for (const id of ids.slice(1)) expect(hrefs).not.toContain(`/desk/billing/customer/${b.customerId}/invoice/${id}`);
  });
});
