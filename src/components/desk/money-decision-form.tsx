"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { centsInWords } from "@/lib/money-words";
import type { MoneyActionState } from "@/app/desk/billing/money-actions";

type Option = { value: string; label: string };

/**
 * One owner decision about money: an amount, an optional choice and a written note, then a confirmation that repeats
 * the amount in dollars AND words. The server re-checks everything; this only gathers and shows what will happen.
 */
export function MoneyDecisionForm({
  title,
  help,
  verb,
  maxCents,
  defaultCents,
  selectLabel,
  options,
  reasonLabel,
  reasonRequired,
  submitLabel,
  submit,
}: {
  title: string;
  help: string;
  verb: string;
  maxCents: number;
  defaultCents?: number;
  selectLabel?: string;
  options?: Option[];
  reasonLabel?: string;
  reasonRequired?: boolean;
  submitLabel: string;
  submit: (input: { amountCents: number; reason: string; select: string; confirmed: boolean }) => Promise<MoneyActionState>;
}) {
  const id = useId();
  const router = useRouter();
  const [dollars, setDollars] = useState(defaultCents ? (defaultCents / 100).toFixed(2) : "");
  const [select, setSelect] = useState(options?.[0]?.value ?? "");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MoneyActionState | null>(null);

  const typed = Math.round(Number(dollars) * 100);
  const validAmount = Number.isFinite(typed) && typed > 0 && typed <= maxCents && /^\d+(\.\d{1,2})?$/.test(dollars.trim());
  const dollarText = validAmount ? `$${(typed / 100).toFixed(2)}` : null;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setResult(null);
    if (!validAmount) {
      setResult({ status: "error", message: `Enter an amount between $0.01 and $${(maxCents / 100).toFixed(2)}.` });
      return;
    }
    setBusy(true);
    try {
      const outcome = await submit({ amountCents: typed, reason, select, confirmed });
      setResult(outcome);
      if (outcome.status === "success") {
        setConfirmed(false);
        router.refresh();
      }
    } catch {
      setResult({ status: "error", message: "That could not be done. Nothing was changed. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-gray-300 p-4" aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`} className="text-base font-semibold text-gray-900">
        {title}
      </h3>
      <p className="text-sm text-gray-600">{help}</p>
      {result && (
        <p
          role={result.status === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2 text-sm ${result.status === "success" ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}
        >
          {result.message}
        </p>
      )}
      <div>
        <label htmlFor={`${id}-amt`} className="block text-sm font-medium text-gray-900">
          Amount (most you can enter: ${(maxCents / 100).toFixed(2)})
        </label>
        <div className="mt-1 flex items-center gap-2">
          <span aria-hidden="true">$</span>
          <input
            id={`${id}-amt`}
            inputMode="decimal"
            value={dollars}
            onChange={(e) => {
              setDollars(e.target.value);
              setConfirmed(false);
            }}
            className="min-h-11 w-40 rounded-lg border border-gray-400 px-3 text-sm"
          />
        </div>
      </div>
      {options && options.length > 0 && (
        <div>
          <label htmlFor={`${id}-sel`} className="block text-sm font-medium text-gray-900">
            {selectLabel}
          </label>
          <select
            id={`${id}-sel`}
            value={select}
            onChange={(e) => setSelect(e.target.value)}
            className="mt-1 min-h-11 max-w-full rounded-lg border border-gray-400 px-2 text-sm"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {reasonLabel && (
        <div>
          <label htmlFor={`${id}-why`} className="block text-sm font-medium text-gray-900">
            {reasonLabel}
            {reasonRequired ? " (required)" : " (optional)"}
          </label>
          <textarea
            id={`${id}-why`}
            value={reason}
            maxLength={500}
            rows={2}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-400 px-3 py-2 text-sm"
          />
        </div>
      )}
      <label className="flex items-start gap-3 text-sm text-gray-900">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={confirmed}
          disabled={!validAmount}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>
          {validAmount
            ? `Yes, ${verb} ${dollarText} (${centsInWords(typed)}).`
            : "Enter a valid amount first, then confirm it here."}
        </span>
      </label>
      <button
        type="submit"
        disabled={busy || !confirmed}
        className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </form>
  );
}
