"use client";

import { useState, useTransition } from "react";
import { prepareEstimateAgreementsAction } from "../actions";

export function PrepareEstimateAgreementsButton({ estimateId, eligible }: {
  estimateId: string;
  eligible: boolean;
}) {
  const [mode, setMode] = useState<"per-property" | "single">("per-property");
  const [address, setAddress] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  return (
    <section aria-label="Prepare estimate agreements" className="mt-4 space-y-3 rounded-lg border border-line bg-surface p-4 text-sm">
      <h2 className="font-medium">Prepare agreements before customer approval</h2>
      <p className="text-ink-soft">
        This creates draft shells at the chosen service addresses. Add the exact
        rental lines to each agreement and complete the existing signing-charge,
        jurisdiction tax and frozen-order review before sending a binding offer.
        No customer approval, payment, signature, notification or confirmed booking is created.
      </p>
      <label className="block">
        Preparation mode
        <select value={mode} onChange={event => setMode(event.target.value as typeof mode)}
          disabled={pending || !eligible} className="mt-1 block rounded border border-line bg-surface p-2">
          <option value="per-property">One agreement per quoted property</option>
          <option value="single">One agreement for a single property</option>
        </select>
      </label>
      {mode === "single" && (
        <label className="block">
          Existing owned service-address ID
          <input value={address} onChange={event => setAddress(event.target.value)}
            disabled={pending || !eligible} className="mt-1 block w-full rounded border border-line bg-surface p-2" />
        </label>
      )}
      <button type="button" disabled={pending || !eligible}
        className="rounded bg-action px-3 py-2 font-medium text-on-action disabled:opacity-50"
        onClick={() => start(async () => {
          setError(null);
          const result = await prepareEstimateAgreementsAction(estimateId,
            mode === "per-property" ? { mode } : { mode, serviceAddressId: address.trim() });
          if (result.status === "error") setError(result.message);
          else setIds(result.agreementIds);
        })}>
        {pending ? "Preparing…" : "Prepare owned draft agreements"}
      </button>
      {!eligible && <p>Only an editable estimate for an existing customer is eligible.</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {ids.length > 0 && <div role="status">
        <p>Prepared {ids.length} draft agreement(s). Review exact costs and freeze each before customer approval.</p>
        <ul className="mt-2 list-inside list-disc">
          {ids.map(id => <li key={id}><a href={`/desk/agreements/${id}`} className="underline">Review agreement {id.slice(0,8)}</a></li>)}
        </ul>
      </div>}
    </section>
  );
}
