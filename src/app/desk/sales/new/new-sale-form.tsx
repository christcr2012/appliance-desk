"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Select, Textarea } from "@/components/ui";
import { formatMoney, moneyInputValue, parseDollarInput } from "@/lib/money-ui";
import { createShopSaleAction } from "../actions";

type PartOption = { id: string; label: string; onHand: number; retailPriceCents: number | null };
type CustomerOption = { id: string; label: string; addresses: Array<{ id: string; label: string }> };
type Row = { key: number; partId: string; quantity: string; price: string; reason: string };

function priceCents(text: string): number | null {
  try {
    const t = text.replace(/[$,\s]/g, "");
    return t ? parseDollarInput(t, 100_000_00) : null;
  } catch {
    return null;
  }
}

type UsedOption = { id: string; label: string };
type UsedRow = { key: number; applianceId: string; price: string };

export function NewSaleForm({ parts, customers, usedAppliances }: { parts: PartOption[]; customers: CustomerOption[]; usedAppliances: UsedOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // One identity per screen load: a double tap or a lost response replays the same sale instead of making a second one.
  const operationKey = useRef(`sale-${crypto.randomUUID()}`).current;
  const nextKey = useRef(1);
  const [rows, setRows] = useState<Row[]>(parts.length > 0 ? [{ key: 0, partId: "", quantity: "1", price: "", reason: "" }] : []);
  const [usedRows, setUsedRows] = useState<UsedRow[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [walkInName, setWalkInName] = useState("");
  const [location, setLocation] = useState<"PICKUP" | "DELIVERED">("PICKUP");
  const [addressId, setAddressId] = useState("");
  const [delivery, setDelivery] = useState("");
  const [installation, setInstallation] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const partById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const customer = customers.find((c) => c.id === customerId);
  const usedSubtotal = usedRows.reduce((sum, r) => sum + (priceCents(r.price) ?? 0), 0);
  const subtotal = usedSubtotal + rows.reduce((sum, r) => {
    const q = Number(r.quantity);
    const p = priceCents(r.price);
    return sum + (Number.isInteger(q) && p !== null ? q * p : 0);
  }, 0) + (location === "DELIVERED" ? (priceCents(delivery) ?? 0) + (priceCents(installation) ?? 0) : 0);

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function choosePart(key: number, partId: string) {
    const part = partById.get(partId);
    update(key, { partId, price: part?.retailPriceCents != null ? moneyInputValue(part.retailPriceCents) : "" });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setProblems([]);
    start(async () => {
      const result = await createShopSaleAction({
        operationKey,
        customerId: customerId || null,
        walkInName: customerId ? undefined : walkInName,
        location,
        serviceAddressId: location === "DELIVERED" ? addressId || null : null,
        usedAppliances: usedRows.filter((r) => r.applianceId).map((r) => ({ applianceId: r.applianceId, priceDollars: r.price })),
        items: rows.filter((r) => r.partId).map((r) => ({ partRecordId: r.partId, quantity: Number(r.quantity), priceDollars: r.price, priceReason: r.reason })),
        deliveryDollars: location === "DELIVERED" ? delivery : "",
        installationDollars: location === "DELIVERED" ? installation : "",
        note,
      });
      if (result.status === "error") {
        setError(result.message);
        setProblems(result.problems ?? []);
        return;
      }
      if (result.status === "success" && result.id) router.push(`/desk/sales/${result.id}`);
    });
  }

  const chosen = new Set(rows.map((r) => r.partId));
  const chosenUsed = new Set(usedRows.map((r) => r.applianceId));

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card>
        <h2 className="text-lg font-semibold">What is being sold</h2>
        <div className="mt-3 space-y-4">
          {usedRows.map((row, index) => (
            <div key={row.key} className="grid gap-3 rounded-control border border-line p-3 sm:grid-cols-[2fr_1fr]">
              <Select id={`sale-used-${row.key}`} label={`Used appliance ${index + 1}`} value={row.applianceId} onChange={(e) => setUsedRows((c) => c.map((r) => (r.key === row.key ? { ...r, applianceId: e.target.value } : r)))} required>
                <option value="">Choose a used appliance…</option>
                {usedAppliances.map((a) => (
                  <option key={a.id} value={a.id} disabled={chosenUsed.has(a.id) && a.id !== row.applianceId}>{a.label}</option>
                ))}
              </Select>
              <Field id={`sale-used-price-${row.key}`} label="Sale price ($)" inputMode="decimal" value={row.price} onChange={(e) => setUsedRows((c) => c.map((r) => (r.key === row.key ? { ...r, price: e.target.value } : r)))} required help="You set the price. Its remaining book value comes off the books when you save." />
              <div className="sm:col-span-2">
                <Button type="button" variant="quiet" onClick={() => setUsedRows((c) => c.filter((r) => r.key !== row.key))}>Remove this appliance</Button>
              </div>
            </div>
          ))}
          {usedAppliances.length > 0 && usedRows.length < usedAppliances.length && (
            <Button type="button" variant="secondary" onClick={() => setUsedRows((c) => [...c, { key: nextKey.current++, applianceId: "", price: "" }])}>
              Add a used appliance
            </Button>
          )}
          {rows.map((row, index) => {
            const part = partById.get(row.partId);
            const entered = priceCents(row.price);
            const lower = part?.retailPriceCents != null && entered !== null && entered < part.retailPriceCents;
            return (
              <div key={row.key} className="grid gap-3 rounded-control border border-line p-3 sm:grid-cols-[2fr_1fr_1fr]">
                <Select id={`sale-part-${row.key}`} label={`Item ${index + 1}`} value={row.partId} onChange={(e) => choosePart(row.key, e.target.value)} required={usedRows.length === 0}>
                  <option value="">Choose an item…</option>
                  {parts.map((p) => (
                    <option key={p.id} value={p.id} disabled={chosen.has(p.id) && p.id !== row.partId}>{p.label} — {p.onHand} on hand</option>
                  ))}
                </Select>
                <Field id={`sale-qty-${row.key}`} label="How many" type="number" min={1} max={part?.onHand ?? 1000} step={1} value={row.quantity} onChange={(e) => update(row.key, { quantity: e.target.value })} required={usedRows.length === 0 || !!row.partId} />
                <Field id={`sale-price-${row.key}`} label="Price each ($)" inputMode="decimal" value={row.price} onChange={(e) => update(row.key, { price: e.target.value })} required={usedRows.length === 0 || !!row.partId} help={part?.retailPriceCents != null ? `Listed at ${formatMoney(part.retailPriceCents)}` : undefined} />
                {lower && (
                  <div className="sm:col-span-3">
                    <Field id={`sale-reason-${row.key}`} label="Why is it less than the listed price?" value={row.reason} onChange={(e) => update(row.key, { reason: e.target.value })} maxLength={200} required />
                  </div>
                )}
                {rows.length > 1 && (
                  <div className="sm:col-span-3">
                    <Button type="button" variant="quiet" onClick={() => setRows((c) => c.filter((r) => r.key !== row.key))}>Remove this item</Button>
                  </div>
                )}
              </div>
            );
          })}
          {rows.length < 40 && (
            <Button type="button" variant="secondary" onClick={() => setRows((c) => [...c, { key: nextKey.current++, partId: "", quantity: "1", price: "", reason: "" }])}>
              Add another item
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Who and where</h2>
        <div className="mt-3 grid gap-3 sm:max-w-xl">
          <Select id="sale-customer" label="Customer" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setAddressId(""); if (!e.target.value) setLocation("PICKUP"); }} help="Leave as walk-in for someone who just pays and leaves.">
            <option value="">Walk-in (no account)</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
          {!customerId && <Field id="sale-walkin" label="Name (optional)" value={walkInName} onChange={(e) => setWalkInName(e.target.value)} maxLength={80} />}
          <Select id="sale-location" label="Pickup or delivery" value={location} onChange={(e) => setLocation(e.target.value as "PICKUP" | "DELIVERED")}>
            <option value="PICKUP">Picked up at the shop</option>
            <option value="DELIVERED" disabled={!customerId}>Delivered to the customer</option>
          </Select>
          {location === "DELIVERED" && customer && (
            <>
              <Select id="sale-address" label="Deliver to" value={addressId} onChange={(e) => setAddressId(e.target.value)} required help="Sales tax follows where the item is delivered.">
                <option value="">Choose an address…</option>
                {customer.addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </Select>
              <Field id="sale-delivery" label="Delivery charge ($, optional)" inputMode="decimal" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
              <Field id="sale-install" label="Installation charge ($, optional)" inputMode="decimal" value={installation} onChange={(e) => setInstallation(e.target.value)} />
            </>
          )}
          <Textarea id="sale-note" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} />
        </div>
      </Card>

      <Card>
        <p className="text-sm text-ink-soft">Items and charges so far: <span className="font-semibold text-ink">{formatMoney(subtotal)}</span>. Sales tax is added when you save.</p>
        {error && (
          <div role="alert" className="mt-3 space-y-1 text-sm font-semibold text-danger">
            <p>{error}</p>
            {problems.length > 0 && <ul className="list-disc pl-5 font-normal">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          </div>
        )}
        <div className="mt-4"><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save the sale"}</Button></div>
      </Card>
    </form>
  );
}
