import Link from "next/link";
import { formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import type { TaxProof } from "@/domains/tax/tax-proof";

/** W-15: how this appliance was acquired, what it cost, exactly one tax outcome, and the paperwork. Owner and admin only. */
export function TaxProofPanel({ proof }: { proof: TaxProof }) {
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="tax-proof-heading">
      <h2 id="tax-proof-heading" className="text-lg font-semibold">Tax proof</h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-soft">How it was acquired</dt>
          <dd className="font-semibold">
            {proof.acquired.kind === "PURCHASE"
              ? <>Bought from {proof.acquired.seller}{proof.purchasedOn ? ` on ${formatBusinessDate(proof.purchasedOn)}` : ""}{" "}
                  (<Link className="underline" href={`/desk/purchases/${proof.acquired.purchaseId}`}>purchase record</Link>)</>
              : <>Added without a purchase record{proof.purchasedOn ? `, dated ${formatBusinessDate(proof.purchasedOn)}` : ""}</>}
          </dd>
        </div>
        <div>
          <dt className="text-ink-soft">Price paid</dt>
          <dd className="font-semibold">{proof.priceCents === null ? "Not entered" : formatMoney(proof.priceCents)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-ink-soft">Tax outcome</dt>
          <dd><span className="font-semibold">{proof.step.headline}</span><span className="block text-ink-soft">{proof.step.detail}</span></dd>
        </div>
        {proof.sellerTaxPaidCents !== null && (
          <div><dt className="text-ink-soft">Seller tax paid</dt><dd className="font-semibold">{formatMoney(proof.sellerTaxPaidCents)}</dd></div>
        )}
        {(proof.useTaxReportedCents > 0 || proof.useTaxDueCents > 0) && (
          <div>
            <dt className="text-ink-soft">Use tax</dt>
            <dd className="font-semibold">{formatMoney(proof.useTaxReportedCents)} reported{proof.useTaxDueCents > 0 ? `, ${formatMoney(proof.useTaxDueCents)} not yet filed` : ""}</dd>
          </div>
        )}
      </dl>
      {proof.useTaxRows.some((row) => row.returnName) && (
        <ul className="text-sm">
          {proof.useTaxRows.filter((row) => row.returnName).map((row, i) => (
            <li key={i}>{row.jurisdiction}: {formatMoney(row.amountCents)} on {row.returnName} ({row.periodLabel}){row.confirmationNumber ? `, confirmation ${row.confirmationNumber}` : row.filedOn ? "" : ", not filed yet"}</li>
          ))}
        </ul>
      )}
      <p className="text-sm">
        Receipt:{" "}
        {proof.receipts.length === 0
          ? "none on file yet."
          : proof.receipts.map((link, i) => <span key={link.href}>{i > 0 ? ", " : ""}<a className="underline" href={link.href} target="_blank" rel="noreferrer">{link.label}</a></span>)}
      </p>
    </section>
  );
}
