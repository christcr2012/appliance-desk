import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { listShopSales, saleBuyerLabel, SALE_LIST_LIMIT } from "@/domains/sales";
import { EmptyState } from "@/components/ui";
import { StatusPill } from "@/components/ui";
import { DataTable, ScreenHeader, Toolbar, type Column, type FilterDef } from "@/components/kit";
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

type SaleRow = Awaited<ReturnType<typeof listShopSales>>[number];

export default async function ShopSalesPage({ searchParams }: { searchParams: Promise<{ followUp?: string; open?: string }> }) {
  const session = await requireRole("OWNER", "ADMIN");
  const params = await searchParams;
  // The kit table's row click sets ?open=<id> (its side-panel convention).
  // Sales have no side panel — the record page IS the destination, as it
  // was before the redesign — so an ?open= link goes straight there.
  if (params.open) redirect(`/desk/sales/${encodeURIComponent(params.open)}`);
  const followUpOnly = params.followUp === "1";
  const sales = await listShopSales(session.user.id, { followUpOnly });

  const columns: Column<SaleRow>[] = [
    {
      key: "sale",
      header: "Sale",
      cell: (sale) => (
        <div>
          <span className="font-semibold text-ink">
            Sale #{sale.invoiceNumber} · {saleBuyerLabel(sale)}
          </span>
          <span className="block truncate text-sm font-normal text-ink-soft">
            {sale.lineItems.map((l) => l.description).join("; ") || "Delivery or installation only"}
          </span>
          <span className="block text-xs font-normal text-ink-soft">
            {sale.createdAt.toLocaleDateString("en-US", { timeZone: "America/Denver" })} · {sale.saleLocation === "DELIVERED" ? "Delivered" : "Picked up"}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (sale) => {
        const status = STATUS[sale.status] ?? { label: sale.status, tone: "pending" as StatusTone };
        return <StatusPill tone={status.tone} label={status.label} />;
      },
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (sale) => <span className="font-semibold">{formatMoney(sale.amountDueCents)}</span>,
    },
  ];

  return (
    <main className="space-y-6">
      <div>
        <ScreenHeader
          title="Shop sales"
          list
          primary={{ kind: "link", href: "/desk/sales/new", label: "New sale" }}
        />
        <p className="-mt-2 pb-2 text-sm text-ink-soft">
          Parts and used appliances you sell over the counter or deliver. Rental billing is separate and is not affected.
        </p>
        <Toolbar
          filters={[
            { kind: "toggle", param: "followUp", label: "Used appliance sales still to go over with your accountant" },
          ] satisfies FilterDef[]}
        />
      </div>
      {followUpOnly && (
        <p role="status" className="rounded-md border border-line bg-surface-subtle p-3 text-sm">
          Showing only used appliance sales still to go over with your accountant. <Link href="/desk/sales" className="underline">Show all sales</Link>
        </p>
      )}
      <DataTable
        rows={sales}
        rowKey={(sale) => sale.id}
        columns={columns}
        caption="Shop sales"
        rowHref={(sale) => `/desk/sales/${sale.id}`}
        mobileCard={(sale) => {
          const status = STATUS[sale.status] ?? { label: sale.status, tone: "pending" as StatusTone };
          return (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">{columns[0].cell(sale)}</span>
              <span className="flex items-center gap-3">
                <StatusPill tone={status.tone} label={status.label} />
                <span className="font-semibold">{formatMoney(sale.amountDueCents)}</span>
              </span>
            </div>
          );
        }}
        empty={
          <EmptyState
            title={followUpOnly ? "Nothing to go over" : "No sales yet"}
            description={followUpOnly ? "Every used appliance sale has been gone over with your accountant." : "Mark a part “Sell to customers” on the Parts screen, then ring up your first sale here."}
          />
        }
      />
      {sales.length >= SALE_LIST_LIMIT && (
        <p className="text-sm text-ink-soft">Showing the {SALE_LIST_LIMIT} most recent sales.</p>
      )}
    </main>
  );
}
