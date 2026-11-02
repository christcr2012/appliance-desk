import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSupplierById, getPurchaseOrdersPage } from "@/domains/purchasing";
import { listPurchases } from "@/domains/purchasing/purchases";
import { formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import {
  ButtonLink,
  EmptyState,
} from "@/components/ui";
import { RecordHeader } from "@/components/kit";
import { restoreSupplierAction } from "../../purchasing-actions";
import { OrdersList } from "../../purchases/orders-list";
import { SupplierDetailClient } from "./supplier-detail-client";
import { SupplierArchiveButton } from "./supplier-archive-button";
import { W9Panel } from "./w9-panel";
import { RecordConnections } from "@/components/desk/record-connections";

export const metadata = { title: "Supplier" };

const SUPPLIER_TABS = [
  { value: "purchases", label: "Purchases" },
  { value: "orders", label: "Orders" },
  { value: "details", label: "Details" },
] as const;
type SupplierTab = (typeof SUPPLIER_TABS)[number]["value"];

export default async function SupplierDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user } = await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const query = await searchParams;
  // Restore is a plain form action from the header overflow.
  if (query.restore === "1") {
    await restoreSupplierAction(id);
    redirect(`/desk/suppliers/${encodeURIComponent(id)}`);
  }
  // The orders tab used to be the ?open= target of the old orders DataList;
  // those links now land on the Orders tab itself.
  if (query.open) redirect(`/desk/suppliers/${encodeURIComponent(id)}?tab=orders`);
  const tab: SupplierTab =
    query.tab === "orders" || query.tab === "details" ? query.tab : "purchases";
  const supplier = await getSupplierById(id);

  if (!supplier) {
    notFound();
  }
  const archived = supplier.archivedAt !== null;

  return (
    <div className="max-w-3xl">
      <RecordHeader
        title={supplier.name}
        subtitle="Supplier contact details, purchasing availability, and purchase-order history."
        contact={{
          phone: supplier.phone ?? undefined,
          email: supplier.email ?? undefined,
        }}
        back={{ href: "/desk/suppliers", label: "Suppliers" }}
        overflow={[
          archived
            ? {
                kind: "link",
                label: "Restore supplier",
                href: `/desk/suppliers/${supplier.id}?restore=1`,
              }
            : {
                kind: "link",
                label: "Archive supplier…",
                href: `/desk/suppliers/${supplier.id}?archive=1`,
              },
        ]}
      />

      <nav aria-label="Supplier sections" className="mt-2 mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {SUPPLIER_TABS.map((t) => (
          <Link
            key={t.value}
            href={`/desk/suppliers/${supplier.id}?tab=${t.value}`}
            aria-current={tab === t.value ? "page" : undefined}
            className={`whitespace-nowrap px-3 py-2 text-sm font-semibold ${
              tab === t.value
                ? "border-b-2 border-primary text-ink"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "purchases" && <SupplierPurchasesTab supplierId={supplier.id} />}
      {tab === "orders" && <SupplierOrdersTab supplierId={supplier.id} />}
      {tab === "details" && (
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

          {supplier.is1099Vendor ? (
            <W9Panel
              supplierId={supplier.id}
              legalName={supplier.legalName ?? supplier.name}
              tinLast4={supplier.tinLast4}
              tinType={supplier.tinType}
              w9ReceivedOn={supplier.w9ReceivedOn ? supplier.w9ReceivedOn.toLocaleDateString("en-US", { timeZone: "America/Denver" }) : null}
              backupWithholding={supplier.backupWithholding}
              isOwner={user.role === "OWNER"}
              mailingAddress={
                supplier.mailingAddress
                  ? [supplier.mailingAddress, supplier.mailingCity, supplier.mailingState, supplier.mailingZip].filter(Boolean).join(", ")
                  : null
              }
              hasW9File={supplier.w9FileUrl != null}
            />
          ) : null}
        </div>
      )}

      {/* Archive lives in the header overflow: ?archive=1 opens its
          confirmation here (restore is a one-tap link in the same menu). */}
      {!archived && query.archive === "1" && (
        <SupplierArchiveButton supplierId={supplier.id} name={supplier.name} />
      )}
      <RecordConnections kind="seller" id={id} />
    </div>
  );
}

async function SupplierPurchasesTab({ supplierId }: { supplierId: string }) {
  const { rows: purchases } = await listPurchases({ supplierId, take: 50 });
  return (
    <section aria-labelledby="supplier-purchases">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="supplier-purchases" className="text-lg font-semibold text-ink">Purchases</h2>
        <ButtonLink href="/desk/purchases/new" variant="secondary">Record a purchase</ButtonLink>
      </div>
      {purchases.length === 0 ? (
        <EmptyState title="No recorded purchases" description="Receipts you record from this supplier appear here." />
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {purchases.map((p) => (
            <li key={p.id}>
              <Link
                href={`/desk/purchases/${p.id}`}
                className="flex flex-col gap-1 p-4 hover:bg-subtle sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="font-semibold text-ink">{formatBusinessDate(p.purchasedOn)}</span>
                <span className="text-sm text-ink-soft">
                  {p._count.appliances} {p._count.appliances === 1 ? "appliance" : "appliances"}
                </span>
                <span className="font-semibold text-ink sm:ml-auto">{formatMoney(p.receiptTotalCents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function SupplierOrdersTab({ supplierId }: { supplierId: string }) {
  const [open, received, cancelled] = await Promise.all([
    getPurchaseOrdersPage({ supplierId, status: "open", take: 50 }),
    getPurchaseOrdersPage({ supplierId, status: "received", take: 50 }),
    getPurchaseOrdersPage({ supplierId, status: "cancelled", take: 50 }),
  ]);
  const orders = [...open.rows, ...received.rows, ...cancelled.rows].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1),
  );
  return (
    <section aria-labelledby="supplier-purchase-orders">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="supplier-purchase-orders" className="text-lg font-semibold text-ink">Purchase orders</h2>
        <ButtonLink href="/desk/purchase-orders/new" variant="secondary">New purchase order</ButtonLink>
      </div>
      {orders.length === 0 ? (
        <EmptyState
          title="No purchase orders yet"
          description="Start a purchase order when you are ready to buy from this supplier."
        />
      ) : (
        <OrdersList rows={orders} nextHref={null} />
      )}
    </section>
  );
}
