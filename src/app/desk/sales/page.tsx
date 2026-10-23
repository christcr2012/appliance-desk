import Link from "next/link";
import { requireRole } from "@/lib/session";
import { listShopSales, saleBuyerLabel, SALE_LIST_LIMIT } from "@/domains/sales";
import { EmptyState, PageHeader } from "@/components/ui";
import { StatusPill } from "@/components/ui";
import { formatMoney } from "@/lib/money-ui";
import type { StatusTone } from "@/components/status-badge";

export const metadata = { title: "Shop sales" };

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  DRAFT: { label: "Not paid", tone: "pending" },
  OPEN: { label: "Not paid", tone: "pending" },
  PARTIALLY_PAID: { label: "Part paid", tone: "progress" },
  PAID: { label: "Paid", tone: "success" },
  VOID: { label: "Cancelled", tone: "stopped" },
  REFUNDED: { label: "Refunded", tone: "stopped" },
};

export default async function ShopSalesPage() {
  const session = await requireRole("OWNER", "ADMIN");
  const sales = await listShopSales(session.user.id);
  return (
    <main className="space-y-6">
      <PageHeader
        title="Shop sales"
        description="Parts and used appliances you sell over the counter or deliver. Rental billing is separate and is not affected."
        primaryAction={{ href: "/desk/sales/new", label: "New sale" }}
      />
      {sales.length === 0 ? (
        <EmptyState
          title="No sales yet"
          description="Mark a part “Sell to customers” on the Parts screen, then ring up your first sale here."
        />
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {sales.map((sale) => {
            const status = STATUS[sale.status] ?? { label: sale.status, tone: "pending" as StatusTone };
            return (
              <li key={sale.id}>
                <Link href={`/desk/sales/${sale.id}`} className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-surface-muted">
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">
                      Sale #{sale.invoiceNumber} · {saleBuyerLabel(sale)}
                    </span>
                    <span className="block truncate text-sm text-ink-soft">
                      {sale.lineItems.map((l) => l.description).join("; ") || "Delivery or installation only"}
                    </span>
                    <span className="block text-xs text-ink-soft">
                      {sale.createdAt.toLocaleDateString("en-US", { timeZone: "America/Denver" })} · {sale.saleLocation === "DELIVERED" ? "Delivered" : "Picked up"}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <StatusPill tone={status.tone} label={status.label} />
                    <span className="font-semibold">{formatMoney(sale.amountDueCents)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {sales.length >= SALE_LIST_LIMIT && (
        <p className="text-sm text-ink-soft">Showing the {SALE_LIST_LIMIT} most recent sales.</p>
      )}
    </main>
  );
}
