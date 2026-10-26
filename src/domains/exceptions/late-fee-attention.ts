// FEE-1: To do items for overdue bills that cannot get a late fee because the customer was never warned (or is active military).
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { businessDateKey } from "@/lib/business-date";
import { decideLateFee } from "@/domains/billing/late-fee-rules";
import { loadLateFeeFacts } from "@/domains/billing/late-fee-engine";
import { lateFeeReviewException, type ExceptionItem } from "./rules";

const OPEN = ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] as const;

export async function listLateFeeReview(
  limit: number,
  now: Date,
  scope?: { customerId?: string },
): Promise<{ rows: ExceptionItem[]; total: number }> {
  await requireRole("OWNER", "ADMIN");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("A bounded late fee limit is required.");
  const candidates = await prisma.invoice.findMany({
    where: {
      status: { in: [...OPEN] },
      dueDate: { not: null, lte: new Date(now.getTime() - 10 * 86_400_000), gte: new Date(now.getTime() - 40 * 86_400_000) },
      agreementId: { not: null },
      lateFeeCents: 0,
      pendingChargesFor: { none: {} },
      ...(scope?.customerId ? { customerId: scope.customerId } : {}),
    },
    select: { id: true, customerId: true, dueDate: true },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    take: 200,
  });
  const found: ExceptionItem[] = [];
  const today = businessDateKey(now);
  for (const candidate of candidates) {
    const loaded = await loadLateFeeFacts(prisma, candidate.id, now);
    if (!loaded) continue;
    const decision = decideLateFee(loaded.facts);
    const reason = decision.kind === "NEEDS_WARNING" ? "NOT_WARNED" : decision.kind === "MILITARY_REVIEW" && today >= loaded.baseKey ? "MILITARY" : null;
    if (!reason) continue;
    found.push(lateFeeReviewException({
      invoiceId: candidate.id,
      customerId: candidate.customerId,
      customerName: loaded.customerName,
      invoiceNumber: loaded.invoiceNumber,
      reason,
      dueOn: candidate.dueDate,
      amountCents: loaded.facts.outstandingCents,
    }));
  }
  return { rows: found.slice(0, limit), total: found.length };
}
