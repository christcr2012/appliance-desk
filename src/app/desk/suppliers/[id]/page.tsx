import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSupplierById } from "@/domains/purchasing";
import { listPurchases } from "@/domains/purchasing/purchases";
import { formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { formatCents } from "@/domains/pricing";
import {
  ButtonLink,
  DataList,
  EmptyState,
  PageHeader,
  type DataListColumn,
} from "@/components/ui";
import { SupplierDetailClient } from "./supplier-detail-client";
import { SupplierArchiveButton } from "./supplier-archive-button";
import { W9Panel } from "./w9-panel";
import { RecordConnections } from "@/components/desk/record-connections";

export const metadata = { title: "Supplier" };

type SupplierRecord = NonNullable<Awaited<ReturnType<typeof getSupplierById>>>;
type PurchaseOrderRow = SupplierRecord["purchaseOrders"][number];

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const supplier = await getSupplierById(id);
  const purchases = supplier ? await listPurchases({ supplierId: supplier.id, take: 50 }) : [];

  if (!supplier) {
    notFound();
  }

  const columns: DataListColumn<PurchaseOrderRow>[] = [
    {
      key: "order",
      header: "Purchase order",
      primary: true,
      cell: (order) => (
        <Link
          href={`/desk/purchase-orders/${order.id}`}
          className="font-semibold text-ink underline-offset-4 hover:underline"
        >
          {new Date(order.createdAt).toLocaleDateString()}
        </Link>
      ),
    },
    {
      key: "lines",
      header: "Lines",
      cell: (order) =>
        `${order.lines.length} ${order.lines.length === 1 ? "line" : "lines"}`,
    },
    {
      key: "status",
      header: "Status",
      cell: (order) => order.status,
    },
    {
      key: "total",
      header: "Known total",
      cell: (order) => {
        const totalCents = order.lines.reduce(
          (sum, line) =>
            sum +
            (line.unitCostKnown ? line.unitCostCents * line.quantity : 0),
          0,
        );
        const unpriced = order.lines.filter(
          (line) => !line.unitCostKnown,
        ).length;
        return (
          <span>
            {formatCents(totalCents)}
            {unpriced > 0 ? ` + ${unpriced} unpriced` : ""}
          </span>
        );
      },
    },
  ];

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={supplier.name}
        description="Supplier contact details, purchasing availability, and purchase-order history."
        secondaryActions={
          <ButtonLink href="/desk/suppliers" variant="secondary">
            All suppliers
          </ButtonLink>
        }
      />

      <div className="space-y-6">
        <SupplierDetailClient
          supplierId={supplier.id}
          initial={{
            name: supplier.name,
            contactName: supplier.contactName ?? "",
            phone: supplier.phone ?? "",
            email: supplier.email ?? "",
            notes: supplier.notes ?? "",
          }}
        />

        <SupplierArchiveButton
          supplierId={supplier.id}
          archived={supplier.archivedAt !== null}
        />

        {supplier.is1099Vendor ? (
          <W9Panel
            supplierId={supplier.id}
            legalName={supplier.legalName ?? supplier.name}
            tinLast4={supplier.tinLast4}
            tinType={supplier.tinType}
            w9ReceivedOn={supplier.w9ReceivedOn ? supplier.w9ReceivedOn.toLocaleDateString("en-US", { timeZone: "America/Denver" }) : null}
            backupWithholding={supplier.backupWithholding}
            isOwner={user.role === "OWNER"}
          />
        ) : null}

        <section aria-labelledby="supplier-purchases">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="supplier-purchases" className="text-lg font-semibold text-ink">Purchases</h2>
            <ButtonLink href="/desk/purchases/new" variant="secondary">Record a purchase</ButtonLink>
          </div>
          <DataList
            rows={purchases}
            caption="Supplier purchases"
            columns={[
              { key: "date", header: "Date", primary: true, cell: (p) => (
                <Link href={`/desk/purchases/${p.id}`} className="font-semibold underline-offset-4 hover:underline">{formatBusinessDate(p.purchasedOn)}</Link>) },
              { key: "appliances", header: "Appliances", cell: (p) => String(p._count.appliances) },
              { key: "total", header: "Receipt total", cell: (p) => formatMoney(p.subtotalCents + p.sellerTaxCents + p.otherChargesCents) },
            ]}
            empty={<EmptyState title="No recorded purchases" description="Receipts you record from this supplier appear here." />}
          />
        </section>

        <section aria-labelledby="supplier-purchase-orders">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2
              id="supplier-purchase-orders"
              className="text-lg font-semibold text-ink"
            >
              Purchase orders
            </h2>
            <ButtonLink
              href="/desk/purchase-orders/new"
              variant="secondary"
            >
              New purchase order
            </ButtonLink>
          </div>

          <DataList
            rows={supplier.purchaseOrders}
            columns={columns}
            caption="Supplier purchase orders"
            empty={
              <EmptyState
                title="No purchase orders yet"
                description="Start a purchase order when you are ready to buy from this supplier."
              />
            }
          />
        </section>
      </div>
      <RecordConnections kind="seller" id={id} />
    </div>
  );
}
