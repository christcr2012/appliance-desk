"use client";

import { useState, useTransition } from "react";
import {
  updateAppliancePriceAction,
  setApplianceVisibilityAction,
} from "./actions";

type ApplianceTypeRow = {
  id: string;
  name: string;
  monthlyPriceCents: number;
  showOnWebsite: boolean;
};

export function AppliancePricingTable({ rows }: { rows: ApplianceTypeRow[] }) {
  return (
    <table className="w-full max-w-3xl border-collapse text-sm">
      <caption className="mb-2 text-left text-gray-600">
        New appliance categories are added as data (see
        docs/BUSINESS-RULES.md) — ask a developer to add a row here once
        you&apos;re ready to offer another type (refrigerators, ranges,
        etc.).
      </caption>
      <thead>
        <tr className="border-b border-gray-200 text-left">
          <th className="py-2 pr-4 font-medium text-gray-900">Appliance</th>
          <th className="py-2 pr-4 font-medium text-gray-900">
            Monthly price
          </th>
          <th className="py-2 font-medium text-gray-900">Show on website</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <ApplianceRow key={row.id} row={row} />
        ))}
      </tbody>
    </table>
  );
}

function ApplianceRow({ row }: { row: ApplianceTypeRow }) {
  const [price, setPrice] = useState((row.monthlyPriceCents / 100).toFixed(2));
  const [visible, setVisible] = useState(row.showOnWebsite);
  const [isPending, startTransition] = useTransition();
  const [savedPrice, setSavedPrice] = useState(false);

  return (
    <tr className="border-b border-gray-100">
      <td className="py-3 pr-4 text-gray-900">{row.name}</td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`price-${row.id}`}>
            Monthly price for {row.name}
          </label>
          <span aria-hidden="true">$</span>
          <input
            id={`price-${row.id}`}
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              setSavedPrice(false);
            }}
            className="w-24 rounded-lg border border-gray-300 px-2 py-1.5"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                await updateAppliancePriceAction(row.id, parseFloat(price));
                setSavedPrice(true);
              });
            }}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
          {savedPrice && !isPending && (
            <span className="text-xs text-green-700">Saved</span>
          )}
        </div>
      </td>
      <td className="py-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => {
              const next = e.target.checked;
              setVisible(next);
              startTransition(() => {
                setApplianceVisibilityAction(row.id, next);
              });
            }}
            className="h-4 w-4"
          />
          <span className="sr-only">Show {row.name} on website</span>
        </label>
      </td>
    </tr>
  );
}
