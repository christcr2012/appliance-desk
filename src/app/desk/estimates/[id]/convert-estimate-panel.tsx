"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { convertEstimateAction } from "../actions";

/** Converting an approved estimate into DRAFT rental agreement(s) — see
 * docs/DECISIONS.md's "Estimates for property managers / bulk &
 * multi-unit deals" entry. Chris picks how, per deal, right here: one
 * combined agreement on a single property, or one agreement per
 * distinct property the line items reference. */
export function ConvertEstimatePanel({
  estimateId,
  customerId,
  serviceAddresses,
  hasUnassignedLines,
  distinctPropertyCount,
  depositAlreadyCollectedCents,
}: {
  estimateId: string;
  customerId: string | null;
  serviceAddresses: { id: string; label: string }[];
  hasUnassignedLines: boolean;
  distinctPropertyCount: number;
  /** Set when this estimate's deposit was already paid at approval
   * (Estimate.depositPaidAt) — used only to warn Chris here that
   * choosing "per property" won't automatically apply it to any one of
   * the resulting agreements (see convertEstimateToAgreements's own
   * comment for why), not to change what conversion actually does. */
  depositAlreadyCollectedCents: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"single" | "per-property">(
    distinctPropertyCount > 1 ? "per-property" : "single",
  );
  const [serviceAddressId, setServiceAddressId] = useState(serviceAddresses[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  const perPropertyDisabled = hasUnassignedLines;

  function handleConvert() {
    setError(null);
    startTransition(async () => {
      const raw =
        mode === "single" ? { mode: "single" as const, serviceAddressId } : { mode: "per-property" as const };
      const result = await convertEstimateAction(estimateId, raw);
      if (result.status === "error") {
        setError(result.message);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-lg border border-line bg-white p-5">
      <h2 className="text-sm font-medium text-ink">Convert to a draft agreement</h2>
      <p className="mt-1 text-sm text-ink-soft">
        This sets up the paperwork with the agreed terms — you&apos;ll still
        add the real appliances yourself, same as any other agreement.
      </p>

      <div className="mt-4 space-y-2">
        <label className="flex items-start gap-2 text-sm text-ink-soft">
          <input
            type="radio"
            name="convert-mode"
            checked={mode === "single"}
            onChange={() => setMode("single")}
            className="mt-1"
          />
          <span>
            One combined agreement, on a single property
            {serviceAddresses.length > 0 && (
              <select
                value={serviceAddressId}
                onChange={(e) => setServiceAddressId(e.target.value)}
                disabled={mode !== "single"}
                className="mt-1 block w-full rounded-md border border-line-strong px-3 py-2 text-sm disabled:opacity-50"
              >
                {serviceAddresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            )}
          </span>
        </label>

        <label
          className={`flex items-start gap-2 text-sm ${
            perPropertyDisabled ? "text-ink-faint" : "text-ink-soft"
          }`}
        >
          <input
            type="radio"
            name="convert-mode"
            checked={mode === "per-property"}
            disabled={perPropertyDisabled}
            onChange={() => setMode("per-property")}
            className="mt-1"
          />
          <span>
            A separate agreement per property ({distinctPropertyCount || 0} distinct{" "}
            {distinctPropertyCount === 1 ? "property" : "properties"} on this estimate)
            {perPropertyDisabled && (
              <span className="block text-xs text-ink-faint">
                Some line items aren&apos;t tied to a property yet — assign one to each, or use the
                combined option above.
              </span>
            )}
            {!perPropertyDisabled && depositAlreadyCollectedCents && mode === "per-property" && (
              <span className="block text-xs text-amber-700">
                Heads up: the deposit already collected on this estimate won&apos;t automatically
                apply to any of the separate agreements this creates — you&apos;ll need to record it
                on the right one yourself.
              </span>
            )}
          </span>
        </label>
      </div>

      {serviceAddresses.length === 0 && mode === "single" && (
        <p className="mt-2 text-xs text-amber-700">
          This customer has no property on file yet — add one from{" "}
          {customerId ? (
            <Link href={`/desk/customers/${customerId}`} className="underline">
              their customer page
            </Link>
          ) : (
            "their customer page"
          )}{" "}
          first.
        </p>
      )}

      <button
        type="button"
        disabled={isPending || (mode === "single" && !serviceAddressId)}
        onClick={handleConvert}
        className="mt-4 rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
      >
        {isPending ? "Converting…" : "Convert"}
      </button>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
