"use client";
import { useState, useTransition } from "react";
import { REASON_LABEL, PAYMENT_LINK_REASONS, type PaymentLinkReason } from "@/domains/billing/payment-link-message";
import { PHONE_CARD_SCRIPT } from "@/domains/billing/payment-link-script";
import {
  copyPaymentLinkAction, previewPaymentLinkAction, sendPaymentLinkAction, takePaymentByPhoneAction,
} from "@/app/desk/billing/payment-link-actions";

export function PaymentLinkPanel({ invoiceId, suggestedReason }: { invoiceId: string; suggestedReason: PaymentLinkReason }) {
  const [reason, setReason] = useState<PaymentLinkReason>(suggestedReason);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<{ subject: string; text: string; to: string; emailEnabled: boolean } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [savePermission, setSavePermission] = useState(false);
  const [operationKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)));
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<void>) => start(async () => { setMessage(null); await fn(); });

  return (
    <section aria-labelledby="payment-link-heading" className="space-y-4 rounded-md border p-4">
      <h2 id="payment-link-heading" className="text-lg font-semibold">Ask for payment</h2>
      <p className="text-sm text-ink-soft">
        Sends the customer this bill&apos;s secure Stripe payment page. Card and bank details are typed only into Stripe, never into this app.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium" htmlFor="pl-reason">Why are you sending it?
          <select id="pl-reason" className="mt-1 w-full rounded-md border bg-surface p-2" value={reason}
            onChange={(e) => { setReason(e.target.value as PaymentLinkReason); setPreview(null); }}>
            {PAYMENT_LINK_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium" htmlFor="pl-note">Short note (optional)
          <input id="pl-note" maxLength={500} className="mt-1 w-full rounded-md border bg-surface p-2" value={note}
            onChange={(e) => { setNote(e.target.value); setPreview(null); }} />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={pending} className="rounded-md border px-4 py-2 font-medium"
          onClick={() => run(async () => {
            const r = await previewPaymentLinkAction(invoiceId, reason, note);
            if (r.ok) setPreview(r); else setMessage({ kind: "error", text: r.message });
          })}>Preview message</button>
        <button type="button" disabled={pending} className="rounded-md border px-4 py-2"
          onClick={() => run(async () => {
            const r = await copyPaymentLinkAction(invoiceId);
            if (!r.ok) return setMessage({ kind: "error", text: r.message });
            try { await navigator.clipboard.writeText(r.link); setMessage({ kind: "ok", text: "Link copied. You can paste it into a text message." }); }
            catch { setMessage({ kind: "ok", text: "Copy this link: " + r.link }); }
          })}>Copy link</button>
      </div>
      {preview && (
        <div className="space-y-3 rounded-md bg-subtle p-3">
          <p className="text-sm font-medium">This is exactly what {preview.to} will receive:</p>
          <pre className="whitespace-pre-wrap text-sm" aria-label="Message preview">{preview.text}</pre>
          {!preview.emailEnabled && (
            <p className="text-sm" role="note">Customer email is turned off in Settings, so it can&apos;t be sent from here. Use Copy link instead.</p>
          )}
          <button type="button" disabled={pending || !preview.emailEnabled} className="rounded-md border px-4 py-2 font-medium"
            onClick={() => run(async () => {
              const r = await sendPaymentLinkAction(invoiceId, reason, note, operationKey);
              setMessage(r.ok ? { kind: "ok", text: "Sent (status: " + r.state.toLowerCase() + "). It is saved in the customer's history." } : { kind: "error", text: r.message });
            })}>Send to {preview.to}</button>
        </div>
      )}
      <div className="space-y-2 border-t pt-4">
        <h3 className="font-medium">Take payment by phone</h3>
        <p className="text-sm text-ink-soft">Opens Stripe&apos;s own secure page in a new tab. Type the card the customer reads out directly into it. The bill is marked paid only when Stripe confirms the payment.</p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={savePermission} onChange={(e) => setSavePermission(e.target.checked)} />
          <span>The customer gave permission to save this card for monthly rent. Read them: &ldquo;{PHONE_CARD_SCRIPT}&rdquo;</span>
        </label>
        <button type="button" disabled={pending} className="rounded-md border px-4 py-2 font-medium"
          onClick={() => run(async () => {
            const r = await takePaymentByPhoneAction(invoiceId, savePermission);
            if (!r.ok) return setMessage({ kind: "error", text: r.message });
            window.open(r.link, "_blank", "noopener,noreferrer");
            setMessage({ kind: "ok", text: "Stripe's payment page opened in a new tab. If the card is declined, use Send payment link instead." });
          })}>Take payment by phone</button>
      </div>
      {message && <p role={message.kind === "error" ? "alert" : "status"} className="text-sm font-medium">{message.text}</p>}
    </section>
  );
}
