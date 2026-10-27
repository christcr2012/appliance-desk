"use client";

import { useState, useTransition } from "react";
import { classifyCategoryAction } from "../actions";
import { formatMoney } from "@/lib/money-ui";

/**
 * CMP-3: classify an expense category for 1099 reporting, from the
 * filing page. Amounts are never guessed into a box — the owner says
 * which box (or "not a 1099 payment") each category belongs to.
 */
export function ClassifyControls({
  filingId,
  categories,
}: {
  filingId: string;
  categories: { categoryId: string; name: string; cents: number }[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});

  if (categories.length === 0) return null;
  return (
    <section className="max-w-3xl space-y-2">
      <h3 className="font-semibold text-ink">Categories that still need a 1099 box</h3>
      <p className="text-sm text-ink-soft">
        These payments can&apos;t go on a 1099 until you say which box they belong in. The app never guesses.
        Saving a choice updates the filing&apos;s numbers right away, so what you approve always includes it.
      </p>
      {categories.map((c) => (
        <div key={c.categoryId} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-48 font-medium text-ink">{c.name}</span>
          <span>{formatMoney(c.cents)} this year</span>
          <select
            className="rounded border border-border px-2 py-1"
            value={choices[c.categoryId] ?? ""}
            onChange={(e) => setChoices((prev) => ({ ...prev, [c.categoryId]: e.target.value }))}
          >
            <option value="">Choose…</option>
            <option value="NEC_1">1099-NEC box 1 — services</option>
            <option value="MISC_1">1099-MISC box 1 — rent</option>
            <option value="MISC_3">1099-MISC box 3 — other income</option>
          </select>
          <button
            type="button"
            className="rounded bg-ink px-3 py-1 text-white disabled:opacity-50"
            disabled={pending || !choices[c.categoryId]}
            onClick={() =>
              start(async () => {
                const result = await classifyCategoryAction(filingId, c.categoryId, choices[c.categoryId] ?? "");
                if (result.error) setError(result.error);
              })
            }
          >
            Save
          </button>
        </div>
      ))}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </section>
  );
}
