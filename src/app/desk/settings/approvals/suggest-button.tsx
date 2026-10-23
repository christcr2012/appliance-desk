"use client";

import { moneyInputValue } from "@/lib/money-ui";

/** Fills the box with the suggested number. It does not save anything. */
export function SuggestButton({ targetId, cents, label }: { targetId: string; cents: number; label: string }) {
  return (
    <button
      type="button"
      className="min-h-11 rounded-md border px-3 py-2 text-sm"
      onClick={() => {
        const el = document.getElementById(targetId) as HTMLInputElement | null;
        if (el) el.value = moneyInputValue(cents);
      }}
    >
      {label}
    </button>
  );
}
