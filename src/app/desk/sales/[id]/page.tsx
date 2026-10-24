import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getShopSale, saleBuyerLabel } from "@/domains/sales";
import { Card, PageHeader, StatusPill } from "@/components/ui";
import { formatMoney } from "@/lib/money-ui";
import { businessDateKey } from "@/lib/business-date";
import type { StatusTone } from "@/components/status-badge";
import { SalePanel } from "./sale-panel";

export const metadata = { title: "Shop sale" };

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  DRAFT: { label: "Not paid", tone: "pending" },
  OPEN: { label: "Not paid", tone: "pending" },
  PARTIALLY_PAID: { label: "Part paid", tone: "progress" },
  PAID: { label: "Paid", tone: "success" },
  VOID: { label: "Cancelled", tone: "stopped" },
  REFUNDED: { label: "Refunded", tone: "stopped" },
};

export default async function ShopSalePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ card?: string }> }) {
  const session = await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const card = (await searchParams).card;
  const sale = await getShopSale(session.user.id, id);
  if (!sale) notFound();
  const status = STATUS[sale.status] ?? { label: sale.status, tone: "pending" as StatusTone };
  const owed = Math.max(0, sale.amountDueCents - sale.amountPaidCents);
  return (
    <main className="space-y-6">
      <PageHeader
        title={`Sale #${sale.invoiceNumber}`}
        description={`${saleBuyerLabel(sale)} · ${sale.saleLocation === "DELIVERED" ? "Delivered" : "Picked up"} · ${sale.createdAt.toLocaleDateString("en-US", { timeZone: "America/Denver" })}`}
        secondaryActions={<Link href="/desk/sales" className="text-sm underline">Back to all sales</Link>}
      />
      {card === "paid" && <p role="status" className="rounded-md border border-line bg-surface-subtle p-3 text-sm">Card payment sent. This sale shows as paid as soon as Stripe confirms it (usually within seconds). Reload if it still says owed.</p>}
      {card === "cancelled" && <p role="status" className="rounded-md border border-line bg-surface-subtle p-3 text-sm">The card payment was not completed. Nothing was charged.</p>}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusPill tone={status.tone} label={status.label} />
          {sale.status !== "VOID" && <p className="text-sm text-ink-soft">{owed > 0 ? `${formatMoney(owed)} still owed` : "Nothing owed"}</p>}
        </div>
        <ul className="mt-4 divide-y divide-line">
          {sale.lineItems.filter((l) => l.kind !== "TAX").map((line) => (
            <li key={line.id} className="flex justify-between gap-3 py-2 text-sm">
              <span>{line.description}</span>
              <span className="font-semibold">{formatMoney(line.amountCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between"><dt>Items and charges</dt><dd>{formatMoney(sale.subtotalCents)}</dd></div>
          {sale.taxLines.map((t) => (
            <div key={t.id} className="flex justify-between text-ink-soft"><dt>{t.jurisdiction.name} tax</dt><dd>{formatMoney(t.taxCents)}</dd></div>
          ))}
          <div className="flex justify-between"><dt>Sales tax</dt><dd>{formatMoney(sale.taxCents)}</dd></div>
          <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd>{formatMoney(sale.amountDueCents)}</dd></div>
          {sale.amountPaidCents > 0 && <div className="flex justify-between"><dt>Paid so far</dt><dd>{formatMoney(sale.amountPaidCents)}</dd></div>}
        </dl>
      </Card>
      {sale.status !== "VOID" && (
        <SalePanel invoiceId={sale.id} owedCents={owed} canCancel={sale.amountPaidCents === 0 && ["DRAFT", "OPEN"].includes(sale.status)} today={businessDateKey(new Date())} />
      )}
    </main>
  );
}
