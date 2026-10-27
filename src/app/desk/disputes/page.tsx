import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { formatBusinessDate } from "@/lib/business-date";
import { getAchDisputeWindowDays, listDisputes } from "@/domains/disputes/reads";
import { dueDescription, whole } from "@/domains/disputes/rules";
import { AchWindowForm } from "./dispute-controls";

export const metadata = { title: "Disputes" };

const STATE_LABEL: Record<string, string> = {
  NEEDS_RESPONSE: "Needs your answer", UNDER_REVIEW: "With the bank", WON: "Won", LOST: "Lost", CLOSED: "Closed",
};

export default async function DisputesPage() {
  const session = await requireRole("OWNER", "ADMIN");
  const [disputes, windowDays] = await Promise.all([listDisputes(), getAchDisputeWindowDays()]);
  const now = new Date();
  return (
    <div className="space-y-6">
      <PageHeader title="Disputes" />
      <p className="text-sm text-ink-soft">
        A dispute is when a customer asks their card company or bank to take a payment back. We gather your signed agreement, delivery record, bill and messages into one packet. You read it and approve it. Nothing is sent to Stripe until you do.
      </p>
      <Card title="Open and past disputes">
        {disputes.length === 0 ? (
          <p className="text-sm text-ink-soft">No disputes. If a customer ever disputes a payment, it appears here and on your To do list.</p>
        ) : (
          <ul className="divide-y divide-line">
            {disputes.map((d) => {
              const due = dueDescription(d.dueBy, now);
              return (
                <li key={d.id} className="py-3">
                  <Link href={`/desk/disputes/${d.id}`} className="font-semibold underline">{d.customerName} — {whole(d.amountCents)}</Link>
                  <p className="text-sm text-ink-soft">
                    {d.isBank ? "Bank payment" : "Card payment"} · {STATE_LABEL[d.state] ?? d.state} · opened {formatBusinessDate(d.openedAt)}
                    {d.state === "NEEDS_RESPONSE" && !d.isBank && !d.evidenceSubmittedAt ? ` · respond ${due.text}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="Bank payment refund wait" description="Bank debits can be reversed by the customer's bank for weeks.">
        <AchWindowForm days={windowDays} editable={session.user.role === "OWNER"} />
      </Card>
    </div>
  );
}
