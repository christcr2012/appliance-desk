import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formatCents } from "@/domains/pricing";
import { getBusinessSettings } from "@/domains/settings";

// ---------------------------------------------------------------------------
// Automated late fees (docs/ROADMAP.md's "Deliberately deferred within
// Phase 6B" — "Automated late fees / dunning beyond what Stripe's own
// automatic payment retries already do... needs its own design: how many
// retries, what fee, when to involve Chris." Built 2026-09-28, see
// docs/DECISIONS.md.
//
// Answers those three questions deliberately conservatively:
//   - Retries: none added here — Stripe already retries a failed card/ACH
//     charge on its own schedule (docs/ARCHITECTURE.md), and this never
//     attempts a new charge. It only adds a fee to what's owed.
//   - What fee: whichever of the AGREEMENT's own lateFeeCents (flat) or
//     lateFeePercent (of the outstanding balance) is larger, frozen at
//     signing per agreement (sign/[id]/page.tsx already discloses both to
//     the customer as "$X or Y%") — never BusinessSettings' current
//     defaults, which could have changed since this customer signed.
//   - When to involve Chris: immediately — every invoice this touches is
//     already OPEN/PARTIALLY_PAID/DELINQUENT and past its due date, so
//     it's already surfaced in the existing PAST_DUE_INVOICE exception
//     (src/domains/exceptions/rules.ts) and on /desk/billing; applying the
//     fee there just makes the amount owed reflect reality. A same-day
//     digest email also goes to Chris (see sendLateFeeDigestToChris
//     below) so a fee being added is never something he only discovers by
//     happening to reopen an old invoice.
//
// Invoice.lateFeeCents (schema field, previously always 0 — no code wrote
// to it before this) doubles as the idempotency guard: a fee is only ever
// applied once per invoice, never stacked on repeated cron runs.
// ---------------------------------------------------------------------------

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export type LateFeeApplication = {
  invoiceId: string;
  invoiceNumber: number;
  customerName: string;
  feeCents: number;
  newAmountDueCents: number;
};

/**
 * Finds every invoice that's past its agreement's grace period with no
 * late fee applied yet, adds the fee as a new InvoiceLineItem (kind
 * LATE_FEE — already in the schema's InvoiceLineItemKind, unused before
 * this), and rolls it into the invoice's own lateFeeCents/amountDueCents
 * totals. An invoice with no agreement (shouldn't happen in practice —
 * every Invoice with billing history has one) or an agreement with
 * neither lateFeeCents nor lateFeePercent set (Chris left the fee off
 * entirely for that customer) is skipped, never charged a fee that was
 * never disclosed.
 */
export async function applyLateFees(): Promise<LateFeeApplication[]> {
  const now = new Date();

  const candidates = await prisma.invoice.findMany({
    where: {
      status: { in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] },
      dueDate: { not: null },
      lateFeeCents: 0,
      agreementId: { not: null },
    },
    include: {
      agreement: { select: { lateFeeGraceDays: true, lateFeeCents: true, lateFeePercent: true } },
      customer: { select: { user: { select: { name: true, email: true } } } },
    },
  });

  const applied: LateFeeApplication[] = [];

  for (const invoice of candidates) {
    if (!invoice.dueDate || !invoice.agreement) continue;
    const { lateFeeGraceDays, lateFeeCents: flatFeeCents, lateFeePercent } = invoice.agreement;
    if (flatFeeCents <= 0 && lateFeePercent <= 0) continue;

    const feeAppliesFrom = addDays(invoice.dueDate, lateFeeGraceDays);
    if (now < feeAppliesFrom) continue;

    const outstandingCents = Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
    if (outstandingCents <= 0) continue;

    const percentFeeCents = Math.round((outstandingCents * lateFeePercent) / 100);
    const feeCents = Math.max(flatFeeCents, percentFeeCents);
    if (feeCents <= 0) continue;

    const newAmountDueCents = invoice.amountDueCents + feeCents;

    await prisma.$transaction([
      prisma.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          kind: "LATE_FEE",
          description: `Late fee — ${lateFeeGraceDays}-day grace period passed`,
          amountCents: feeCents,
          quantity: 1,
        },
      }),
      prisma.invoice.update({
        where: { id: invoice.id },
        data: { lateFeeCents: feeCents, amountDueCents: newAmountDueCents },
      }),
      prisma.auditLog.create({
        data: {
          action: "billing.late_fee_applied",
          entityType: "Invoice",
          entityId: invoice.id,
          newValue: { feeCents, graceDaysPassed: lateFeeGraceDays },
        },
      }),
    ]);

    applied.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customer.user.name ?? invoice.customer.user.email,
      feeCents,
      newAmountDueCents,
    });
  }

  return applied;
}

/** One digest email to Chris when the daily cron actually applied any
 * fees — silent (no email) on a day with nothing to report, so this
 * never becomes noise. Falls back to the public contact email, same
 * pattern as the lead/maintenance notification emails
 * (docs/ARCHITECTURE.md). */
export async function sendLateFeeDigestToChris(applications: LateFeeApplication[]): Promise<void> {
  if (applications.length === 0) return;

  const settings = await getBusinessSettings();
  const notifyTo = process.env.BILLING_NOTIFICATION_EMAIL || settings.publicEmail;

  const lines = applications
    .map((a) => `#${a.invoiceNumber} — ${a.customerName}: +${formatCents(a.feeCents)} (now ${formatCents(a.newAmountDueCents)} due)`)
    .join("\n");

  await sendEmail({
    to: notifyTo,
    subject: `Late fees applied to ${applications.length} invoice${applications.length === 1 ? "" : "s"}`,
    text: `The following invoices passed their grace period and had a late fee added automatically:\n\n${lines}\n\nThese already show up on /desk/billing with the updated amount due — no other action needed unless you want to follow up with the customer.`,
  });
}
