import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { assessCashReceipt8300, FORM_8300_THRESHOLD_CENTS } from "@/domains/compliance/form-8300";
import { recordManualPayment } from "@/domains/billing/manual-payments";

// Disposable CI Postgres only (same gate as the other integration tests).
const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const enabled =
  process.env.CI === "true" &&
  url !== null &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const day = (s: string) => businessDateFromKey(s)!;

describe.skipIf(!enabled)("form 8300 detector", () => {
  const tag = randomUUID().slice(0, 8);
  const customerUser = `cmp3-u1-${tag}`;
  const otherUser = `cmp3-u2-${tag}`;
  const customer = `cmp3-c1-${tag}`;
  const otherCustomer = `cmp3-c2-${tag}`;
  const thirdUser = `cmp3-u3-${tag}`;
  const thirdCustomer = `cmp3-c3-${tag}`;
  const invoiceId = `cmp3-inv-${tag}`;
  const receiptIds: string[] = [];
  let ownerId: string;

  async function receipt(id: string, custId: string, cents: number, on: string, method = "CASH") {
    await prisma.receipt.create({
      data: { id, customerId: custId, source: "MANUAL", method, amountCents: cents, receivedOn: day(on) },
    });
    receiptIds.push(id);
    return prisma.$transaction((tx) =>
      assessCashReceipt8300(tx, { id, customerId: custId, receivedOn: day(on) }),
    );
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.user.createMany({
      data: [
        { id: customerUser, email: `${customerUser}@example.test`, role: "CUSTOMER" },
        { id: otherUser, email: `${otherUser}@example.test`, role: "CUSTOMER" },
        { id: thirdUser, email: `${thirdUser}@example.test`, role: "CUSTOMER" },
      ],
    });
    await prisma.customer.createMany({
      data: [
        { id: customer, userId: customerUser, referralCode: `C3A${tag}`.toUpperCase() },
        { id: otherCustomer, userId: otherUser, referralCode: `C3B${tag}`.toUpperCase() },
        { id: thirdCustomer, userId: thirdUser, referralCode: `C3C${tag}`.toUpperCase() },
      ],
    });
  });

  afterAll(async () => {
    await prisma.complianceFiling.deleteMany({ where: { obligationKey: "fed.8300" } });
    await prisma.payment.deleteMany({ where: { invoiceId } });
    await prisma.receipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.invoice.deleteMany({ where: { id: invoiceId } });
    await prisma.customer.deleteMany({ where: { id: { in: [customer, otherCustomer, thirdCustomer] } } });
    await prisma.user.deleteMany({ where: { id: { in: [customerUser, otherUser, thirdUser] } } });
  });

  it("creates exactly one filing when related cash crosses $10,000 within 12 months", async () => {
    expect(FORM_8300_THRESHOLD_CENTS).toBe(1_000_000);
    expect((await receipt(`cmp3-r1-${tag}`, customer, 600000, "2026-02-01")).created).toBe(false);
    // A check does not count toward the cash total.
    expect((await receipt(`cmp3-r2-${tag}`, customer, 900000, "2026-03-01", "CHECK")).created).toBe(false);
    // Another customer's cash does not count either.
    expect((await receipt(`cmp3-r3-${tag}`, otherCustomer, 900000, "2026-03-02")).created).toBe(false);

    const crossing = await receipt(`cmp3-r4-${tag}`, customer, 450000, "2026-06-01");
    expect(crossing.created).toBe(true);
    const filing = await prisma.complianceFiling.findFirstOrThrow({ where: { obligationKey: "fed.8300" } });
    expect(filing.periodKey).toBe(`8300-cmp3-r4-${tag}`);
    expect(filing.dueOn.toISOString().slice(0, 10)).toBe("2026-06-16");
    const data = filing.preparedData as { totalCashCents: number };
    expect(data.totalCashCents).toBe(1050000);

    // More cash while already over the line does not file again.
    expect((await receipt(`cmp3-r5-${tag}`, customer, 200000, "2026-07-01")).created).toBe(false);
    expect(await prisma.complianceFiling.count({ where: { obligationKey: "fed.8300" } })).toBe(1);
    // Replaying the crossing receipt is idempotent.
    const replay = await prisma.$transaction((tx) =>
      assessCashReceipt8300(tx, { id: `cmp3-r4-${tag}`, customerId: customer, receivedOn: day("2026-06-01") }),
    );
    expect(replay.created).toBe(false);
  });

  it("a cash payment recorded at the desk triggers the filing end to end", async () => {
    await prisma.invoice.create({
      data: { id: invoiceId, customerId: otherCustomer, status: "OPEN", amountDueCents: 1100000 },
    });
    const result = await recordManualPayment(otherCustomer, ownerId, {
      amountCents: 1100000,
      method: "cash",
      invoiceId,
      receivedOn: day("2026-08-10"),
    });
    expect(result.totalAppliedCents).toBe(1100000);
    const receipt = await prisma.receipt.findFirstOrThrow({
      where: { customerId: otherCustomer, amountCents: 1100000 },
    });
    receiptIds.push(receipt.id);
    const filing = await prisma.complianceFiling.findFirst({
      where: { obligationKey: "fed.8300", periodKey: `8300-${receipt.id}` },
    });
    expect(filing).not.toBeNull();
    expect(filing!.dueOn.toISOString().slice(0, 10)).toBe("2026-08-25");
  });

  it("the count restarts after a report: the next $10,000 of cash files again (PR #656 review)", async () => {
    expect((await receipt(`cmp3-r6-${tag}`, thirdCustomer, 1100000, "2026-01-10")).created).toBe(true);
    // The first $6,000 after the report starts the new count — no filing yet.
    expect((await receipt(`cmp3-r7-${tag}`, thirdCustomer, 600000, "2026-02-10")).created).toBe(false);
    // The second $6,000 crosses on the new count alone.
    const crossing = await receipt(`cmp3-r8-${tag}`, thirdCustomer, 600000, "2026-03-10");
    expect(crossing.created).toBe(true);
    const filing = await prisma.complianceFiling.findFirstOrThrow({
      where: { obligationKey: "fed.8300", periodKey: `8300-cmp3-r8-${tag}` },
    });
    expect((filing.preparedData as { totalCashCents: number }).totalCashCents).toBe(1200000);
  });

  it("the 15-day deadline counts Denver calendar days across the DST change (PR #656 review)", async () => {
    // The first customer's count restarted at its June filing; $2,000 came
    // in July, so this $11,000 crosses on the new count. Received Oct 25,
    // the deadline is Nov 9 — not Nov 8 (UTC-day addition across Nov 1).
    const crossing = await receipt(`cmp3-r9-${tag}`, customer, 1100000, "2026-10-25");
    expect(crossing.created).toBe(true);
    const filing = await prisma.complianceFiling.findFirstOrThrow({
      where: { obligationKey: "fed.8300", periodKey: `8300-cmp3-r9-${tag}` },
    });
    expect((filing.preparedData as { dueBy: string }).dueBy).toBe("2026-11-09");
    expect(filing.dueOn.toISOString()).toBe(day("2026-11-09").toISOString());
  });
});
