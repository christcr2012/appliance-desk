import type { Prisma } from "@prisma/client";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

/**
 * CMP-3 — the Form 8300 detector.
 *
 * Federal law (the compliance research file): a business that receives
 * more than $10,000 in cash from one buyer in a single or related
 * transactions must file Form 8300 within 15 days. "Related" includes
 * payments within a 12-month window that are part of one arrangement, so
 * the detector watches the trailing 12 months per customer: the receipt
 * that pushes the counted cash total from at-or-under $10,000 to over
 * it creates the filing (once — the filing's period key is the triggering
 * receipt, so replays and double hooks cannot duplicate it).
 *
 * After a filing, the count restarts (IRS Form 8300 reference guide):
 * receipts already reported are not counted again, and the next batch of
 * cash files a new Form 8300 when it crosses $10,000 on its own. The
 * filing surfaces immediately through the COMPLIANCE_DUE To do.
 */

export const FORM_8300_THRESHOLD_CENTS = 1_000_000; // $10,000
export const FORM_8300_FILING_DAYS = 15;

type Tx = Prisma.TransactionClient;

/** Adds calendar days to a business-date key (Denver), never UTC days to an instant — DST-safe. */
function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

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
    orderBy: [{ receivedOn: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, amountCents: true },
  });

  // Receipts already covered by an earlier filing do not count again:
  // find this customer's latest reported (triggering) receipt and count
  // only what arrived after it.
  const priorFilings = await tx.complianceFiling.findMany({
    where: { obligationKey: "fed.8300" },
    select: { preparedData: true },
  });
  const triggerIds = new Set<string>();
  for (const filing of priorFilings) {
    const data = (filing.preparedData ?? {}) as { triggerReceiptId?: string; customerId?: string };
    if (data.customerId === receipt.customerId && data.triggerReceiptId) triggerIds.add(data.triggerReceiptId);
  }
  let counted = cashReceipts;
  if (triggerIds.size > 0) {
    let lastReportedIndex = -1;
    cashReceipts.forEach((r, i) => {
      if (triggerIds.has(r.id)) lastReportedIndex = i;
    });
    if (lastReportedIndex >= 0) counted = cashReceipts.slice(lastReportedIndex + 1);
  }

  const total = counted.reduce((n, r) => n + r.amountCents, 0);
  const thisReceipt = counted.find((r) => r.id === receipt.id);
  if (!thisReceipt) return { created: false };
  const priorTotal = total - thisReceipt.amountCents;
  if (total <= FORM_8300_THRESHOLD_CENTS || priorTotal > FORM_8300_THRESHOLD_CENTS) {
    return { created: false };
  }
  const receivedKey = businessDateKey(receipt.receivedOn);
  const dueKey = addDaysToKey(receivedKey, FORM_8300_FILING_DAYS);
  const dueOn = businessDateFromKey(dueKey);
  if (!dueOn) return { created: false };
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
        receivedOn: receivedKey,
        dueBy: dueKey,
      },
    },
  });
  return { created: true };
}
