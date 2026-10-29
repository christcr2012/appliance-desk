import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { EmptyState, ScreenHeader } from "@/components/kit";
import { TaxActionForm } from "../setup/forms";
import { retryPendingDeliveryFees } from "./actions";

type WaitingRow = {
  id: string;
  deliveredOn: Date;
  saleOn: Date | null;
  agreement: { customer: { companyName: string | null; user: { name: string | null } } } | null;
  invoice: { customer: { companyName: string | null; user: { name: string | null } } } | null;
};

const date = (value: Date | null) => value ? value.toISOString().slice(0, 10) : "Not recorded";

const customerName = (row: WaitingRow) => row.agreement?.customer.companyName || row.agreement?.customer.user.name ||
  row.invoice?.customer.companyName || row.invoice?.customer.user.name || "Customer record";

export const metadata = { title: "Delivery fees waiting on you", robots: { index: false, follow: false } };

export default async function PendingDeliveryFeesPage() {
  await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  const [waitingForDecision, waitingForRate, groups] = await Promise.all([
    prisma.retailDeliveryFeeRecord.findMany({
      where: { status: "PENDING_DECISION" },
      orderBy: [{ deliveredOn: "asc" }, { id: "asc" }], take: 100,
      select: {
        id: true, deliveredOn: true, saleOn: true,
        agreement: { select: { customer: { select: {
          companyName: true, user: { select: { name: true } },
        } } } },
        invoice: { select: { customer: { select: {
          companyName: true, user: { select: { name: true } },
        } } } },
      },
    }),
    prisma.retailDeliveryFeeRecord.findMany({
      where: { status: "PENDING_RATE" },
      orderBy: [{ deliveredOn: "asc" }, { id: "asc" }], take: 100,
      select: {
        id: true, deliveredOn: true, saleOn: true,
        agreement: { select: { customer: { select: {
          companyName: true, user: { select: { name: true } },
        } } } },
        invoice: { select: { customer: { select: {
          companyName: true, user: { select: { name: true } },
        } } } },
      },
    }),
    prisma.retailDeliveryFeeRecord.groupBy({
      by: ["status"],
      where: { status: { in: ["PENDING_DECISION", "PENDING_RATE"] } },
      _count: { _all: true }, _min: { deliveredOn: true },
    }),
  ]);

  const stats = (status: "PENDING_DECISION" | "PENDING_RATE") => {
    const found = groups.find(group => group.status === status);
    return { count: found?._count._all ?? 0, oldest: found?._min.deliveredOn ?? null };
  };
  const decision = stats("PENDING_DECISION");
  const rate = stats("PENDING_RATE");
  const sections = [
    {
      id: "decision", title: "Waiting for your decision",
      rows: waitingForDecision, stats: decision, href: "/desk/sales-tax/setup#fee",
      label: "Decide how you handle the delivery fee",
    },
    {
      id: "rate", title: "Waiting for this year's fee amount",
      rows: waitingForRate, stats: rate, href: "/desk/sales-tax/setup#fee-rates",
      label: "Enter the fee amount",
    },
  ];

  return (
    <div className="space-y-6">
      <ScreenHeader title="Delivery fees" />
      <p className="text-sm text-muted-foreground">
        Colorado charges a small fee on deliveries. These deliveries are recorded, but
        the fee cannot be finished until you answer below.
      </p>
      {decision.count + rate.count === 0 ? (
        <p className="rounded-lg border border-border p-5">Nothing waiting.</p>
      ) : sections.map(section => (
        <section key={section.id} className="space-y-3 rounded-xl border border-border p-4">
          <h2 className="text-lg font-semibold">{section.title}</h2>
          <p className="text-sm text-muted-foreground">
            {section.stats.count} record{section.stats.count === 1 ? "" : "s"} waiting.
            {section.stats.oldest ? " Oldest delivery: " + date(section.stats.oldest) + "." : ""}
          </p>
          <Link className="inline-block font-medium underline" href={section.href}>{section.label}</Link>
          {section.rows.length === 0 ? <EmptyState title="No records waiting in this group" /> : (
            <ul className="flex flex-col gap-2">
              {section.rows.map(row => (
                <li key={row.id} className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
                  <span className="font-semibold">{customerName(row)}</span>
                  <span className="text-sm text-muted-foreground">Delivered {date(row.deliveredOn)} · Sale date {date(row.saleOn)}</span>
                </li>
              ))}
            </ul>
          )}
          {section.stats.count > section.rows.length && (
            <p className="text-sm text-muted-foreground">
              Showing the oldest {section.rows.length} of {section.stats.count} records.
            </p>
          )}
        </section>
      ))}
      <TaxActionForm action={retryPendingDeliveryFees} title="Check existing delivery-fee answers"
        submitLabel="Check again now">
        <p className="text-sm text-muted-foreground">
          Rechecks up to 200 waiting records using your saved decision and fee amount.
          It does not submit a return or charge anyone.
        </p>
      </TaxActionForm>
      <Link href="/desk/sales-tax" className="inline-block text-sm underline">Back to sales tax overview</Link>
    </div>
  );
}
