import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getCustomerStatement } from "@/domains/billing/statements";
import {
  SUCCESSFUL_PAYMENT_STATUSES,
  isSuccessfulPaymentStatus,
} from "@/domains/billing/payment-status";

describe("which payment statuses count as money received", () => {
  it("accepts both historical spellings and nothing else", () => {
    expect([...SUCCESSFUL_PAYMENT_STATUSES].sort()).toEqual(["SUCCEEDED", "succeeded"]);
    expect(isSuccessfulPaymentStatus("succeeded")).toBe(true);
    expect(isSuccessfulPaymentStatus("SUCCEEDED")).toBe(true);
    expect(isSuccessfulPaymentStatus("failed")).toBe(false);
    expect(isSuccessfulPaymentStatus("pending")).toBe(false);
    expect(isSuccessfulPaymentStatus(null)).toBe(false);
  });
});

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("statement balances for customers whose old payments use the capitalised spelling", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const userId = `legacy-user-${tag}`;
  const customerId = `legacy-cust-${tag}`;
  const invoiceId = `legacy-inv-${tag}`;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `${tag}@example.test`, name: "Legacy Customer", role: "CUSTOMER", emailVerified: true },
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `L${tag}` } });
    await prisma.invoice.create({
      data: {
        id: invoiceId,
        customerId,
        status: "PAID",
        billingPeriodStart: new Date("2026-08-01T06:00:00Z"),
        billingPeriodEnd: new Date("2026-09-01T06:00:00Z"),
        dueDate: new Date("2026-08-05T06:00:00Z"),
        subtotalCents: 4000,
        amountDueCents: 4000,
        amountPaidCents: 4000,
        payments: {
          create: [
            { amountCents: 3000, method: "check", status: "SUCCEEDED" },
            { amountCents: 1000, method: "cash", status: "succeeded" },
            { amountCents: 2500, method: "card", status: "failed" },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { invoiceId } });
    await prisma.invoice.deleteMany({ where: { id: invoiceId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("counts both spellings, ignores the failed attempt, and the statement still adds up", async () => {
    const statement = await getCustomerStatement(customerId);
    expect(statement?.reconciliation.balanced).toBe(true);
  });
});
