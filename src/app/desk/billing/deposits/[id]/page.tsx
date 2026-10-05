import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/domains/pricing";
import { formatBusinessDate } from "@/lib/business-date";
import { PageHeader, SectionCard } from "@/components/desk/workspace";
import { MoneyDecisionForm } from "@/components/desk/money-decision-form";
import { decideDepositAction } from "../../money-actions";

export const metadata = { title: "Deposit decision" };

/** Owner/admin only (a hidden link is not protection: the role is checked here and again inside the action). */
export default async function DepositDecisionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const deposit = await prisma.deposit.findUnique({
    where: { id },
    select: {
      id: true,
      amountCents: true,
      refundable: true,
      refundedAt: true,
      refundedAmountCents: true,
      deductionReason: true,
      agreement: {
        select: {
          id: true,
          status: true,
          endDate: true,
          customerId: true,
          customer: { select: { user: { select: { name: true, email: true } } } },
        },
      },
    },
  });
  if (!deposit) notFound();
  const name = deposit.agreement.customer.user.name ?? deposit.agreement.customer.user.email;
  const decided = deposit.refundedAt !== null;
  return (
    <div className="max-w-2xl">
      <PageHeader title="Deposit decision" description={`${name} — deposit of ${formatCents(deposit.amountCents)}`} />
      <p className="mb-4 text-sm">
        <Link className="text-primary underline" href="/desk/billing?filter=deposits">
          Back to deposits
        </Link>{" "}
        ·{" "}
        <Link className="text-primary underline" href={`/desk/agreements/${deposit.agreement.id}`}>
          Open the rental agreement
        </Link>
      </p>
      <SectionCard title="Where this stands">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li>Rental status: {deposit.agreement.status.toLowerCase()}{deposit.agreement.endDate ? `, ended ${formatBusinessDate(deposit.agreement.endDate)}` : ""}.</li>
          {!deposit.refundable && <li>This deposit is marked non-refundable, so it cannot be refunded here.</li>}
          {decided && (
            <li>
              A decision was already made: {formatCents(deposit.refundedAmountCents ?? 0)} given back
              {deposit.deductionReason ? ` (kept part because: ${deposit.deductionReason})` : ""}.
            </li>
          )}
        </ul>
      </SectionCard>
      {deposit.refundable && !decided && (
        <div className="mt-6">
          <MoneyDecisionForm
            title="Give the deposit back"
            help="Give back all of it, or only part. If you give back less than the full deposit you must write why (for example, damage). The money goes back to the card or bank it came from when it was paid through Stripe; money paid another way is recorded for you to pay back yourself. A deposit is never refunded automatically."
            verb="give back"
            maxCents={deposit.amountCents}
            defaultCents={deposit.amountCents}
            reasonLabel="Why are you keeping part of it? Leave empty for a full refund"
            submitLabel="Record this decision"
            submit={decideDepositAction.bind(null, deposit.id)}
          />
        </div>
      )}
    </div>
  );
}
