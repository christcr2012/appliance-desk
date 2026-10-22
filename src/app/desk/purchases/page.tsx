import Link from "next/link";
import { requireRole } from "@/lib/session";
import { countPurchases, listPurchases } from "@/domains/purchasing/purchases";
import { formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { parsePage, paginationMeta } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";
import { ButtonLink, DataList, EmptyState, PageHeader, type DataListColumn } from "@/components/ui";
import { BudgetContextCard } from "@/domains/budget/context";

export const metadata = { title: "Purchases" };

type Row = Awaited<ReturnType<typeof listPurchases>>[number];

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await requireRole("OWNER", "ADMIN");
  const meta = paginationMeta(await countPurchases(), parsePage((await searchParams).page));
  const purchases = await listPurchases({ skip: meta.skip, take: meta.pageSize });
  const columns: DataListColumn<Row>[] = [
    { key: "date", header: "Date", primary: true, cell: (p) => (
      <Link href={`/desk/purchases/${p.id}`} className="font-semibold underline-offset-4 hover:underline">{formatBusinessDate(p.purchasedOn)}</Link>) },
    { key: "seller", header: "Seller", cell: (p) => p.supplier?.name ?? p.sellerName ?? "—" },
    { key: "appliances", header: "Appliances", cell: (p) => String(p._count.appliances) },
    { key: "total", header: "Receipt total", cell: (p) => formatMoney(p.subtotalCents + p.sellerTaxCents + p.otherChargesCents) },
    { key: "receipts", header: "Receipt pages", cell: (p) => String(p._count.documents) },
  ];
  return (
    <div>
      <PageHeader
        title="Purchases"
        description="Every receipt for appliances you bought, with its seller, tax and the appliances it covers."
        primaryAction={<ButtonLink href="/desk/purchases/new">Record a purchase</ButtonLink>}
        secondaryActions={
          <>
            <ButtonLink href="/desk/sales-tax/audit-pack" variant="secondary">Audit pack</ButtonLink>
            {session.user.role === "OWNER" && <ButtonLink href="/desk/sales-tax/record-retention" variant="secondary">Record keeping</ButtonLink>}
          </>
        }
      />
      <BudgetContextCard userId={session.user.id} heading="Purchase commitments and replacement reserves"/>
      <DataList
        rows={purchases} columns={columns} caption="Purchases"
        empty={<EmptyState title="No purchases yet" description="Record a purchase when you buy appliances; it replaces adding appliances one at a time." />}
      />
      <Pagination page={meta.page} totalPages={meta.totalPages} totalCount={meta.totalCount}
        buildHref={(page) => (page > 1 ? `/desk/purchases?page=${page}` : "/desk/purchases")} />
    </div>
  );
}
