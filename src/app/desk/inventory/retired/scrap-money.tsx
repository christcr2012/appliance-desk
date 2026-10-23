"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Select } from "@/components/ui";
import { formatMoney } from "@/lib/money-ui";
import { recordScrapPaymentAction, voidScrapPaymentAction } from "../retired-actions";

type Payment = { id: string; date: string; amountCents: number; yardName: string; note: string | null; voided: boolean; voidReason: string | null };

/** Scrap-yard checks, entered in a lump (one entry per check, not split by appliance). */
export function ScrapMoney({ payments, accounts, today }: { payments: Payment[]; accounts: Array<{ id: string; name: string }>; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const operationKey = useRef(`scrap-${crypto.randomUUID()}`);
  const [receivedOn, setReceivedOn] = useState(today);
  const [amount, setAmount] = useState("");
  const [yardName, setYardName] = useState("");
  const [note, setNote] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await recordScrapPaymentAction({ operationKey: operationKey.current, receivedOn, amountDollars: amount, yardName, note: note || undefined, depositAccountId: accountId });
      if (result.status === "error") return setError(result.message);
      operationKey.current = `scrap-${crypto.randomUUID()}`;
      setAmount(""); setNote("");
      router.refresh();
    });
  }

  function voidIt(event: React.FormEvent) {
    event.preventDefault();
    if (!voiding) return;
    setError(null);
    start(async () => {
      const result = await voidScrapPaymentAction(voiding, voidReason);
      if (result.status === "error") return setError(result.message);
      setVoiding(null); setVoidReason("");
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="scrap-heading" className="space-y-4">
      <div>
        <h2 id="scrap-heading" className="text-xl font-semibold">Scrap money received</h2>
        <p className="text-sm text-ink-soft">Enter each scrap-yard check or ticket once, for the whole load. You don&apos;t need to split it by appliance. Dump fees go in as an ordinary expense under “Dump and disposal fees”.</p>
      </div>
      <Card>
        <form onSubmit={save} className="grid gap-3 sm:max-w-md">
          <Field id="scrap-date" label="Date you got the money" type="date" value={receivedOn} max={today} onChange={(e) => setReceivedOn(e.target.value)} required />
          <Field id="scrap-amount" label="Amount ($)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          <Field id="scrap-yard" label="Scrap yard" value={yardName} onChange={(e) => setYardName(e.target.value)} maxLength={120} required />
          <Select id="scrap-account" label="Money went into" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Field id="scrap-note" label="Note, like the ticket number (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          <div><Button type="submit" disabled={pending || accounts.length === 0}>{pending ? "Saving…" : "Save scrap money"}</Button></div>
        </form>
        {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger">{error}</p>}
      </Card>
      {payments.length > 0 && (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {payments.map((p) => (
            <li key={p.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={p.voided ? "text-ink-soft line-through" : "font-semibold"}>{p.date} · {p.yardName}{p.note ? ` · ${p.note}` : ""}</span>
                <span className={p.voided ? "text-ink-soft line-through" : "font-semibold"}>{formatMoney(p.amountCents)}</span>
              </div>
              {p.voided ? (
                <p className="text-sm text-ink-soft">Voided: {p.voidReason}</p>
              ) : voiding === p.id ? (
                <form onSubmit={voidIt} className="grid gap-2 sm:max-w-md">
                  <Field id={`void-${p.id}`} label="Why is it being voided?" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={200} required />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={pending}>Void this entry</Button>
                    <Button type="button" variant="secondary" onClick={() => setVoiding(null)}>Keep it</Button>
                  </div>
                </form>
              ) : (
                <Button type="button" variant="quiet" onClick={() => { setVoiding(p.id); setVoidReason(""); }}>Void…</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
