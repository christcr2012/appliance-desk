import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { formatBusinessDate } from "@/lib/business-date";
import { getDispute } from "@/domains/disputes/reads";
import { dueDescription, whole } from "@/domains/disputes/rules";
import { AllowAutopay, ApproveAndSend, BankHandled } from "../dispute-controls";

export const metadata = { title: "Dispute" };

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const d = await getDispute(decodeURIComponent(id));
  if (!d) notFound();
  const due = dueDescription(d.dueBy, new Date());
  const canAnswer = !d.isBank && d.state === "NEEDS_RESPONSE" && !d.evidenceSubmittedAt;
  return (
    <div className="space-y-6">
      <Link href="/desk/disputes" className="text-sm text-ink-soft hover:underline">&larr; Back to disputes</Link>
      <PageHeader title={`${d.customerName} — ${whole(d.amountCents)}`} />
      <Card title="What happened">
        <dl className="grid gap-2 text-sm">
          <div><dt className="font-semibold">Type</dt><dd>{d.isBank ? "Bank payment (ACH)" : "Card payment"}</dd></div>
          <div><dt className="font-semibold">Reason given</dt><dd>{d.reason.replace(/_/g, " ")}</dd></div>
          <div><dt className="font-semibold">Opened</dt><dd>{formatBusinessDate(d.openedAt)}</dd></div>
          {d.dueBy && !d.isBank && <div><dt className="font-semibold">Answer due</dt><dd>{formatBusinessDate(d.dueBy)} ({due.text})</dd></div>}
          {d.invoice && <div><dt className="font-semibold">Bill</dt><dd>#{d.invoice.invoiceNumber}</dd></div>}
          {d.outcome && <div><dt className="font-semibold">Result</dt><dd>{d.outcome}</dd></div>}
        </dl>
      </Card>
      {d.isBank ? (
        <Card title="Bank disputes can't be contested">
          <p className="text-sm">The bank has taken the money back, and Stripe has no way to argue it. The bill is owed again, so collect it directly from the customer. Autopay by bank is switched off for this customer.</p>
          {d.customer?.bankDebitBlockedAt && d.customerId && <div className="mt-3"><AllowAutopay customerId={d.customerId} disputeId={d.id} /></div>}
          {d.handledAt ? <p className="mt-3 text-sm">Handled: {d.handledNote}</p> : <div className="mt-3"><BankHandled disputeId={d.id} /></div>}
        </Card>
      ) : (
        <Card title="Your answer">
          <p className="text-sm text-ink-soft">The packet is built from your records only: the signed agreement, delivery record and photos, the bill and payments, messages we sent, and the refund terms. Read it first. Stripe accepts one answer, so this button can be used once.</p>
          <p className="mt-3 text-sm"><a href={`/desk/disputes/${d.id}/packet`} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Open the packet to read it (PDF)</a></p>
          <div className="mt-3">
            {canAnswer ? <ApproveAndSend disputeId={d.id} /> : (
              <p className="text-sm">{d.evidenceSubmittedAt ? `Sent ${formatBusinessDate(d.evidenceSubmittedAt)}. Stripe accepts only one answer.` : "This dispute isn't waiting for an answer."}</p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
