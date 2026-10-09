"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PendingPurchaseTaxExplanation } from "@/domains/tax/purchase-tax-explain";
import { saveAppliancePurchaseTaxAction } from "./tax-actions";

type Choice = "SELLER_CHARGED" | "NONE_CHARGED" | "LESSOR_PERMISSION" | "LATER";

const CHOICES: { value: Choice; label: string }[] = [
  { value: "SELLER_CHARGED", label: "Seller charged sales tax" },
  { value: "NONE_CHARGED", label: "Seller did not charge tax" },
  { value: "LESSOR_PERMISSION", label: "Purchased tax-free with lessor permission" },
  { value: "LATER", label: "Record or verify tax later" },
];

export function AppliancePurchaseTaxPanel({
  appliance,
}: {
  appliance: {
    id: string;
    acquisitionTaxStatus: string;
    acquisitionTaxChoice: string | null;
    acquisitionTaxPaidCents: number | null;
    acquisitionSellerNote: string | null;
    acquisitionReceiptPhotoId: string | null;
    acquisitionTaxRecordedAt: string | null;
    hasPurchaseContext: boolean;
    pendingTax: PendingPurchaseTaxExplanation | null;
    photos: { id: string; description: string }[];
  };
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<Choice>(
    CHOICES.find((row) => row.value === appliance.acquisitionTaxChoice)?.value ?? "LATER",
  );
  const [vendorTaxDollars, setVendorTaxDollars] = useState(
    appliance.acquisitionTaxPaidCents === null ? "0.00" : (appliance.acquisitionTaxPaidCents / 100).toFixed(2),
  );
  const [sellerNote, setSellerNote] = useState(appliance.acquisitionSellerNote ?? "");
  const [receiptPhotoId, setReceiptPhotoId] = useState(appliance.acquisitionReceiptPhotoId ?? "");
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <section className="rounded-lg border p-4 space-y-4" aria-labelledby="purchase-tax-heading">
      <h2 id="purchase-tax-heading" className="text-lg font-semibold">Tax when this appliance was purchased</h2>
      <p className="text-sm">Current record: <strong>{appliance.acquisitionTaxStatus.replaceAll("_", " ").toLowerCase()}</strong>.</p>
      {appliance.pendingTax?.reason && <p role="status" className="text-sm">
        {({
          ANSWER_LATER: "This appliance still needs a purchase-tax answer.",
          PURCHASE_DATE_OR_COST_MISSING: "Purchase date or cost is missing.",
          ELECTION_UNDECIDED: "The business purchase-tax election is not chosen yet.",
          BUSINESS_ADDRESS_UNVERIFIED: "Your business address tax areas need confirmation.",
          RATES_UNREVIEWED: "Business tax-area rates still need review.",
        } as const)[appliance.pendingTax.reason]}
        {" "}{appliance.pendingTax.fixHref && <Link className="font-medium underline"
          href={appliance.pendingTax.fixHref}>{appliance.pendingTax.fixLabel}</Link>}
      </p>}
      {!appliance.hasPurchaseContext && (
        <p className="text-sm text-ink-soft" role="note">
          Purchase date or cost is missing. You can record the seller&apos;s answer now,
          but the system will keep this purchase in the needs-review queue until both are available.
        </p>
      )}
      <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault();
        setNotice(null);
        const dollars = Number(vendorTaxDollars);
        if (!Number.isFinite(dollars) || dollars < 0) {
          setNotice({ ok: false, message: "Enter a valid tax amount." });
          return;
        }
        startTransition(async () => {
          const result = await saveAppliancePurchaseTaxAction(appliance.id, {
            choice,
            vendorTaxDollars: choice === "SELLER_CHARGED" ? dollars : 0,
            sellerNote,
            receiptPhotoId: receiptPhotoId.trim() || undefined,
            expectedRecordedAt: appliance.acquisitionTaxRecordedAt,
          });
          if (result.status === "success") router.refresh();
          setNotice(result.status === "success"
            ? { ok: true, message: "Purchase-tax evidence saved. Refresh the record to see the updated classification." }
            : { ok: false, message: result.message });
        });
      }}>
        <label htmlFor="purchase-tax-choice" className="block text-sm font-medium">What happened when you bought it?</label>
        <select id="purchase-tax-choice" value={choice}
          onChange={(event) => setChoice(event.target.value as Choice)}
          className="w-full rounded-md border bg-surface p-2">
          {CHOICES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        {choice === "SELLER_CHARGED" && (
          <div className="space-y-1">
            <label htmlFor="purchase-tax-paid" className="block text-sm font-medium">Sales tax shown on receipt ($)</label>
            <input id="purchase-tax-paid" type="number" min="0" step="0.01" required
              value={vendorTaxDollars} onChange={(event) => setVendorTaxDollars(event.target.value)}
              className="w-full rounded-md border bg-surface p-2" />
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="purchase-tax-note" className="block text-sm font-medium">Seller or receipt notes</label>
          <textarea id="purchase-tax-note" maxLength={500} rows={2} value={sellerNote}
            onChange={(event) => setSellerNote(event.target.value)}
            className="w-full rounded-md border bg-surface p-2" />
        </div>
        <div className="space-y-1">
          <label htmlFor="purchase-tax-receipt" className="block text-sm font-medium">Receipt photo (optional)</label>
          <select id="purchase-tax-receipt" value={receiptPhotoId}
            onChange={(event) => setReceiptPhotoId(event.target.value)}
            className="w-full rounded-md border bg-surface p-2">
            <option value="">No receipt photo selected</option>
            {appliance.photos.map((photo) => (
              <option key={photo.id} value={photo.id}>{photo.description}</option>
            ))}
          </select>
          <p className="text-xs text-ink-soft">
            Upload a receipt using the appliance photo section first, then select it here.
          </p>
        </div>
        <button type="submit" disabled={isPending}
          className="rounded-md border px-4 py-2 font-medium disabled:opacity-60">
          {isPending ? "Saving…" : "Save purchase-tax evidence"}
        </button>
        {notice && <p role={notice.ok ? "status" : "alert"} className="text-sm">{notice.message}</p>}
      </form>
    </section>
  );
}
