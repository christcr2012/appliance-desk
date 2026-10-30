import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { countPurchases, listPurchases } from "@/domains/purchasing/purchases";
import { formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { parsePage, paginationMeta } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/ui";
import { DataTable, ScreenHeader, type Column } from "@/components/kit";
import { BudgetContextCard } from "@/domains/budget/context";

export const metadata = { title: "Purchases" };

type Row = Awaited<ReturnType<typeof listPurchases>>[number];

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ page?: string; open?: string }> }) {
  const session = await requireRole("OWNER", "ADMIN");
  const purchasesParams = await searchParams;
  // The kit table's row click sets ?open=<id> (its side-panel convention).
  // Purchases have no side panel — the record page IS the destination, as
  // it was before the redesign — so an ?open= link goes straight there.
  if (purchasesParams.open) redirect(`/desk/purchases/${encodeURIComponent(purchasesParams.open)}`);
  const meta = paginationMeta(await countPurchases(), parsePage(purchasesParams.page));
  const purchases = await listPurchases({ skip: meta.skip, take: meta.pageSize });
  const columns: Column<Row>[] = [
    { key: "date", header: "Date", cell: (p) => (
      <span className="font-semibold">{formatBusinessDate(p.purchasedOn)}</span>) },
    { key: "seller", header: "Seller", cell: (p) => p.supplier?.name ?? p.sellerName ?? "—" },
    { key: "appliances", header: "Appliances", cell: (p) => String(p._count.appliances) },
    { key: "total", header: "Receipt total", cell: (p) => formatMoney(p.subtotalCents + p.sellerTaxCents + p.otherChargesCents) },
    { key: "receipts", header: "Receipt pages", cell: (p) => String(p._count.documents) },
  ];
  return (
    <div>
      <ScreenHeader
        title="Purchases"
        list
        primary={{ kind: "link", label: "Record a purchase", href: "/desk/purchases/new" }}
        overflow={[
          { kind: "link", label: "Audit pack", href: "/desk/sales-tax/audit-pack" },
          ...(session.user.role === "OWNER"
            ? [{ kind: "link", label: "Record keeping", href: "/desk/sales-tax/record-retention" } as const]
            : []),
        ]}
      />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        Every receipt for appliances you bought, with its seller, tax and the appliances it covers.
      </p>
      <BudgetContextCard userId={session.user.id} heading="Purchase commitments and replacement reserves"/>
      <DataTable
        rows={purchases}
        rowKey={(p) => p.id}
        columns={columns}
        caption="Purchases"
        rowHref={(p) => `/desk/purchases/${p.id}`}
        mobileCard={(p) => (
          <div>
            {columns[0].cell(p)}
            <p className="mt-1 text-sm text-ink-soft">
              {p.supplier?.name ?? p.sellerName ?? "—"} · {formatMoney(p.subtotalCents + p.sellerTaxCents + p.otherChargesCents)}
            </p>
          </div>
        )}
        empty={<EmptyState title="No purchases yet" description="Record a purchase when you buy appliances; it replaces adding appliances one at a time." />}
      />
      <Pagination page={meta.page} totalPages={meta.totalPages} totalCount={meta.totalCount}
        buildHref={(page) => (page > 1 ? `/desk/purchases?page=${page}` : "/desk/purchases")} />
    </div>
  );
}
