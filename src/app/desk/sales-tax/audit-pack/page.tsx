import Link from "next/link";
import { requireRole } from "@/lib/session";
import { buildAuditPack, parseAuditRange } from "@/domains/tax/tax-proof";
import { formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { PrintDocumentButton } from "@/components/print-document-button";
import { Button, Field, PageHeader } from "@/components/ui";

export const metadata = { title: "Audit pack", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AuditPackPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  const query = await searchParams;
  const range = parseAuditRange(query.from, query.to);
  const pack = "error" in range ? null : await buildAuditPack(range.from, range.to);
  const from = "error" in range ? query.from ?? "" : range.from;
  const to = "error" in range ? query.to ?? "" : range.to;
  return (
    <div>
      <PageHeader
        title="Audit pack"
        description="Every appliance and part you bought in a date range, with the seller, price, tax paid or use tax reported, the return and its confirmation number, and the receipt."
        secondaryActions={<div className="print:hidden"><PrintDocumentButton /></div>}
      />
      <form method="get" className="mb-6 flex flex-wrap items-end gap-4 print:hidden">
        <Field id="from" name="from" label="From" type="date" defaultValue={from} required />
        <Field id="to" name="to" label="To" type="date" defaultValue={to} required />
        <Button type="submit">Show</Button>
        {pack && <a className="underline" href={`/desk/sales-tax/audit-pack/export?from=${pack.from}&to=${pack.to}`}>Download spreadsheet</a>}
      </form>
      {"error" in range && <p role="alert" className="text-sm font-semibold text-danger">{range.error}</p>}
      {pack && (
        <section aria-label="Audit pack">
          <p className="mb-2 text-sm">
            {formatBusinessDate(businessDate(pack.from))} to {formatBusinessDate(businessDate(pack.to))} · {pack.rows.length} {pack.rows.length === 1 ? "item" : "items"} ·
            prices {formatMoney(pack.totals.priceCents)} · seller tax paid {formatMoney(pack.totals.sellerTaxPaidCents)} ·
            use tax reported {formatMoney(pack.totals.useTaxReportedCents)} · use tax not yet filed {formatMoney(pack.totals.useTaxDueCents)}
          </p>
          {pack.undatedAppliances > 0 && (
            <p className="mb-2 text-sm font-semibold">{pack.undatedAppliances} {pack.undatedAppliances === 1 ? "appliance has" : "appliances have"} no purchase date, so no date range can include {pack.undatedAppliances === 1 ? "it" : "them"}. <Link className="underline" href="/desk/inventory">Review inventory</Link></p>
          )}
          {pack.rows.length === 0 ? <p className="text-sm text-ink-soft">Nothing was bought in this range.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[60rem] border-collapse text-left text-sm">
                <caption className="sr-only">Purchases in the selected date range</caption>
                <thead>
                  <tr className="border-b">
                    {["Item", "Serial", "Seller", "Date", "Price", "Seller tax", "Use tax reported", "Return and confirmation", "Receipt"].map((h) => <th key={h} scope="col" className="p-2">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {pack.rows.map((r, i) => (
                    <tr key={i} className="border-b align-top">
                      <th scope="row" className="p-2 font-semibold"><Link className="underline" href={r.recordHref}>{r.assetNumber ? r.assetNumber + " " : ""}{r.item}</Link><span className="block text-xs font-normal text-ink-soft">{[r.manufacturer, r.model].filter(Boolean).join(" ")}</span></th>
                      <td className="p-2">{r.serial || "—"}</td>
                      <td className="p-2">{r.seller}{r.receiptNumber ? <span className="block text-xs text-ink-soft">Receipt {r.receiptNumber}</span> : null}</td>
                      <td className="p-2">{r.purchasedOn ? formatBusinessDate(r.purchasedOn) : "—"}</td>
                      <td className="p-2">{r.priceCents === null ? "—" : formatMoney(r.priceCents)}</td>
                      <td className="p-2">{r.sellerTaxPaidCents === null ? "—" : formatMoney(r.sellerTaxPaidCents)}</td>
                      <td className="p-2">{formatMoney(r.useTaxReportedCents)}{r.useTaxDueCents > 0 ? <span className="block text-xs">+ {formatMoney(r.useTaxDueCents)} not yet filed</span> : null}</td>
                      <td className="p-2">{r.returnName ? <>{r.returnName}<span className="block text-xs">{r.periodLabel}{r.confirmationNumber ? ` · confirmation ${r.confirmationNumber}` : ""}</span></> : <span className="text-xs">{r.outcome}</span>}</td>
                      <td className="p-2">{r.receipts.length ? r.receipts.map((l) => <a key={l.href} className="block underline" href={l.href}>{l.label}</a>) : "No receipt on file"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function businessDate(key: string): Date {
  return new Date(key + "T12:00:00Z");
}
