import { ContextCommunicationPanel } from "@/components/desk/context-communication-panel";
import { SendTextPanel } from "@/app/desk/_text/send-text-panel";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getInvoiceDetail } from "@/domains/billing/invoice-detail";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { prisma } from "@/lib/prisma";
import { getSpendableCredits } from "@/domains/billing/money-decisions";
import { MoneyDecisionForm } from "@/components/desk/money-decision-form";
import { applyCreditAction, recalculateInvoiceTaxAction, refundInvoiceAction } from "@/app/desk/billing/money-actions";
import { formatCents } from "@/domains/pricing";
import { RecordConnections } from "@/components/desk/record-connections";
import { LateFeeSection } from "@/components/desk/late-fee-section";
import { AreaTabs, NextStepCard, RecordHeader, StatStrip, Timeline, Toaster } from "@/components/kit";
import { billPill, billPillInfo, payPathFor } from "@/domains/billing/bill-status";
import { billForText } from "@/domains/billing/bills-list";
import { getBillTimeline } from "@/domains/billing/bill-timeline";
import { billActions } from "@/domains/billing/bill-actions";
import { suggestPaymentLinkReason } from "@/domains/billing/payment-link-message";
import { businessDayBounds, businessDaysBetween, formatShortDate } from "@/lib/business-date";
import { billNext } from "@/lib/status-next";
import { formatMoney } from "@/lib/money-ui";
import { WriteOffButton } from "../../write-off-button";
import { BillRecordActionsBar } from "./bill-record-actions";
import type { InvoiceStatus } from "@prisma/client";

export const metadata = { title: "Bill" };

/** One invoice, on its own (AR-3 redesign on the kit: header, stats, the action table in bill-actions,
 * next-step cards, Bill / Activity tabs). OWNER/ADMIN can view any customer's invoice, same as the
 * statement page it's linked from. */
export default async function DeskInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; invoiceId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN");
  const { id, invoiceId } = await params;
  const tab = (await searchParams).tab === "activity" ? "activity" : "bill";
  const invoice = await getInvoiceDetail(invoiceId);

  if (!invoice || invoice.customer.id !== id) {
    notFound();
  }

  const money = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      status: true,
      stripeInvoiceId: true,
      saleKind: true,
      agreementId: true,
      amountDueCents: true,
      amountPaidCents: true,
      refunds: { select: { amountCents: true } },
    },
  });
  const refundable = money ? money.amountPaidCents - money.refunds.reduce((sum, r) => sum + r.amountCents, 0) : 0;
  const outstanding = money ? Math.max(0, money.amountDueCents - money.amountPaidCents) : 0;
  const isOpen = money ? ["OPEN", "PARTIALLY_PAID", "DELINQUENT"].includes(money.status) : false;
  // BILL-1: the bank is confirming a payment the customer already started, so asking for payment again could charge twice.
  const confirmingCents = invoice.beingConfirmedCents;
  const credits = isOpen && outstanding > 0 ? await getSpendableCredits(id) : [];
  const taxBlock =
    money?.status === "DRAFT"
      ? await prisma.auditLog.findFirst({
          where: { action: "billing.invoice_tax_blocked", entityType: "Invoice", entityId: invoiceId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { newValue: true },
        })
      : null;
  const taxBlockValue = taxBlock?.newValue as { problems?: unknown } | null | undefined;
  const taxProblems = Array.isArray(taxBlockValue?.problems)
    ? taxBlockValue.problems.filter((problem): problem is string => typeof problem === "string")
    : [];

  const now = new Date();
  const timeline = await getBillTimeline(invoiceId);
  const payPath = money
    ? payPathFor({
        status: money.status as InvoiceStatus,
        owedCents: outstanding,
        stripeInvoiceId: money.stripeInvoiceId,
        saleKind: money.saleKind,
      })
    : null;
  const actions = billActions({
    status: invoice.status,
    taxBlocked: Boolean(taxBlock),
    payPath,
    beingConfirmed: confirmingCents > 0,
    refundableCents: refundable,
    hasCredits: credits.length > 0,
  });
  const pillInput = {
    status: invoice.status as InvoiceStatus,
    dueDate: invoice.dueDate,
    amountDueCents: invoice.amountDueCents,
    amountPaidCents: invoice.amountPaidCents,
    beingConfirmed: confirmingCents > 0,
  };
  const pill = billPill(pillInput, now);
  const pastDue =
    ["OPEN", "PARTIALLY_PAID", "DELINQUENT", "FAILED"].includes(invoice.status) &&
    invoice.dueDate !== null &&
    invoice.dueDate < businessDayBounds(now).start &&
    confirmingCents === 0;
  const daysLate = invoice.dueDate ? businessDaysBetween(invoice.dueDate, now) : 0;
  const forText = billForText({
    agreementId: money?.agreementId ?? null,
    billingPeriodStart: invoice.billingPeriodStart,
    saleKind: money?.saleKind ?? null,
    firstLine: invoice.lineItems[0]?.description,
  });
  const base = `/desk/billing/customer/${id}/invoice/${invoiceId}`;

  const textPanel = (
    <SendTextPanel
      userId={session.user.id}
      entityType="Invoice"
      entityId={invoiceId}
      path={base}
      families={["invoice_ready", "invoice_reminder", "payment_received", "refund_issued"]}
      principal={{ customerId: id }}
    />
  );
  const refundForm =
    refundable > 0 ? (
      <MoneyDecisionForm
        title="Refund money to the customer"
        help={`Up to ${formatCents(refundable)} can still be refunded on this invoice. Money paid through Stripe goes back to the original card or bank; money paid another way is recorded for you to pay back yourself.`}
        verb="refund"
        maxCents={refundable}
        selectLabel="Why is this being refunded?"
        options={[
          { value: "OVERPAYMENT", label: "The customer paid too much" },
          { value: "BILLING_ERROR", label: "We billed in error" },
          { value: "GOODWILL", label: "Goodwill" },
          { value: "DISPUTE_RESOLUTION", label: "Settling a disagreement" },
          { value: "OTHER", label: "Something else" },
        ]}
        reasonLabel="A short note for the record"
        reasonRequired
        submitLabel="Refund this money"
        submit={refundInvoiceAction.bind(null, invoiceId)}
      />
    ) : null;
  const creditForm =
    credits.length > 0 ? (
      <MoneyDecisionForm
        title="Pay this bill with the customer's credit"
        help={`This bill still owes ${formatCents(outstanding)}. Using credit lowers what the customer owes; no money moves.`}
        verb="apply"
        maxCents={outstanding}
        selectLabel="Which credit?"
        options={credits.map((c) => ({
          value: c.id,
          label: `${formatCents(c.remainingCents)} left — ${c.reason}`,
        }))}
        submitLabel="Apply this credit"
        submit={applyCreditAction.bind(null, invoiceId)}
      />
    ) : null;

  return (
    // The kit lays out for a 20 px phone gutter (KIT 1); the current shell gives 16 px, so add the difference (same as the Bills list).
    <div className="px-1 sm:px-0">
      <p className="text-xs font-bold text-ink-soft print:hidden">Bill #{invoice.invoiceNumber}</p>
      <RecordHeader
        title={invoice.customer.name}
        back={{ href: "/desk/billing", label: "Bills" }}
        pills={[{ label: pill.label, tone: pill.tone, info: billPillInfo(invoice.status as InvoiceStatus, confirmingCents > 0), next: billNext(pillInput, now) }]}
        subtitle={forText}
      />
      <StatStrip
        items={[
          { label: "Amount", value: formatMoney(invoice.amountDueCents) },
          { label: "Paid", value: formatMoney(invoice.amountPaidCents) },
          { label: "Still owed", value: formatMoney(invoice.balanceCents), tone: pastDue ? "attention" : undefined },
          { label: "Due", value: invoice.dueDate ? formatShortDate(invoice.dueDate, now) : "No due date" },
        ]}
      />
      <div className="pt-4">
        <BillRecordActionsBar
          actions={actions}
          takePayment={
            money ? { invoiceId, owedCents: outstanding, suggestedReason: suggestPaymentLinkReason(money) } : null
          }
          record={{
            customerId: id,
            openInvoices: [{ id: invoiceId, invoiceNumber: invoice.invoiceNumber, balanceCents: outstanding }],
            lockedInvoice: { id: invoiceId, invoiceNumber: invoice.invoiceNumber },
          }}
          frozenHref={`/api/documents/invoice/${invoiceId}`}
          customerHref={`/desk/customers/${id}`}
          statementHref={`/desk/billing/customer/${id}`}
          textPanel={textPanel}
          creditForm={creditForm}
          refundForm={refundForm}
          writeOff={actions.overflow.giveUp ? <WriteOffButton customerId={id} invoiceId={invoiceId} /> : null}
        />
      </div>

      {confirmingCents > 0 && (
        <section aria-labelledby="being-confirmed-heading" className="mt-4 rounded-xl border border-info-soft bg-info-soft p-4 print:hidden">
          <h2 id="being-confirmed-heading" className="font-semibold text-ink">
            Being confirmed · {formatCents(confirmingCents)}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            The customer paid by bank transfer. Banks take up to 4 business days to confirm. Nothing for you to do. The bill
            is not marked paid until the bank says the money arrived, and no late fee is added while it is confirming.
          </p>
        </section>
      )}

      {invoice.status === "DRAFT" && taxBlock ? (
        <div className="mt-4 print:hidden">
          <NextStepCard
            title="Sales tax needs a decision before this bill can be sent"
            tone="attention"
            actions={[
              {
                kind: "form",
                label: "Recalculate tax",
                action: recalculateInvoiceTaxAction.bind(null, invoiceId),
              },
            ]}
          />
          {taxProblems.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
              {taxProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {pastDue ? (
        <div className="mt-4 print:hidden">
          <NextStepCard
            title={`${daysLate} ${daysLate === 1 ? "day" : "days"} late`}
            tone="attention"
            actions={[
              ...(payPath === "STRIPE_LINK"
                ? [{ kind: "link" as const, label: "Take payment", href: "#take-payment", primary: true }]
                : []),
              { kind: "link" as const, label: "Send a text…", href: "#send-text" },
            ]}
          />
        </div>
      ) : null}

      <div className="print:hidden">
        <AreaTabs
          label="Bill sections"
          items={[
            { href: base, label: "Bill" },
            { href: `${base}?tab=activity`, label: "Activity" },
          ]}
        />
      </div>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5">
        <section className={tab === "activity" ? "hidden lg:block print:block" : "print:block"}>
          <LateFeeSection invoiceId={invoiceId} standing={invoice.lateFee} />
          <div className="mt-4 print:mt-0">
            <InvoiceDocument invoice={invoice} />
          </div>
        </section>
        <aside className={(tab === "bill" ? "hidden lg:flex lg:flex-col lg:gap-4" : "flex flex-col gap-4") + " print:hidden"}>
          <section aria-labelledby="bill-activity">
            <h2 id="bill-activity" className="pb-1 text-base font-extrabold text-ink">
              Activity
            </h2>
            <Timeline items={timeline} emptyLabel="Nothing recorded yet" now={now} />
          </section>
          <ContextCommunicationPanel kind="Invoice" id={invoiceId} />
          <RecordConnections kind="invoice" id={invoiceId} />
        </aside>
      </div>
      <Toaster />
    </div>
  );
}
