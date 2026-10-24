"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Select } from "@/components/ui";
import { formatMoney, moneyInputValue } from "@/lib/money-ui";
import { cancelShopSaleAction, recordSalePaymentAction, startSaleCardPaymentAction } from "../actions";

export function SalePanel({ invoiceId, owedCents, canCancel, today }: { invoiceId: string; owedCents: number; canCancel: boolean; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState(moneyInputValue(owedCents));
  const [method, setMethod] = useState<"cash" | "check" | "bank_transfer" | "other">("cash");
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pay(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const r = await recordSalePaymentAction({ invoiceId, amountDollars: amount, method, receivedOn: date });
      if (r.status === "error") return setError(r.message);
      router.refresh();
    });
  }

  function payByCard() {
    setError(null);
    start(async () => {
      const r = await startSaleCardPaymentAction(invoiceId);
      if (r.status === "error") return setError(r.message);
      window.location.href = r.url;
    });
  }

  function cancel(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const r = await cancelShopSaleAction(invoiceId, reason);
      if (r.status === "error") return setError(r.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {owedCents > 0 && (
        <Card>
          <h2 className="text-lg font-semibold">Pay by card</h2>
          <p className="mt-1 text-sm text-ink-soft">Opens Stripe&apos;s secure card page for {formatMoney(owedCents)}. The customer enters the card on Stripe, never here. The sale shows as paid when Stripe confirms, usually within seconds.</p>
          <div className="mt-3">
            <Button type="button" onClick={payByCard} disabled={pending}>{pending ? "Opening…" : `Pay ${formatMoney(owedCents)} by card`}</Button>
          </div>
        </Card>
      )}
      {owedCents > 0 && (
        <Card>
          <form onSubmit={pay} className="grid gap-3 sm:max-w-md">
            <h2 className="text-lg font-semibold">Record a payment</h2>
            <p className="text-sm text-ink-soft">Use this when the customer pays you cash, a check or a bank transfer. {formatMoney(owedCents)} is still owed.</p>
            <Field id="sale-amount" label="Amount received ($)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            <Select id="sale-method" label="How they paid" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="other">Something else</option>
            </Select>
            <Field id="sale-date" label="Date received" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record payment"}</Button>
          </form>
        </Card>
      )}
      {canCancel && (
        <Card>
          {!confirming ? (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Cancel this sale</h2>
              <p className="text-sm text-ink-soft">Nothing has been paid yet. Cancelling puts every item back on the shelf and removes the sale from your books.</p>
              <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>Cancel this sale…</Button>
            </div>
          ) : (
            <form onSubmit={cancel} className="grid gap-3 sm:max-w-md">
              <Field id="sale-cancel-reason" label="Why is it being cancelled?" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} required />
              <div className="flex gap-2">
                <Button type="submit" disabled={pending}>{pending ? "Cancelling…" : "Yes, cancel the sale"}</Button>
                <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>Keep it</Button>
              </div>
            </form>
          )}
        </Card>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </div>
  );
}
