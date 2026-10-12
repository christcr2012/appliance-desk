import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import type { ExceptionItem } from "./rules";

/** Signing obligation is money owed, never payment received. */
export function signingPaymentDueItem(row: {
  agreementId: string;
  totalCents: number;
  signedAt: Date;
  customerName: string;
}): ExceptionItem {
  if (!row.agreementId || !Number.isSafeInteger(row.totalCents) || row.totalCents <= 0 ||
      !Number.isFinite(row.signedAt.getTime())) {
    throw new Error("Valid positive signing payment obligation required.");
  }
  const href = "/desk/agreements/" + encodeURIComponent(row.agreementId);
  return {
    category: "SIGNING_PAYMENT_DUE",
    severity: "medium",
    title: "Signing payment awaiting collection — " + row.customerName,
    detail: "The agreement is signed, but the signing amount has not been recorded as paid. Arrange secure payment and verify collection before treating it as settled.",
    href,
    amountCents: row.totalCents,
    since: row.signedAt,
    primaryAction: { href, label: "Review signing payment" },
  };
}

/** Role-gated, bounded oldest-first read; no writes, provider calls or auto-payment. */
export async function listSigningPaymentAttention(limit: number): Promise<{
  rows: ExceptionItem[];
  total: number;
}> {
  await requireRole("OWNER", "ADMIN");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("A bounded signing payment attention limit is required.");
  }
  const where = { status: "AWAITING_PAYMENT" };
  const rows = await prisma.agreementSigningPayment.findMany({
    where,
    select: {
      agreementId: true, totalCents: true, signedAt: true,
      agreement: { select: { customer: { select: { user: {
        select: { name: true, email: true },
      } } } } },
    },
    orderBy: [{ signedAt: "asc" }, { agreementId: "asc" }],
    take: limit,
  });
  return {
    rows: rows.map(row => signingPaymentDueItem({
      agreementId: row.agreementId, totalCents: row.totalCents,
      signedAt: row.signedAt,
      customerName: row.agreement.customer.user.name ?? row.agreement.customer.user.email,
    })),
    total: rows.length < limit ? rows.length :
      await prisma.agreementSigningPayment.count({ where }),
  };
}
