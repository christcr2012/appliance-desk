import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getBillTimeline } from "@/domains/billing/bill-timeline";

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

// AR-3 (MONEY-AREA 3): the bill timeline gathers every money event for one bill, newest first, with the
// person who recorded it named (or "automatic").
describe.skipIf(!enabled)("Bill timeline reads", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const staffId = `bt-s-${tag}`;
  const userId = `bt-u-${tag}`;
  const customerId = `bt-c-${tag}`;
  let invoiceId = "";
  const at = (day: number, hour = 10) => new Date(Date.UTC(2026, 9, day, hour));

  beforeAll(async () => {
    await prisma.user.create({ data: { id: staffId, email: `bts-${tag}@example.test`, name: `Staff ${tag}`, role: "STAFF" } });
    await prisma.user.create({ data: { id: userId, email: `bt-${tag}@example.test`, name: `Tessa ${tag}`, role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `BT${tag}`.slice(0, 30) } });
    const invoice = await prisma.invoice.create({
      data: { customerId, status: "OPEN", amountDueCents: 9000, createdAt: at(1) },
    });
    invoiceId = invoice.id;
    await prisma.payment.create({
      data: { invoiceId, amountCents: 3000, method: "card", status: "succeeded", createdAt: at(3), recordedByUserId: staffId },
    });
    await prisma.payment.create({
      data: { invoiceId, amountCents: 3000, method: "card", status: "failed", createdAt: at(2), failureReason: "card_declined" },
    });
    await prisma.payment.create({
      data: { invoiceId, amountCents: 2500, method: "card", status: "held", createdAt: at(4) },
    });
    await prisma.payment.create({
      data: { invoiceId, amountCents: 1500, method: "card", status: "held_to_credit", createdAt: at(5) },
    });
    await prisma.refund.create({
      data: { invoiceId, amountCents: 500, reason: "GOODWILL", createdAt: at(6), authorizedByUserId: staffId },
    });
    const credit = await prisma.customerCredit.create({
      data: { customerId, amountCents: 2000, remainingCents: 0, reason: "Goodwill", authorizedByUserId: staffId },
    });
    await prisma.creditApplication.create({
      data: { creditId: credit.id, invoiceId, amountCents: 2000, createdAt: at(7), appliedByUserId: staffId },
    });
    await prisma.auditLog.create({
      data: {
        userId: staffId,
        action: "billing.phone_payment_started",
        entityType: "Invoice",
        entityId: invoiceId,
        createdAt: at(8),
      },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: invoiceId } });
    await prisma.creditApplication.deleteMany({ where: { invoiceId } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.refund.deleteMany({ where: { invoiceId } });
    await prisma.payment.deleteMany({ where: { invoiceId } });
    await prisma.invoice.deleteMany({ where: { id: invoiceId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, staffId] } } });
  });

  it("lists every event newest first with the spec's words and actors", async () => {
    const items = await getBillTimeline(invoiceId);
    expect(items.map((i) => i.title)).toEqual([
      "Phone payment page opened",
      "Paid with credit · $20.00",
      "Refunded · $5.00",
      "Payment kept as credit · $15.00",
      "Payment held for your decision",
      "Payment received · $30.00",
      "Payment failed · $30.00",
      "Bill created",
    ]);
    const received = items.find((i) => i.title.startsWith("Payment received"))!;
    expect(received).toMatchObject({ tone: "good", actor: `Staff ${tag}` });
    const failed = items.find((i) => i.title.startsWith("Payment failed"))!;
    expect(failed).toMatchObject({ tone: "attention", actor: "automatic" });
    const held = items.find((i) => i.title === "Payment held for your decision")!;
    expect(held.tone).toBe("attention");
    expect(items[0].actor).toBe(`Staff ${tag}`);
  });

  it("an unknown bill has no timeline", async () => {
    expect(await getBillTimeline(`missing-${tag}`)).toEqual([]);
  });
});
