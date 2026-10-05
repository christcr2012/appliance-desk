import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";

/**
 * Deposits the business is holding and still owes a decision on (docs/designs/BATCH-D.md D5). A deposit counts as owed
 * while it is refundable and no refund decision has been made. A decided deposit (full refund, or a refund with a
 * written deduction) is no longer owed. Deposits are never rent. Read-only.
 */

export type DepositAgeBucket = "STILL_RENTING" | "DAYS_0_30" | "DAYS_31_90" | "OVER_90";

export const DEPOSIT_BUCKET_LABEL: Record<DepositAgeBucket, string> = {
  STILL_RENTING: "Rental still in progress",
  DAYS_0_30: "Ended 0–30 days ago",
  DAYS_31_90: "Ended 31–90 days ago",
  OVER_90: "Ended more than 90 days ago",
};

const DAY_MS = 86_400_000;

/** Whole Colorado calendar days between two instants (later minus earlier). Pure. */
function coloradoDaysBetween(from: Date, to: Date): number {
  const a = Date.parse(`${businessDateKey(from)}T00:00:00Z`);
  const b = Date.parse(`${businessDateKey(to)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

/** Which age group a deposit falls in, by days since its rental ended. Pure. */
export function depositAgeBucket(endedAt: Date | null, now: Date): { bucket: DepositAgeBucket; daysSinceEnd: number | null } {
  if (!endedAt) return { bucket: "STILL_RENTING", daysSinceEnd: null };
  const days = Math.max(0, coloradoDaysBetween(endedAt, now));
  const bucket: DepositAgeBucket = days <= 30 ? "DAYS_0_30" : days <= 90 ? "DAYS_31_90" : "OVER_90";
  return { bucket, daysSinceEnd: days };
}

export type DepositLiabilityRow = {
  depositId: string;
  agreementId: string;
  customerId: string;
  customerName: string;
  amountCents: number;
  bucket: DepositAgeBucket;
  daysSinceEnd: number | null;
  /** True once a deposit has been held more than 90 days after the rental ended. */
  overdue: boolean;
};

export type DepositLiability = {
  totalCents: number;
  count: number;
  byBucket: Record<DepositAgeBucket, { cents: number; count: number }>;
  rows: DepositLiabilityRow[];
};

export function summarizeDepositLiability(rows: DepositLiabilityRow[]): DepositLiability {
  const byBucket = Object.fromEntries(
    (Object.keys(DEPOSIT_BUCKET_LABEL) as DepositAgeBucket[]).map((b) => [b, { cents: 0, count: 0 }]),
  ) as DepositLiability["byBucket"];
  let totalCents = 0;
  for (const r of rows) {
    totalCents += r.amountCents;
    byBucket[r.bucket].cents += r.amountCents;
    byBucket[r.bucket].count += 1;
  }
  return { totalCents, count: rows.length, byBucket, rows };
}

export async function getDepositLiability(now = new Date(), limit = 500): Promise<DepositLiability> {
  const deposits = await prisma.deposit.findMany({
    where: { refundable: true, refundedAt: null, amountCents: { gt: 0 } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      amountCents: true,
      agreementId: true,
      agreement: {
        select: {
          status: true,
          endDate: true,
          updatedAt: true,
          customerId: true,
          customer: { select: { user: { select: { name: true, email: true } } } },
        },
      },
    },
  });
  const rows: DepositLiabilityRow[] = deposits
    .map((d) => {
      const ended = d.agreement.status === "ENDED" || d.agreement.status === "CANCELLED";
      const endedAt = ended ? (d.agreement.endDate ?? d.agreement.updatedAt) : null;
      const { bucket, daysSinceEnd } = depositAgeBucket(endedAt, now);
      return {
        depositId: d.id,
        agreementId: d.agreementId,
        customerId: d.agreement.customerId,
        customerName: d.agreement.customer.user.name ?? d.agreement.customer.user.email,
        amountCents: d.amountCents,
        bucket,
        daysSinceEnd,
        overdue: bucket === "OVER_90",
      };
    });
  return summarizeDepositLiability(rows);
}
