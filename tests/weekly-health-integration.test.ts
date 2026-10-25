import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }) }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));

import { prisma } from "@/lib/prisma";
import { getWeeklyHealth } from "@/domains/dashboard/weekly-health";
import { getRevenueDashboard } from "@/domains/billing";
import { businessDateFromKey } from "@/lib/business-date";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";

// AR-0b (TODAY 2): Money in counts from Monday 00:00 Colorado time; Overdue uses the one shared past-due rule.
describe.skipIf(!enabled)("Today's weekly health numbers", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const userId = `wh-user-${tag}`;
  const customerId = `wh-customer-${tag}`;
  const receiptIds: string[] = [];

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `wh-${tag}@example.test`, name: "Weekly Health", role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `WH${tag}` } });
  });
  afterAll(async () => {
    await prisma.receipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function moneyInDelta(now: Date, receivedOn: Date, cents: number): Promise<number> {
    const before = await getWeeklyHealth(now);
    const receipt = await prisma.receipt.create({ data: { customerId, source: "MANUAL", amountCents: cents, method: "check", receivedOn } });
    receiptIds.push(receipt.id);
    const after = await getWeeklyHealth(now);
    return after.moneyInCents - before.moneyInCents;
  }

  it.each([
    // [label, now, Monday 00:00 Colorado of that week]
    ["an ordinary week", "2026-10-28T18:00:00Z", "2026-10-26"],
    ["the week clocks go forward (Mar 8)", "2026-03-11T18:00:00Z", "2026-03-09"],
    ["the week clocks go back (Nov 1 is a Sunday; next week starts Nov 2)", "2026-11-04T18:00:00Z", "2026-11-02"],
    ["the New Year week", "2027-01-01T18:00:00Z", "2026-12-28"],
  ])("money in starts at Monday 00:00 Colorado time — %s", async (_label, nowIso, mondayKey) => {
    const now = new Date(nowIso);
    const monday = businessDateFromKey(mondayKey)!;
    expect(await moneyInDelta(now, new Date(monday.getTime() - 60_000), 1111)).toBe(0); // Sunday 23:59
    expect(await moneyInDelta(now, monday, 2222)).toBe(2222); // Monday 00:00
  });

  it("overdue equals the revenue dashboard's past-due count; due today is not late yet, due yesterday is", async () => {
    const now = new Date();
    const today = businessDateFromKey(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(now))!;
    const yesterday = new Date(today.getTime() - 86_400_000);
    const start = await getWeeklyHealth(now);
    await prisma.invoice.create({ data: { customerId, status: "OPEN", dueDate: today, amountDueCents: 5000 } });
    const afterToday = await getWeeklyHealth(now);
    expect(afterToday.overdueBills).toBe(start.overdueBills);
    await prisma.invoice.create({ data: { customerId, status: "OPEN", dueDate: yesterday, amountDueCents: 5000 } });
    const [health, revenue] = await Promise.all([getWeeklyHealth(now), getRevenueDashboard(now)]);
    expect(health.overdueBills).toBe(start.overdueBills + 1);
    expect(health.overdueBills).toBe(revenue.pastDueInvoiceCount);
  });
});
