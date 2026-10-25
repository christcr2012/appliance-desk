import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { getShopSale, saleBuyerLabel } from "@/domains/sales";
import { Card, PageHeader, StatusPill } from "@/components/ui";
import { formatMoney } from "@/lib/money-ui";
import { businessDateKey } from "@/lib/business-date";
import type { StatusTone } from "@/components/status-badge";
import { SalePanel } from "./sale-panel";
import { FollowUpButton } from "./follow-up-button";
import { ResaleTaxNote } from "../resale-tax-note";
import type { ResaleTaxStatus } from "@/domains/sales/retired-sale-tax";

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
  const returned = await prisma.auditLog.findFirst({ where: { action: "sale.return", entityType: "Invoice", entityId: sale.id }, select: { id: true } });
  const canReturn = !returned && sale.status === "PAID" && sale.amountPaidCents > 0 && sale.lineItems.every((l) => !l.applianceId);
  const owed = Math.max(0, sale.amountDueCents - sale.amountPaidCents);
  const isOwner = session.user.role === "OWNER";
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
          {returned && <p className="text-sm font-semibold">Taken back and refunded</p>}
          {sale.status !== "VOID" && !returned && <p className="text-sm text-ink-soft">{owed > 0 ? `${formatMoney(owed)} still owed` : "Nothing owed"}</p>}
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
      {sale.retiredSaleDispositions.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold">Income-tax notes for the used appliance{sale.retiredSaleDispositions.length > 1 ? "s" : ""} on this sale</h2>
          <p className="mt-1 text-sm text-ink-soft">Saved when the sale was made. This is information for you and your accountant. It never changed the price and it is not a tax return.</p>
          <div className="mt-3 space-y-4">
            {sale.retiredSaleDispositions.map((d) => (
              <div key={d.id} className="space-y-2">
                <h3 className="font-semibold">{d.appliance.assetNumber} · sold for {formatMoney(d.priceCents)}</h3>
                <ResaleTaxNote
                  bookValueCents={d.bookCarriedCents}
                  estimate={{
                    status: d.taxStatus as ResaleTaxStatus,
                    netProceedsCents: d.priceCents - d.sellerCostsCents,
                    reasons: d.reviewReasons,
                    adjustedBasisCents: d.adjustedBasisCents,
                    totalDepreciationCents: d.totalDepreciationCents,
                    taxGainCents: d.taxGainCents,
                    potentialRecaptureCents: d.potentialRecaptureCents,
                    otherGainCents: d.otherGainCents,
                  }}
                />
                {d.cancelledAt ? (
                  <p className="text-sm text-ink-soft">This sale was cancelled, so there is nothing to follow up.</p>
                ) : d.followUpDoneAt ? (
                  <p className="text-sm text-ink-soft">Nothing more to follow up with your accountant on this one.</p>
                ) : isOwner ? (
                  <FollowUpButton dispositionId={d.id} invoiceId={sale.id} />
                ) : (
                  <p className="text-sm text-ink-soft">The owner still needs to go over this with the accountant.</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
      {sale.status !== "VOID" && !returned && (
        <SalePanel invoiceId={sale.id} owedCents={owed} canCancel={sale.amountPaidCents === 0 && ["DRAFT", "OPEN"].includes(sale.status)} canReturn={canReturn} today={businessDateKey(new Date())} />
      )}
    </main>
  );
}
