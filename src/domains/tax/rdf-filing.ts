import { Prisma } from "@prisma/client";
import { addBusinessDays } from "@/lib/business-date";

/** RDF is a separate statutory return: it is not a sales-tax jurisdiction. */
export type RdfPacket = {
  version: 1;
  periodId: string;
  deliveries: number;
  rows: Array<{ rateId: string; amountCents: number; count: number; totalCents: number }>;
  priorPeriodCreditCents: number;
  taxDueCents: number;
  sourceRecordIds: string[];
  /** Frozen money and collection evidence survive later NOT_DUE corrections. */
  sourceAmountCents: Record<string, number>;
  sourceCollectedFromCustomer: Record<string, boolean>;
  creditRecordIds: string[];
  blockers: string[];
};

type Tx = Prisma.TransactionClient;

async function lockPeriod(tx: Tx, periodId: string) {
  const ids = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "TaxFilingPeriod" WHERE "id" = ${periodId} FOR UPDATE
  `;
  if (!ids.length) throw new Error("Retail delivery fee filing period does not exist.");
  const period = await tx.taxFilingPeriod.findUniqueOrThrow({
    where: { id: periodId }, include: { filingAccount: { select: { kind: true } } },
  });
  if (period.filingAccount.kind !== "RETAIL_DELIVERY_FEE_RETURN")
    throw new Error("This is not a retail delivery fee filing period.");
  return period;
}

function originalRdfEvidence(value: unknown): Array<{
  id: string; cents: number; collected: boolean;
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const root = value as { rdf?: unknown };
  const packet = (root.rdf && typeof root.rdf === "object" && !Array.isArray(root.rdf)
    ? root.rdf : root) as Partial<RdfPacket>;
  if (!Array.isArray(packet.sourceRecordIds)) return [];
  return packet.sourceRecordIds.flatMap(id => {
    const cents = packet.sourceAmountCents?.[id];
    const collected = packet.sourceCollectedFromCustomer?.[id];
    return typeof id === "string" && typeof cents === "number" &&
        Number.isSafeInteger(cents) && cents >= 0 && typeof collected === "boolean"
      ? [{ id, cents, collected }] : [];
  });
}

type RdfSource = {
  id: string; status: string; amountCents: number | null; rateId: string | null;
  filingPeriodId: string | null;
  creditAppliedPeriodId: string | null;
  customerRefundedAt: Date | null; customerRefundRef: string | null;
  collectedFromCustomer: boolean | null;
  invoiceLineId: string | null; deliveredOn: Date;
};

/** Invoice refunds must be real persisted refund records, not owner-entered words. */
async function refundConfirmed(
  tx: Tx, record: RdfSource, cents: number, collected: boolean,
): Promise<boolean> {
  if (!collected) return true;
  if (!record.customerRefundedAt || !record.customerRefundRef ||
      !record.invoiceLineId || !cents) return false;
  const line = await tx.invoiceLineItem.findUnique({
    where: { id: record.invoiceLineId }, select: { invoiceId: true },
  });
  if (!line) return false;
  const refund = await tx.refund.findUnique({
    where: { id: record.customerRefundRef },
    select: { invoiceId: true, amountCents: true, createdAt: true },
  });
  return !!refund && refund.invoiceId === line.invoiceId &&
    refund.amountCents >= cents &&
    refund.createdAt.getTime() <= record.customerRefundedAt.getTime();
}

/**
 * Read-only packet preview. Includes unresolved deliveries as blockers, so
 * none silently fall out of a return. The delivered date selects the return;
 * the recorded sale date selected the frozen rate in T-6C2.
 */
export async function buildRdfPacketInTx(tx: Tx, periodId: string): Promise<RdfPacket> {
  const period = await tx.taxFilingPeriod.findUnique({
    where: { id: periodId }, include: { filingAccount: { select: { kind: true } } },
  });
  if (!period || period.filingAccount.kind !== "RETAIL_DELIVERY_FEE_RETURN")
    throw new Error("Retail delivery fee filing period was not found.");
  const endExclusive = addBusinessDays(period.periodEnd, 1);
  const sources = await tx.retailDeliveryFeeRecord.findMany({
    where: {
      deliveredOn: { gte: period.periodStart, lt: endExclusive },
    },
    select: {
      id: true, status: true, amountCents: true, rateId: true, filingPeriodId: true,
      collectedFromCustomer: true, invoiceLineId: true,
    },
    orderBy: [{ deliveredOn: "asc" }, { id: "asc" }],
  });
  const blockers: string[] = [];
  const rows = new Map<string, { rateId: string; amountCents: number; count: number; totalCents: number }>();
  const sourceRecordIds: string[] = [];
  const sourceAmountCents: Record<string, number> = {};
  const sourceCollectedFromCustomer: Record<string, boolean> = {};
  for (const record of sources) {
    if (record.status === "NOT_DUE") continue;
    if (record.status !== "READY" || !record.rateId ||
      record.amountCents === null || record.amountCents < 0) {
      blockers.push("Delivery fee " + record.id + " is awaiting a confirmed decision, date or rate.");
      continue;
    }
    if (record.filingPeriodId && record.filingPeriodId !== periodId) {
      blockers.push("Delivery fee " + record.id + " is reserved for another filing period.");
      continue;
    }
    sourceRecordIds.push(record.id);
    sourceAmountCents[record.id] = record.amountCents;
    sourceCollectedFromCustomer[record.id] = record.collectedFromCustomer === true;
    const key = record.rateId + ":" + record.amountCents;
    const current = rows.get(key) ?? {
      rateId: record.rateId, amountCents: record.amountCents, count: 0, totalCents: 0,
    };
    current.count++;
    current.totalCents += record.amountCents;
    rows.set(key, current);
  }

  // Only amounts already reported on a FILED original RDF return may be
  // claimed as a later-period credit. Over-report is not a negative amendment.
  const previous = await tx.taxFilingPeriod.findMany({
    where: {
      filingAccount: { kind: "RETAIL_DELIVERY_FEE_RETURN" },
      status: "FILED", periodEnd: { lt: period.periodStart },
      worksheet: { not: Prisma.DbNull },
    },
    select: {
      id: true, worksheet: true,
      amendments: {
        where: { status: "FILED" },
        orderBy: [{ sequence: "desc" }, { id: "desc" }],
        take: 1, select: { packet: true },
      },
    },
  });
  const reported = new Map(previous.flatMap(p => {
    const amendment = p.amendments[0]?.packet;
    const corrected = amendment && typeof amendment === "object" &&
      !Array.isArray(amendment) && "corrected" in amendment
        ? amendment.corrected : null;
    return originalRdfEvidence(corrected ?? p.worksheet);
  }).map(row => [row.id, row] as const));
  const candidates = reported.size ? await tx.retailDeliveryFeeRecord.findMany({
    where: {
      id: { in: [...reported.keys()] }, status: "NOT_DUE",
      OR: [{ creditAppliedPeriodId: null }, { creditAppliedPeriodId: periodId }],
    },
    select: {
      id: true, status: true, amountCents: true, rateId: true,
      filingPeriodId: true, creditAppliedPeriodId: true,
      customerRefundedAt: true, customerRefundRef: true, collectedFromCustomer: true,
      invoiceLineId: true, deliveredOn: true,
    },
    orderBy: [{ deliveredOn: "asc" }, { id: "asc" }],
  }) : [];
  const creditRecordIds: string[] = [];
  let priorPeriodCreditCents = 0;
  const assignedRefundCents = new Map<string, number>();
  for (const record of candidates) {
    const source = reported.get(record.id);
    if (!source || source.cents <= 0) continue;
    if (!(await refundConfirmed(tx, record, source.cents, source.collected))) continue;
    if (source.collected && record.customerRefundRef) {
      const refund = await tx.refund.findUnique({
        where: { id: record.customerRefundRef }, select: { amountCents: true },
      });
      const alreadyAssigned = assignedRefundCents.get(record.customerRefundRef) ?? 0;
      if (!refund || alreadyAssigned + source.cents > refund.amountCents) {
        blockers.push("Delivery fee refund " + record.customerRefundRef +
          " does not cover all credits that reference it.");
        continue;
      }
      assignedRefundCents.set(record.customerRefundRef, alreadyAssigned + source.cents);
    }
    creditRecordIds.push(record.id);
    priorPeriodCreditCents += source.cents;
  }
  const charged = [...rows.values()].reduce((n, row) => n + row.totalCents, 0);
  // Never fabricate a negative refund on the Department return. Excess
  // credits stay unclaimed until an owner/CPA-directed subsequent return.
  if (priorPeriodCreditCents > charged) {
    blockers.push("Prior-period delivery-fee credits exceed current liability. Ask your CPA how to carry the balance.");
  }
  return {
    version: 1, periodId, deliveries: sourceRecordIds.length,
    rows: [...rows.values()].sort((a, b) => a.amountCents - b.amountCents || a.rateId.localeCompare(b.rateId)),
    priorPeriodCreditCents,
    taxDueCents: Math.max(0, charged - priorPeriodCreditCents),
    sourceRecordIds, sourceAmountCents, sourceCollectedFromCustomer,
    creditRecordIds, blockers,
  };
}

/**
 * Exclusive reservation occurs on the filing write path only. Preview and
 * PDF/CSV read paths NEVER reserve a credit. Revalidate under the period +
 * record locks to serialize concurrent attempts from two returns.
 */
export async function reserveRdfCreditsInTx(
  tx: Tx, periodId: string, recordIds: string[],
): Promise<void> {
  const period = await lockPeriod(tx, periodId);
  if (period.status !== "OPEN") throw new Error("Cannot reserve credits on a filed return.");
  if (new Set(recordIds).size !== recordIds.length) throw new Error("Duplicate RDF credit record.");
  const packet = await buildRdfPacketInTx(tx, periodId);
  if (packet.blockers.length || recordIds.length !== packet.creditRecordIds.length ||
      recordIds.some(id => !packet.creditRecordIds.includes(id)))
    throw new Error("Retail delivery fee credits changed during filing.");
  // Stable ID lock order, after the filing period lock. Concurrent returns
  // select the same records but only one may update an unassigned credit.
  for (const recordId of [...recordIds].sort()) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "RetailDeliveryFeeRecord" WHERE "id" = ${recordId} FOR UPDATE
    `;
    if (!locked.length) throw new Error("RDF credit disappeared before filing.");
    const changed = await tx.retailDeliveryFeeRecord.updateMany({
      where: {
        id: recordId, status: "NOT_DUE",
        OR: [{ creditAppliedPeriodId: null }, { creditAppliedPeriodId: periodId }],
      },
      data: { creditAppliedPeriodId: periodId },
    });
    if (changed.count !== 1) throw new Error("RDF credit already claimed by another return.");
  }
}

