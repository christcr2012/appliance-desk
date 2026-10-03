import type { InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formatCents } from "@/domains/pricing";
import { getBusinessSettings } from "@/domains/settings";
import { businessDateKey } from "@/lib/business-date";

const OPEN_STATUSES = new Set<InvoiceStatus>([
  "OPEN",
  "PARTIALLY_PAID",
  "DELINQUENT",
]);
const BATCH_SIZE = 100;

function addCalendarDaysToKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type LateFeeApplication = {
  invoiceId: string;
  invoiceNumber: number;
  customerName: string;
  feeCents: number;
  newAmountDueCents: number;
};

type BatchResult = {
  applications: LateFeeApplication[];
  lastId: string | null;
  candidateCount: number;
};

async function applyLateFeeBatch(
  tx: Prisma.TransactionClient,
  todayKey: string,
  afterId: string | null,
): Promise<BatchResult> {
  const candidates = await tx.invoice.findMany({
    where: {
      status: { in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] },
      dueDate: { not: null },
      lateFeeCents: 0,
      agreementId: { not: null },
      ...(afterId ? { id: { gt: afterId } } : {}),
    },
    select: { id: true },
    orderBy: { id: "asc" },
    take: BATCH_SIZE,
  });

  const applications: LateFeeApplication[] = [];
  for (const candidate of candidates) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        invoiceNumber: number;
        status: InvoiceStatus;
        dueDate: Date | null;
        lateFeeCents: number;
        amountDueCents: number;
        amountPaidCents: number;
        agreementId: string | null;
      }>
    >`
      SELECT "id", "invoiceNumber", "status", "dueDate", "lateFeeCents",
             "amountDueCents", "amountPaidCents", "agreementId"
      FROM "Invoice"
      WHERE "id" = ${candidate.id}
      FOR UPDATE
    `;
    const locked = rows[0];
    if (
      !locked ||
      !OPEN_STATUSES.has(locked.status) ||
      !locked.dueDate ||
      !locked.agreementId ||
      locked.lateFeeCents !== 0
    ) {
      continue;
    }

    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: locked.id },
      include: {
        agreement: {
          select: {
            lateFeeGraceDays: true,
            lateFeeCents: true,
            lateFeePercent: true,
          },
        },
        customer: {
          select: { user: { select: { name: true, email: true } } },
        },
      },
    });
    if (!invoice.agreement) continue;

    const {
      lateFeeGraceDays,
      lateFeeCents: flatFeeCents,
      lateFeePercent,
    } = invoice.agreement;
    if (flatFeeCents <= 0 && lateFeePercent <= 0) continue;

    const feeEligibleKey = addCalendarDaysToKey(
      businessDateKey(locked.dueDate),
      lateFeeGraceDays,
    );
    if (todayKey < feeEligibleKey) continue;

    const outstandingCents = Math.max(
      0,
      locked.amountDueCents - locked.amountPaidCents,
    );
    if (outstandingCents <= 0) continue;

    const percentFeeCents = Math.round(
      (outstandingCents * lateFeePercent) / 100,
    );
    const feeCents = Math.max(flatFeeCents, percentFeeCents);
    if (feeCents <= 0) continue;
    const newAmountDueCents = locked.amountDueCents + feeCents;

    await tx.invoiceLineItem.create({
      data: {
        invoiceId: locked.id,
        kind: "LATE_FEE",
        description: `Late fee — ${lateFeeGraceDays}-day grace period passed`,
        amountCents: feeCents,
        quantity: 1,
      },
    });
    await tx.invoice.update({
      where: { id: locked.id },
      data: {
        lateFeeCents: feeCents,
        amountDueCents: newAmountDueCents,
      },
    });
    await tx.auditLog.create({
      data: {
        action: "billing.late_fee_applied",
        entityType: "Invoice",
        entityId: locked.id,
        newValue: {
          feeCents,
          graceDaysPassed: lateFeeGraceDays,
          eligibleBusinessDate: feeEligibleKey,
        },
      },
    });

    applications.push({
      invoiceId: locked.id,
      invoiceNumber: locked.invoiceNumber,
      customerName: invoice.customer.user.name ?? invoice.customer.user.email,
      feeCents,
      newAmountDueCents,
    });
  }

  return {
    applications,
    lastId: candidates.at(-1)?.id ?? null,
    candidateCount: candidates.length,
  };
}

/**
 * Apply each invoice's disclosed late fee at most once. One transaction-level
 * advisory lock is held for the entire paged run, so overlapping cron requests
 * cannot alternate batches and produce two partial digests with the same daily
 * idempotency key. Every invoice is still row-locked/rechecked, and the partial
 * unique index on LATE_FEE line items remains the database backstop.
 */
export async function applyLateFees(): Promise<LateFeeApplication[]> {
  const todayKey = businessDateKey(new Date());

  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(174831, 2)::text`;

      const applied: LateFeeApplication[] = [];
      let afterId: string | null = null;
      do {
        const batch = await applyLateFeeBatch(tx, todayKey, afterId);
        applied.push(...batch.applications);
        afterId = batch.lastId;
        if (batch.candidateCount < BATCH_SIZE) break;
      } while (afterId);

      return applied;
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}

export async function sendLateFeeDigestToChris(
  applications: LateFeeApplication[],
): Promise<void> {
  if (applications.length === 0) return;

  const settings = await getBusinessSettings();
  const notifyTo = process.env.BILLING_NOTIFICATION_EMAIL || settings.publicEmail;

  const lines = applications
    .map(
      (application) =>
        `#${application.invoiceNumber} — ${application.customerName}: +${formatCents(application.feeCents)} (now ${formatCents(application.newAmountDueCents)} due)`,
    )
    .join("\n");

  const result = await sendEmail({
    to: notifyTo,
    subject: `Late fees applied to ${applications.length} invoice${applications.length === 1 ? "" : "s"}`,
    text: `The following invoices passed their grace period and had a late fee added automatically:\n\n${lines}\n\nThese already show up on /desk/billing with the updated amount due — no other action needed unless you want to follow up with the customer.`,
    idempotencyKey: `late-fee-digest-${businessDateKey(new Date())}`,
  });
  if (!result.sent) {
    console.error("[billing] Late-fee digest was not accepted by the email provider.");
  }
}
