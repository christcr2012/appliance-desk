import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createReceiptWithAllocations } from "@/domains/billing/ledger";
import { writeOffInvoice } from "@/domains/billing/manual-payments";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe.skipIf(!enabled)("invoice payment/write-off race in disposable Postgres", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `writeoff-user-${tag}`;
  const ownerId = `writeoff-owner-${tag}`;
  const customerId = `writeoff-customer-${tag}`;
  const invoiceId = `writeoff-invoice-${tag}`;

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { invoiceId } });
    await prisma.receipt.deleteMany({ where: { customerId } });
    await prisma.auditLog.deleteMany({ where: { entityId: invoiceId } });
    await prisma.invoice.deleteMany({ where: { id: invoiceId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, ownerId] } } });
  });

  it("a payment that has locked the invoice cannot be overwritten by a racing write-off", async () => {
    await prisma.user.createMany({
      data: [
        {
          id: userId,
          email: `${tag}-customer@example.test`,
          name: "Writeoff Race Customer",
          role: "CUSTOMER",
          emailVerified: true,
        },
        {
          id: ownerId,
          email: `${tag}-owner@example.test`,
          name: "Writeoff Race Owner",
          role: "OWNER",
          emailVerified: true,
        },
      ],
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        userId,
        referralCode: `W${tag.slice(0, 18)}`,
      },
    });
    await prisma.invoice.create({
      data: {
        id: invoiceId,
        customerId,
        status: "OPEN",
        subtotalCents: 10_000,
        amountDueCents: 10_000,
        amountPaidCents: 0,
      },
    });

    const invoiceLocked = deferred();
    const allowPayment = deferred();

    const payment = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "Invoice"
          WHERE "id" = ${invoiceId}
          FOR UPDATE
        `;
        invoiceLocked.resolve();
        await allowPayment.promise;
        await createReceiptWithAllocations(tx, {
          customerId,
          source: "MANUAL",
          amountCents: 10_000,
          method: "cash",
          receivedOn: new Date("2026-10-02T18:00:00Z"),
          recordedByUserId: ownerId,
          allocations: [{ invoiceId, amountCents: 10_000 }],
        });
      },
      { timeout: 10_000 },
    );

    await invoiceLocked.promise;
    const writeoff = writeOffInvoice(invoiceId, ownerId, "Concurrent uncollectible test");

    // The write-off is now waiting on the same row lock. Let the payment commit
    // first; writeOffInvoice must then re-read the locked current state rather
    // than applying a decision made from the old OPEN snapshot.
    await new Promise((resolve) => setTimeout(resolve, 50));
    allowPayment.resolve();

    const [paymentResult, writeoffResult] = await Promise.allSettled([
      payment,
      writeoff,
    ]);
    expect(paymentResult.status).toBe("fulfilled");
    expect(writeoffResult.status).toBe("rejected");
    if (writeoffResult.status === "rejected") {
      expect(String(writeoffResult.reason)).toMatch(/already fully paid/i);
    }

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.status).toBe("PAID");
    expect(invoice.amountPaidCents).toBe(10_000);
    expect(invoice.writtenOffAt).toBeNull();
  });
});
