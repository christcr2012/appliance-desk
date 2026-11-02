import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getPurchaseDetail } from "@/domains/purchasing/purchases";
import { formatBusinessDate } from "@/lib/business-date";
import { formatMoney, moneyInputValue } from "@/lib/money-ui";
import { privatePhotoReadPath } from "@/lib/photo-storage";
import { Card } from "@/components/ui";
import { RecordHeader, StatStrip } from "@/components/kit";
import { PurchaseTaxForm } from "./purchase-tax-form";
import { AddReceipt, RemoveReceiptPage } from "./add-receipt";
import { RecordConnections } from "@/components/desk/record-connections";

export const metadata = { title: "Purchase" };

const ANSWER_OF = { COLORADO: "YES_COLORADO", OTHER_STATE: "YES_OTHER_STATE", NONE: "NO", UNKNOWN: "LATER" } as const;

/**
 * AR-6b section 5: the purchase record — RecordHeader, the StatStrip
 * (Date · Receipt total · Seller tax · Appliances) and tabs over the
 * existing panels: Appliances, Receipt pages, Sales tax (owner only).
 */
export default async function PurchasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN");
  const purchase = await getPurchaseDetail((await params).id);
  if (!purchase) notFound();
  const isOwner = session.user.role === "OWNER";
  const { tab: tabRaw } = await searchParams;
  const tab =
    tabRaw === "receipts" || (tabRaw === "tax" && isOwner) ? tabRaw : "appliances";
  const seller = purchase.supplier?.name ?? purchase.sellerName ?? "Unknown seller";
  const tabs = [
    { key: "appliances", label: "Appliances" },
    { key: "receipts", label: "Receipt pages" },
    ...(isOwner ? [{ key: "tax", label: "Sales tax" }] : []),
  ];
  return (
    <div className="max-w-4xl space-y-6">
      <RecordHeader
        title={`Purchase from ${seller}`}
        subtitle={`${formatBusinessDate(purchase.purchasedOn)}${purchase.reference ? ` · Receipt ${purchase.reference}` : ""}`}
        back={{ href: "/desk/purchases", label: "Purchases" }}
      />

      <StatStrip
        items={[
          { label: "Date", value: formatBusinessDate(purchase.purchasedOn) },
          { label: "Receipt total", value: formatMoney(purchase.receiptTotalCents) },
          { label: "Seller tax", value: formatMoney(purchase.sellerTaxCents) },
          {
            label: "Appliances",
            value: String(purchase.appliances.length),
          },
        ]}
      />

      <nav aria-label="Purchase sections" className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/desk/purchases/${purchase.id}?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`whitespace-nowrap px-3 py-2 text-sm font-semibold ${
              tab === t.key
                ? "border-b-2 border-primary text-ink"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "appliances" && (
        <>
          <Card title="Receipt totals">
            <dl className="grid gap-2 text-sm sm:grid-cols-4">
              <div><dt className="text-ink-soft">Appliance prices</dt><dd className="font-semibold">{formatMoney(purchase.subtotalCents)}</dd></div>
              <div><dt className="text-ink-soft">Seller tax</dt><dd className="font-semibold">{formatMoney(purchase.sellerTaxCents)}</dd></div>
              <div><dt className="text-ink-soft">Delivery / other</dt><dd className="font-semibold">{formatMoney(purchase.otherChargesCents)}</dd></div>
              <div><dt className="text-ink-soft">Receipt total</dt><dd className="font-semibold">{formatMoney(purchase.receiptTotalCents)}</dd></div>
            </dl>
            {!purchase.pricesStillMatchReceipt && (
              <p className="mt-3 text-sm font-semibold">An appliance price was corrected after this purchase was recorded, so today&apos;s prices no longer add up to the receipt.</p>
            )}
            {purchase.notes && <p className="mt-3 text-sm">{purchase.notes}</p>}
          </Card>

          <Card title="Appliances and their tax next step">
            <ul className="space-y-3">
              {purchase.appliances.map((a) => (
                <li key={a.id} className="rounded-lg border border-border p-3 text-sm">
                  <Link href={`/desk/inventory/${a.id}`} className="font-semibold underline">{a.applianceType.name} {a.assetNumber}</Link>
                  {" "}— {[a.manufacturer, a.model].filter(Boolean).join(" ") || "model not entered"}
                  {a.serialNumber ? `, serial ${a.serialNumber}` : ""} · {formatMoney(a.acquisitionCostCents ?? 0)} · tax share {formatMoney(a.taxShareCents)}
                  <p className="mt-1 font-semibold">{a.step.headline}</p>
                  <p className="text-ink-soft">{a.step.detail}</p>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {tab === "receipts" && (
        <Card title="Receipt pages">
          {purchase.documents.length === 0 ? <p className="text-sm text-ink-soft">No receipt attached yet.</p> : (
            <ul className="mb-3 space-y-1 text-sm">
              {purchase.documents.map((doc) => (
                <li key={doc.id}><a className="underline" href={privatePhotoReadPath(doc.photoId)} target="_blank" rel="noreferrer">Receipt page {doc.pageOrder}</a><RemoveReceiptPage purchaseId={purchase.id} documentId={doc.id} /></li>
              ))}
            </ul>
          )}
          <AddReceipt purchaseId={purchase.id} />
        </Card>
      )}

      {tab === "tax" && isOwner && (
        <Card title="Sales tax answer" description="Changing this updates every appliance on the purchase. If a return was already filed, a “correct your return” To do is created.">
          <PurchaseTaxForm
            purchaseId={purchase.id} revisionAt={purchase.taxRevisionAt.toISOString()}
            initialAnswer={ANSWER_OF[purchase.sellerTaxKind]}
            initialTax={purchase.sellerTaxCents ? moneyInputValue(purchase.sellerTaxCents) : ""}
            initialState={purchase.sellerTaxState ?? ""}
          />
        </Card>
      )}
      <RecordConnections kind="purchase" id={purchase.id} />
    </div>
  );
}
