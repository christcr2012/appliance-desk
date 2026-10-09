"use client";

import { formatCents, formatCentsAsPlainDecimal } from "@/domains/pricing/money";

export type PackageLineOption = { id: string; name: string; monthlyPriceCents: number; contents: string };

/**
 * "Rent as": single machines, or one of the owner's sets (W-16B). Choosing a set fills in its name and set price (still
 * editable for a special deal) and tells the user which machines to tick — the server checks one machine per part.
 */
export function PackageLineChooser({
  id,
  packages,
  value,
  disabled,
  forQuote = false,
  onChoose,
}: {
  id: string;
  /** On a quote no machines are picked yet; the help text says so. */
  forQuote?: boolean;
  packages: PackageLineOption[];
  value: string;
  disabled?: boolean;
  onChoose: (choice: { packageId: string; label: string; priceDollars: string } | null) => void;
}) {
  if (packages.length === 0) return null;
  const chosen = packages.find((p) => p.id === value);
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink-soft">
        Rent as
      </label>
      <select
        id={id}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          const pkg = packages.find((p) => p.id === e.target.value);
          onChoose(pkg ? { packageId: pkg.id, label: pkg.name, priceDollars: formatCentsAsPlainDecimal(pkg.monthlyPriceCents) } : null);
        }}
        className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
        aria-describedby={`${id}-help`}
      >
        <option value="">{forQuote ? "Something else — describe it yourself" : "Single machine(s) — type the price"}</option>
        {packages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {formatCents(p.monthlyPriceCents)} a month ({p.contents})
          </option>
        ))}
      </select>
      <p id={`${id}-help`} className="mt-1 text-xs text-ink-faint">
        {chosen && forQuote
          ? `Quotes ${chosen.contents} at the set price. Change the price here for a special deal.`
          : chosen
            ? `Tick exactly one machine for each part: ${chosen.contents}. Any machines of those types can be used.`
            : "Choose a set to fill in its name and set price."}
      </p>
    </div>
  );
}
