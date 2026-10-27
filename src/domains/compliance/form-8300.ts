import type { Prisma } from "@prisma/client";
import { businessDateKey } from "@/lib/business-date";

/**
 * CMP-3 — the Form 8300 detector.
 *
 * Federal law (the compliance research file): a business that receives
 * more than $10,000 in cash from one buyer in a single or related
 * transactions must file Form 8300 within 15 days. "Related" includes
 * payments within a 12-month window that are part of one arrangement, so
 * the detector watches the trailing 12 months per customer: the receipt
 * that pushes the window's cash total from at-or-under $10,000 to over
 * it creates the filing (once — the filing's period key is the triggering
 * receipt, so replays and double hooks cannot duplicate it). The filing
 * surfaces immediately through the COMPLIANCE_DUE To do.
 */

export const FORM_8300_THRESHOLD_CENTS = 1_000_000; // $10,000
export const FORM_8300_FILING_DAYS = 15;

type Tx = Prisma.TransactionClient;

export async function assessCashReceipt8300(
  tx: Tx,
  receipt: { id: string; customerId: string; receivedOn: Date },
): Promise<{ created: boolean }> {
  const windowStart = new Date(receipt.receivedOn);
  windowStart.setUTCFullYear(windowStart.getUTCFullYear() - 1);
  const cashReceipts = await tx.receipt.findMany({
    where: {
      customerId: receipt.customerId,
      method: { equals: "cash", mode: "insensitive" },
      receivedOn: { gt: windowStart, lte: receipt.receivedOn },
    },
    select: { id: true, amountCents: true },
  });
  const total = cashReceipts.reduce((n, r) => n + r.amountCents, 0);
  const thisReceipt = cashReceipts.find((r) => r.id === receipt.id);
  if (!thisReceipt) return { created: false };
  const priorTotal = total - thisReceipt.amountCents;
  if (total <= FORM_8300_THRESHOLD_CENTS || priorTotal > FORM_8300_THRESHOLD_CENTS) {
    return { created: false };
  }
  const dueOn = new Date(receipt.receivedOn);
  dueOn.setUTCDate(dueOn.getUTCDate() + FORM_8300_FILING_DAYS);
  const existing = await tx.complianceFiling.findUnique({
    where: { obligationKey_periodKey: { obligationKey: "fed.8300", periodKey: `8300-${receipt.id}` } },
    select: { id: true },
  });
  if (existing) return { created: false };
  await tx.complianceFiling.create({
    data: {
      obligationKey: "fed.8300",
      periodKey: `8300-${receipt.id}`,
      state: "UPCOMING",
      dueOn,
      actOn: receipt.receivedOn,
      preparedData: {
        triggerReceiptId: receipt.id,
        customerId: receipt.customerId,
        totalCashCents: total,
        windowStart: businessDateKey(windowStart),
        receivedOn: businessDateKey(receipt.receivedOn),
        dueBy: businessDateKey(dueOn),
      },
    },
  });
  return { created: true };
}
