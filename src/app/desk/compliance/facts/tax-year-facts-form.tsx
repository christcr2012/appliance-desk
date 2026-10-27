"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { saveTaxYearFactsAction, type ComplianceActionState } from "../actions";

/**
 * CMP-2: one finished tax year's figures — what last year's return said.
 * The quarterly estimates are worked out from these, and the 1099-K
 * amount is what the packet ties the books against. Blank means "not
 * recorded": the app then shows words, never an invented number.
 */
export function TaxYearFactsForm({
  year,
  years,
  facts,
}: {
  year: number;
  years: number[];
  facts: { federalTax: string; federalAgi: string; coloradoTax: string; form1099KGross: string };
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ComplianceActionState, FormData>(saveTaxYearFactsAction, {});
  const inputCls = "w-full rounded-lg border border-border bg-card px-3 py-2";
  const labelCls = "block text-sm font-medium text-ink";
  const helpCls = "mt-1 text-sm text-ink-soft";
  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <h3 className="text-lg font-semibold text-ink">One year&apos;s tax figures</h3>
      <p className="text-sm text-ink-soft">
        From a finished year&apos;s tax return. Next year&apos;s quarterly estimates are worked out from these
        numbers, and the 1099-K amount is what the accountant packet ties the books against.
      </p>
      {state.error ? (
        <p role="alert" className="rounded-card bg-danger-tint px-4 py-3 text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      {state.ok ? <p className="rounded-card bg-tint px-4 py-3 text-sm font-medium text-ink">Saved.</p> : null}
      <label className={labelCls}>
        Tax year
        <select
          name="taxYear"
          defaultValue={year}
          className={inputCls}
          onChange={(e) => router.push(`/desk/compliance/facts?taxYear=${e.target.value}`)}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className={labelCls}>
        That year&apos;s total federal tax ($)
        <input name="federalTax" defaultValue={facts.federalTax} inputMode="decimal" className={inputCls} />
        <span className={helpCls}>The total tax on that year&apos;s federal return (Form 1040). Used for the federal estimates.</span>
      </label>
      <label className={labelCls}>
        That year&apos;s federal income — AGI ($)
        <input name="federalAgi" defaultValue={facts.federalAgi} inputMode="decimal" className={inputCls} />
        <span className={helpCls}>Adjusted gross income from that return. Over $150,000 makes the safe harbor 110% instead of 100%.</span>
      </label>
      <label className={labelCls}>
        That year&apos;s total Colorado tax ($)
        <input name="coloradoTax" defaultValue={facts.coloradoTax} inputMode="decimal" className={inputCls} />
        <span className={helpCls}>The total tax on that year&apos;s Colorado return (DR 0104). Used for the Colorado estimates.</span>
      </label>
      <label className={labelCls}>
        That year&apos;s 1099-K amount from Stripe ($)
        <input name="form1099KGross" defaultValue={facts.form1099KGross} inputMode="decimal" className={inputCls} />
        <span className={helpCls}>Box 1a of the Form 1099-K Stripe sends for that year. The packet compares it with the books.</span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-action bg-action px-4 py-2 text-sm font-medium text-on-action disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save this year's figures"}
      </button>
    </form>
  );
}
