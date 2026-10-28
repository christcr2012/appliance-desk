import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordManualPayment } from "@/domains/billing/manual-payments";

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

// AR-3 (MONEY-AREA 4): the Record cash or check sheet's locked invoice — recording from the newer of two
// open bills pays the newer one and leaves the older one untouched (the un-locked form would spread
// oldest-first). The server path is unchanged: recordManualPayment already honors an explicit invoiceId.
describe.skipIf(!enabled)("Record payment locked to one bill", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const ownerId = `rp-o-${tag}`;
  const userId = `rp-u-${tag}`;
  const customerId = `rp-c-${tag}`;
  let olderId = "";
  let newerId = "";

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerId, email: `rpo-${tag}@example.test`, name: `Owner ${tag}`, role: "OWNER" } });
    await prisma.user.create({ data: { id: userId, email: `rp-${tag}@example.test`, name: `Payer ${tag}`, role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `RP${tag}`.slice(0, 30) } });
    const older = await prisma.invoice.create({
      data: { customerId, status: "OPEN", dueDate: new Date("2026-10-01T12:00:00Z"), amountDueCents: 5000, amountPaidCents: 0 },
    });
    const newer = await prisma.invoice.create({
      data: { customerId, status: "OPEN", dueDate: new Date("2026-11-01T12:00:00Z"), amountDueCents: 7000, amountPaidCents: 0 },
    });
    olderId = older.id;
    newerId = newer.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: { in: [userId, ownerId] } } });
    await prisma.payment.deleteMany({ where: { invoice: { customerId } } });
    await prisma.receipt.deleteMany({ where: { customerId } });
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, ownerId] } } });
  });

  it("pays only the locked bill", async () => {
    const result = await recordManualPayment(customerId, ownerId, {
      amountCents: 7000,
      method: "check",
      invoiceId: newerId,
      receivedOn: new Date("2026-10-28T12:00:00Z"),
    });
    expect(result.totalAppliedCents).toBe(7000);
    expect(result.overpaymentCents).toBe(0);
    expect(result.invoicesTouched.map((t) => t.invoiceId)).toEqual([newerId]);
    const newer = await prisma.invoice.findUniqueOrThrow({ where: { id: newerId } });
    const older = await prisma.invoice.findUniqueOrThrow({ where: { id: olderId } });
    expect(newer).toMatchObject({ amountPaidCents: 7000, status: "PAID" });
    expect(older).toMatchObject({ amountPaidCents: 0, status: "OPEN" });
  });
});
