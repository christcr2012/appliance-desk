import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";

export type ReceiptBackfillResult = {
  paymentsLinked: number;
  receiptsCreated: number;
  failedAttemptsSkipped: number;
};

const SUCCESS_STATUSES = ["succeeded", "SUCCEEDED"];

/**
 * Link historical successful Payment allocations to Receipt rows. Failed
 * attempts are deliberately excluded: they are evidence of a charge attempt,
 * not evidence that money moved. Old data used both `succeeded` and
 * `SUCCEEDED`, so the backfill recognizes both without rewriting history.
 */
export async function backfillReceipts(
  client: PrismaClient,
): Promise<ReceiptBackfillResult> {
  const candidates = await client.payment.findMany({
    where: { receiptId: null, status: { in: SUCCESS_STATUSES } },
    select: {
      id: true,
      amountCents: true,
      method: true,
      stripeChargeId: true,
      stripePaymentIntentId: true,
      recordedByUserId: true,
      notes: true,
      createdAt: true,
      invoice: { select: { customerId: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const failedAttemptsSkipped = await client.payment.count({
    where: { receiptId: null, status: { notIn: SUCCESS_STATUSES } },
  });

  const groups = new Map<string, typeof candidates>();
  for (const payment of candidates) {
    const key = payment.stripeChargeId
      ? `charge:${payment.stripeChargeId}`
      : `payment:${payment.id}`;
    const group = groups.get(key) ?? [];
    group.push(payment);
    groups.set(key, group);
  }

  let paymentsLinked = 0;
  let receiptsCreated = 0;

  for (const originalGroup of groups.values()) {
    const ids = originalGroup.map((payment) => payment.id);
    await client.$transaction(async (tx) => {
      const group = await tx.payment.findMany({
        where: {
          id: { in: ids },
          receiptId: null,
          status: { in: SUCCESS_STATUSES },
        },
        select: {
          id: true,
          amountCents: true,
          method: true,
          stripeChargeId: true,
          stripePaymentIntentId: true,
          recordedByUserId: true,
          notes: true,
          createdAt: true,
          invoice: { select: { customerId: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (group.length === 0) return;

      const customerIds = new Set(
        group.map((payment) => payment.invoice.customerId),
      );
      if (customerIds.size !== 1) {
        throw new Error(
          `Cannot backfill one receipt across multiple customers: ${group.map((p) => p.id).join(", ")}`,
        );
      }

      const hasProviderIdentity = group.some(
        (payment) => payment.stripeChargeId || payment.stripePaymentIntentId,
      );
      const source = hasProviderIdentity ? "STRIPE" : "MANUAL";
      const stripeChargeId = group[0]?.stripeChargeId ?? null;
      const amountCents = group.reduce(
        (sum, payment) => sum + payment.amountCents,
        0,
      );
      const customerId = group[0]!.invoice.customerId;
      let receipt = stripeChargeId
        ? await tx.receipt.findUnique({
            where: { stripeChargeId },
            select: { id: true, customerId: true, amountCents: true },
          })
        : null;

      if (receipt) {
        if (
          receipt.customerId !== customerId ||
          receipt.amountCents !== amountCents
        ) {
          throw new Error(
            `Existing receipt for ${stripeChargeId} disagrees with historical payment allocations.`,
          );
        }
      } else {
        receipt = await tx.receipt.create({
          data: {
            customerId,
            source,
            amountCents,
            method: group[0]?.method ?? "other",
            stripeChargeId,
            // Historical rows do not retain Stripe's original charge-created
            // timestamp. Payment.createdAt is the best local evidence for old
            // data; all new Stripe receipts use the provider charge timestamp.
            receivedOn: group[0]!.createdAt,
            recordedByUserId:
              source === "MANUAL" ? group[0]?.recordedByUserId ?? null : null,
            notes: `Backfilled from pre-Batch-B Payment row(s): ${group.map((payment) => payment.id).join(", ")}`,
          },
          select: { id: true, customerId: true, amountCents: true },
        });
        receiptsCreated += 1;
      }

      const updated = await tx.payment.updateMany({
        where: {
          id: { in: group.map((payment) => payment.id) },
          receiptId: null,
        },
        data: { receiptId: receipt.id },
      });
      paymentsLinked += updated.count;
    });
  }

  return { paymentsLinked, receiptsCreated, failedAttemptsSkipped };
}

async function main() {
  if (!process.argv.includes("--confirm")) {
    throw new Error(
      "Refusing to backfill receipts without the explicit --confirm flag.",
    );
  }
  const { prisma } = await import("../src/lib/prisma");
  try {
    const result = await backfillReceipts(prisma);
    console.log(
      `[receipt-backfill] linked ${result.paymentsLinked} successful payment allocation(s) to ${result.receiptsCreated} new receipt(s); left ${result.failedAttemptsSkipped} non-successful attempt(s) without receipts.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
