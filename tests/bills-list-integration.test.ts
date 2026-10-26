import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }) }));

import { prisma } from "@/lib/prisma";
import { getBillCounts, getBills, getBillTotals } from "@/domains/billing/bills-list";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";
const DAY = 86_400_000;

// AR-0b (MONEY-BILLS 3): every query is narrowed to this test's own customers so other suites' bills never interfere.
describe.skipIf(!enabled)("Money › Bills reads", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const people = ["a", "b", "many"].map((key) => ({ key, userId: `bl-u-${key}-${tag}`, customerId: `bl-c-${key}-${tag}` }));
  const [a, b, many] = people;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    for (const p of people) {
      await prisma.user.create({ data: { id: p.userId, email: `bl-${p.key}-${tag}@example.test`, name: `Bills ${p.key} ${tag}`, role: "CUSTOMER" } });
      await prisma.customer.create({ data: { id: p.customerId, userId: p.userId, referralCode: `BL${p.key}${tag}`.slice(0, 30) } });
    }
    const now = Date.now();
    const rows = [
      ["open-future", a, { status: "OPEN", dueDate: new Date(now + 5 * DAY), amountDueCents: 7000 }],
      ["late", a, { status: "DELINQUENT", dueDate: new Date(now - 5 * DAY), amountDueCents: 7000 }],
      ["partial", a, { status: "PARTIALLY_PAID", dueDate: new Date(now - 2 * DAY), amountDueCents: 7000, amountPaidCents: 3000 }],
      ["overpaid-open", a, { status: "OPEN", dueDate: new Date(now - 2 * DAY), amountDueCents: 7000, amountPaidCents: 7000 }],
      ["paid", a, { status: "PAID", dueDate: new Date(now - 30 * DAY), amountDueCents: 7000, amountPaidCents: 7000 }],
      ["void", a, { status: "VOID", dueDate: null, amountDueCents: 7000 }],
      ["draft", b, { status: "DRAFT", dueDate: null, amountDueCents: 1000 }],
    ] as const;
    for (const [key, who, data] of rows) {
      ids[key] = (await prisma.invoice.create({ data: { customerId: who.customerId, ...data } })).id;
    }
    await prisma.invoice.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        customerId: many.customerId,
        status: "OPEN" as const,
        dueDate: i % 10 === 0 ? null : new Date(now + (i % 7) * DAY),
        amountDueCents: 1000 + i,
      })),
    });
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { customerId: { in: people.map((p) => p.customerId) } } });
    await prisma.customer.deleteMany({ where: { id: { in: people.map((p) => p.customerId) } } });
    await prisma.user.deleteMany({ where: { id: { in: people.map((p) => p.userId) } } });
  });

  const idsOf = async (status: "open" | "past-due" | "being-confirmed" | "paid" | "closed" | "drafts", customerId: string) =>
    (await getBills({ status, sort: "due-asc", customerId })).rows.map((row) => row.id).sort();

  it("each tab returns the right bills", async () => {
    expect(await idsOf("open", a.customerId)).toEqual([ids["open-future"], ids.late, ids.partial].sort());
    expect(await idsOf("past-due", a.customerId)).toEqual([ids.late, ids.partial].sort());
    expect(await idsOf("paid", a.customerId)).toEqual([ids.paid]);
    expect(await idsOf("closed", a.customerId)).toEqual([ids.void]);
    expect(await idsOf("drafts", b.customerId)).toEqual([ids.draft]);
    const partial = (await getBills({ status: "open", sort: "due-asc", customerId: a.customerId })).rows.find((row) => row.id === ids.partial)!;
    expect(partial).toMatchObject({ owedCents: 4000, paidCents: 3000, amountCents: 7000, payPath: "MANUAL_ONLY", forText: "Bill" });
  });

  it("searches by bill number and by name", async () => {
    const number = (await prisma.invoice.findUniqueOrThrow({ where: { id: ids.late }, select: { invoiceNumber: true } })).invoiceNumber;
    expect((await getBills({ status: "open", sort: "due-asc", q: String(number) })).rows.map((r) => r.id)).toEqual([ids.late]);
    expect((await getBills({ status: "open", sort: "due-asc", q: `bills a ${tag}` })).rows.map((r) => r.id).sort()).toEqual(
      [ids["open-future"], ids.late, ids.partial].sort(),
    );
  });

  it("counts and totals match the rows", async () => {
    const counts = await getBillCounts({ sort: "due-asc", customerId: a.customerId });
    expect(counts).toEqual({ open: 3, "past-due": 2, "being-confirmed": 0, paid: 1, closed: 1, drafts: 0 });
    expect(await getBillTotals({ status: "open", sort: "due-asc", customerId: a.customerId })).toEqual({ count: 3, owedCents: 7000 + 7000 + 4000 });
    expect(await getBillTotals({ status: "paid", sort: "due-asc", customerId: a.customerId })).toEqual({ count: 1, owedCents: 0 });
  });

  it.each(["due-asc", "due-desc", "owed-desc", "customer-asc"] as const)("Load more grows the window: 50, 100, 120 and each bill once (%s)", async (sort) => {
    const first = await getBills({ status: "open", sort, customerId: many.customerId });
    expect(first.rows).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = await getBills({ status: "open", sort, customerId: many.customerId, cursor: first.nextCursor! });
    expect(second.rows).toHaveLength(100);
    expect(second.rows.slice(0, 50).map((r) => r.id)).toEqual(first.rows.map((r) => r.id));
    const third = await getBills({ status: "open", sort, customerId: many.customerId, cursor: second.nextCursor! });
    expect(third.rows).toHaveLength(120);
    expect(third.nextCursor).toBeNull();
    expect(third.capped).toBe(false);
    expect(new Set(third.rows.map((r) => r.id)).size).toBe(120);
  });
});
