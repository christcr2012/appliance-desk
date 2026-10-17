"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, Field, Select, Textarea } from "@/components/ui";
import { PhotoUploadField } from "@/components/photo-upload-field";
import { formatMoney, parseDollarInput } from "@/lib/money-ui";
import { reconcilePurchase } from "@/domains/purchasing/purchase-math";
import { recordPurchaseAction, type SerializedRecorded } from "../actions";

type Option = { id: string; name: string };
type Row = {
  key: number; applianceTypeId: string; manufacturer: string; model: string;
  serialNumber: string; price: string; condition: string; color: string;
};

const money = (value: string): number | null => {
  if (!value.trim()) return null;
  try { return parseDollarInput(value.replace(/^\$/, "").replace(/,/g, ""), 2_147_483_647); }
  catch { return null; }
};

export function RecordPurchaseForm({
  operationKey, suppliers, applianceTypes, isOwner, todayKey,
}: {
  operationKey: string; suppliers: Option[]; applianceTypes: Option[]; isOwner: boolean; todayKey: string;
}) {
  const [pending, startTransition] = useTransition();
  const [sellerKind, setSellerKind] = useState<"supplier" | "private">(suppliers.length ? "supplier" : "private");
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [sellerName, setSellerName] = useState("");
  const [purchasedOn, setPurchasedOn] = useState(todayKey);
  const [reference, setReference] = useState("");
  const [taxAnswer, setTaxAnswer] = useState<string>(isOwner ? "" : "LATER");
  const [sellerTax, setSellerTax] = useState("");
  const [otherState, setOtherState] = useState("");
  const [otherCharges, setOtherCharges] = useState("");
  const [receiptSubtotal, setReceiptSubtotal] = useState("");
  const [receiptTotal, setReceiptTotal] = useState("");
  const [notes, setNotes] = useState("");
  const [documents, setDocuments] = useState<{ url: string; name: string }[]>([]);
  const [nextKey, setNextKey] = useState(2);
  const [rows, setRows] = useState<Row[]>([
    { key: 1, applianceTypeId: applianceTypes[0]?.id ?? "", manufacturer: "", model: "", serialNumber: "", price: "", condition: "", color: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SerializedRecorded | null>(null);

  const taxed = taxAnswer === "YES_COLORADO" || taxAnswer === "YES_OTHER_STATE";
  const taxCents = taxed ? money(sellerTax) : 0;
  const prices = rows.map((row) => money(row.price));
  let preview: ReturnType<typeof reconcilePurchase> | null = null;
  if (!prices.some((p) => p === null) && taxCents !== null) {
    try {
      preview = reconcilePurchase({
        pricesCents: prices as number[], sellerTaxCents: taxCents,
        otherChargesCents: money(otherCharges) ?? 0,
        receiptSubtotalCents: money(receiptSubtotal), receiptTotalCents: money(receiptTotal),
      });
    } catch { preview = null; }
  }

  if (applianceTypes.length === 0) {
    return <p className="text-sm text-ink-soft">Add an appliance <em>type</em> (like Washer) in Settings first, then come back to record a purchase.</p>;
  }

  function setRow(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await recordPurchaseAction({
        operationKey,
        supplierId: sellerKind === "supplier" ? supplierId : "",
        sellerName: sellerKind === "private" ? sellerName : "",
        purchasedOn, reference, taxAnswer, sellerTax: taxed ? sellerTax : "",
        otherState: taxAnswer === "YES_OTHER_STATE" ? otherState : "",
        otherCharges, receiptSubtotal, receiptTotal, notes,
        documents: documents.map((doc) => ({ url: doc.url, altText: doc.name })),
        appliances: rows.map((row) => ({ ...row })),
      });
      if (result.status === "error") setError(result.message);
      else if (result.recorded) setDone(result.recorded);
    });
  }

  if (done) {
    return (
      <div role="status" className="space-y-4">
        <h2 className="text-lg font-semibold">Purchase recorded</h2>
        <p className="text-sm">
          {done.appliances.length} {done.appliances.length === 1 ? "appliance" : "appliances"} from {done.sellerLabel},
          receipt total {formatMoney(done.receiptTotalCents)}.
        </p>
        <ul className="space-y-3">
          {done.appliances.map((a) => (
            <li key={a.id} className="rounded-lg border border-border p-3 text-sm">
              <Link href={`/desk/inventory/${a.id}`} className="font-semibold underline">{a.typeName} {a.assetNumber}</Link>
              {" "}— {formatMoney(a.priceCents)}, tax share {formatMoney(a.taxShareCents)}
              <p className={`mt-1 ${a.step.urgent ? "font-semibold text-danger" : ""}`}>{a.step.headline}</p>
              <p className="text-ink-soft">{a.step.detail}</p>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          <Link href={`/desk/purchases/${done.purchaseId}`} className="underline">Open this purchase</Link>
          <Link href="/desk/purchases/new" className="underline">Record another purchase</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Who did you buy from?</legend>
        <div className="flex gap-4 text-sm">
          {suppliers.length > 0 && (
            <label className="flex items-center gap-2"><input type="radio" name="sellerKind" checked={sellerKind === "supplier"} onChange={() => setSellerKind("supplier")} /> A supplier I use</label>
          )}
          <label className="flex items-center gap-2"><input type="radio" name="sellerKind" checked={sellerKind === "private"} onChange={() => setSellerKind("private")} /> A private seller or store</label>
        </div>
        {sellerKind === "supplier" ? (
          <Select id="supplierId" label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        ) : (
          <Field id="sellerName" label="Seller name" value={sellerName} onChange={(e) => setSellerName(e.target.value)} required />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="purchasedOn" label="Purchase date" type="date" value={purchasedOn} onChange={(e) => setPurchasedOn(e.target.value)} required />
          <Field id="reference" label="Receipt number (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Receipt photos or PDFs</legend>
        <p className="text-xs text-ink-soft">Kept private; only the owner and admins can see them. Add every page.</p>
        <PhotoUploadField
          pathPrefix={`purchases/${operationKey}`} accept="image/*,application/pdf"
          label={documents.length ? "Add another page" : "Add receipt page"}
          disabled={documents.length >= 12}
          onError={setError}
          onUploaded={(url) => setDocuments((current) => [...current, { url, name: `Receipt page ${current.length + 1}` }])}
        />
        {documents.length > 0 && (
          <ul className="text-sm">
            {documents.map((doc, i) => (
              <li key={doc.url} className="flex items-center gap-3">
                {doc.name}
                <button type="button" className="underline" onClick={() => setDocuments((c) => c.filter((_, j) => j !== i))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Appliances on this receipt</legend>
        {rows.map((row, index) => (
          <div key={row.key} className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">Appliance {index + 1}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select id={`type-${row.key}`} label="Type" value={row.applianceTypeId} onChange={(e) => setRow(row.key, { applianceTypeId: e.target.value })}>
                {applianceTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
              <Field id={`mfr-${row.key}`} label="Manufacturer" value={row.manufacturer} onChange={(e) => setRow(row.key, { manufacturer: e.target.value })} />
              <Field id={`model-${row.key}`} label="Model" value={row.model} onChange={(e) => setRow(row.key, { model: e.target.value })} />
              <Field id={`serial-${row.key}`} label="Serial number" value={row.serialNumber} onChange={(e) => setRow(row.key, { serialNumber: e.target.value })} />
              <Field id={`price-${row.key}`} label="Price ($)" inputMode="decimal" value={row.price} onChange={(e) => setRow(row.key, { price: e.target.value })} required />
              <Field id={`cond-${row.key}`} label="Condition" value={row.condition} onChange={(e) => setRow(row.key, { condition: e.target.value })} />
              <Field id={`color-${row.key}`} label="Color" value={row.color} onChange={(e) => setRow(row.key, { color: e.target.value })} />
            </div>
            {rows.length > 1 && (
              <button type="button" className="text-sm underline" onClick={() => setRows((c) => c.filter((r) => r.key !== row.key))}>Remove this appliance</button>
            )}
          </div>
        ))}
        {rows.length < 50 && (
          <Button type="button" variant="secondary" onClick={() => {
            setRows((c) => [...c, { key: nextKey, applianceTypeId: c.at(-1)?.applianceTypeId ?? applianceTypes[0]!.id, manufacturer: "", model: "", serialNumber: "", price: "", condition: "", color: "" }]);
            setNextKey((k) => k + 1);
          }}>Add another appliance</Button>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Did the seller charge sales tax?</legend>
        {isOwner ? (
          <Select id="taxAnswer" label="Sales tax on this receipt" value={taxAnswer} onChange={(e) => setTaxAnswer(e.target.value)} required>
            <option value="" disabled>Choose one…</option>
            <option value="YES_COLORADO">Yes — Colorado sales tax</option>
            <option value="YES_OTHER_STATE">Yes — another state&apos;s tax</option>
            <option value="NO">No tax was charged</option>
            <option value="LATER">I&apos;ll check the receipt later</option>
          </Select>
        ) : (
          <>
            <p className="text-sm">Only the owner can answer the tax question. This purchase will be saved as “check the receipt later” and the owner will see it on their To do list.</p>
          </>
        )}
        {taxed && (
          <Field id="sellerTax" label="Tax printed on the receipt ($)" inputMode="decimal" value={sellerTax} onChange={(e) => setSellerTax(e.target.value)} required />
        )}
        {taxAnswer === "YES_OTHER_STATE" && (
          <Field id="otherState" label="Which state?" value={otherState} onChange={(e) => setOtherState(e.target.value)} required
            help="Your CPA decides whether that tax counts toward Colorado use tax. A To do is created for them." />
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="otherCharges" label="Delivery or other charges ($, optional)" inputMode="decimal" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} />
          <Field id="receiptSubtotal" label="Receipt subtotal ($, to double-check)" inputMode="decimal" value={receiptSubtotal} onChange={(e) => setReceiptSubtotal(e.target.value)} />
          <Field id="receiptTotal" label="Receipt total ($, to double-check)" inputMode="decimal" value={receiptTotal} onChange={(e) => setReceiptTotal(e.target.value)} />
        </div>
      </fieldset>

      <Textarea id="notes" label="Notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

      {preview && (
        <section aria-label="Receipt check" className="space-y-1 rounded-lg border border-border p-3 text-sm">
          <p className="font-semibold">Before you save</p>
          <p>Prices {formatMoney(preview.subtotalCents)} + tax {formatMoney(preview.sellerTaxCents)} + other {formatMoney(preview.otherChargesCents)} = <strong>{formatMoney(preview.receiptTotalCents)}</strong></p>
          {preview.sellerTaxCents > 0 && (
            <ul>
              {preview.taxShares.map((share, i) => (
                <li key={rows[i]!.key}>Appliance {i + 1} gets {formatMoney(share)} of the tax{preview.basis === "EQUAL" ? " (split equally, all prices are $0)" : " (split by price)"}</li>
              ))}
            </ul>
          )}
          {preview.problems.map((problem) => <p key={problem} role="alert" className="font-semibold text-danger">{problem}</p>)}
        </section>
      )}

      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      <Button type="submit" disabled={pending || (preview?.problems.length ?? 0) > 0}>
        {pending ? "Saving…" : "Record purchase"}
      </Button>
    </form>
  );
}
