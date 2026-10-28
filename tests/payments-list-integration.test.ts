import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPaymentCounts, getPayments } from "@/domains/billing/payments-list";

let target: URL | null = null;
try {
  target = new URL(process.env.DATABASE_URL ?? "");
} catch {
  target = null;
}
const enabled =
  process.env.CI === "true" &&
  target !== null &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

// AR-3 (MONEY-AREA 2): every query is narrowed by this suite's unique customer name, so other suites'
// payments never interfere.
describe.skipIf(!enabled)("Payments list reads", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const userId = `pl-u-${tag}`;
  const customerId = `pl-c-${tag}`;
  const manyUserId = `pl-mu-${tag}`;
  const manyCustomerId = `pl-mc-${tag}`;
  let invoiceId = "";
  let manyInvoiceId = "";
  let invoiceNumber = 0;
  const payIds: Record<string, string> = {};

  const pay = async (key: string, data: { status: string; amountCents?: number; method?: string; createdAt?: Date; onMany?: boolean }) => {
    const row = await prisma.payment.create({
      data: {
        invoiceId: data.onMany ? manyInvoiceId : invoiceId,
        amountCents: data.amountCents ?? 4500,
        method: data.method ?? "card",
        status: data.status,
        ...(data.createdAt ? { createdAt: data.createdAt } : {}),
        ...(data.status.startsWith("failed") || data.status === "FAILED" ? { failureReason: "card_declined" } : {}),
      },
    });
    payIds[key] = row.id;
  };

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `pl-${tag}@example.test`, name: `Payer First ${tag}`, role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `PL${tag}`.slice(0, 30) } });
    await prisma.user.create({ data: { id: manyUserId, email: `plm-${tag}@example.test`, name: `Payer Many ${tag}`, role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: manyCustomerId, userId: manyUserId, referralCode: `PM${tag}`.slice(0, 30) } });
    const invoice = await prisma.invoice.create({ data: { customerId, status: "OPEN", amountDueCents: 4500 } });
    invoiceId = invoice.id;
    invoiceNumber = invoice.invoiceNumber;
    manyInvoiceId = (await prisma.invoice.create({ data: { customerId: manyCustomerId, status: "OPEN", amountDueCents: 4500 } })).id;

    await pay("ok-lower", { status: "succeeded", createdAt: new Date("2026-10-20T10:00:00Z") });
    await pay("ok-upper", { status: "SUCCEEDED", createdAt: new Date("2026-10-21T10:00:00Z") });
    await pay("bad-lower", { status: "failed" });
    await pay("bad-upper", { status: "FAILED" });
    await pay("held", { status: "held" });
    await pay("conflict", { status: "held_conflict" });
    await pay("decided-credit", { status: "held_to_credit" });
    await pay("decided-refund", { status: "held_refunded" });
    await pay("cash-ok", { status: "succeeded", method: "cash", amountCents: 1200 });
    for (let i = 0; i < 5; i++) {
      await pay(`many-${i}`, { status: "succeeded", onMany: true, createdAt: new Date(Date.UTC(2026, 9, 10 + i, 10)) });
    }
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { invoice: { customerId: { in: [customerId, manyCustomerId] } } } });
    await prisma.invoice.deleteMany({ where: { customerId: { in: [customerId, manyCustomerId] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [customerId, manyCustomerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, manyUserId] } } });
  });

  const rowsFor = (status: "received" | "failed" | "held", extra: object = {}) =>
    getPayments({ status, q: `first ${tag}`, sort: "newest", pageSize: 50, ...extra });

  it("each tab lists exactly its statuses; decided held payments appear nowhere", async () => {
    expect((await rowsFor("received")).rows.map((r) => r.id).sort()).toEqual([payIds["ok-lower"], payIds["ok-upper"], payIds["cash-ok"]].sort());
    expect((await rowsFor("failed")).rows.map((r) => r.id).sort()).toEqual([payIds["bad-lower"], payIds["bad-upper"]].sort());
    expect((await rowsFor("held")).rows.map((r) => r.id).sort()).toEqual([payIds.held, payIds.conflict].sort());
  });

  it("counts match the rows, and the received sum is the received rows only", async () => {
    const counts = await getPaymentCounts({ status: "received", q: tag, sort: "newest" });
    expect(counts.received).toBe(3 + 5); // this suite's two customers both match the tag search
    expect(counts.failed).toBe(2);
    expect(counts.held).toBe(2);
    expect(counts.receivedSumCents).toBe(4500 + 4500 + 1200 + 5 * 4500);
  });

  it("searches by bill number and filters by method", async () => {
    const byNumber = await getPayments({ status: "received", q: String(invoiceNumber), sort: "newest" });
    expect(byNumber.rows.map((r) => r.id).sort()).toEqual([payIds["ok-lower"], payIds["ok-upper"], payIds["cash-ok"]].sort());
    const cashOnly = await rowsFor("received", { method: ["cash"] });
    expect(cashOnly.rows.map((r) => r.id)).toEqual([payIds["cash-ok"]]);
    const first = byNumber.rows.find((r) => r.id === payIds["ok-lower"])!;
    expect(first).toMatchObject({ invoiceNumber, customerName: `Payer First ${tag}`, amountCents: 4500 });
  });

  it("the cursor window grows without repeats or gaps (KIT 5.1: each render is the whole window)", async () => {
    const lengths: number[] = [];
    let cursor: string | undefined;
    let lastRows: string[] = [];
    for (let page = 0; page < 3; page++) {
      const result = await getPayments({ status: "received", q: `many ${tag}`, sort: "oldest", pageSize: 2, cursor });
      lengths.push(result.rows.length);
      lastRows = result.rows.map((r) => r.id);
      expect(new Set(lastRows).size).toBe(lastRows.length);
      cursor = result.nextCursor ?? undefined;
      if (page < 2) expect(result.nextCursor).not.toBeNull();
    }
    expect(cursor).toBeUndefined();
    expect(lengths).toEqual([2, 4, 5]);
    expect(lastRows).toEqual([payIds["many-0"], payIds["many-1"], payIds["many-2"], payIds["many-3"], payIds["many-4"]]);
  });
});
