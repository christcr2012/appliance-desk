"use client";

import { useActionState } from "react";
import type { MandatoryChargeDecision, MandatorySigningPolicyVersion } from "@/domains/billing/signing-mandatory-policy";
import { saveMandatorySigningPolicyAction } from "./mandatory-signing-policy-action";

const rules = [
  { key: "delivery", label: "Delivery", help: "Does every new rental order require a separate delivery charge?" },
  { key: "installation", label: "Installation", help: "Are installation services required or included for these rentals?" },
  { key: "removal", label: "Removal", help: "Is an appliance removal mandatory for the order?" },
  { key: "damageWaiver", label: "Damage waiver", help: "Is a waiver mandatory, optional, or not applicable?" },
] as const;

export function MandatorySigningPolicyForm({ editable, effectiveDate, current, history }: {
  editable: boolean;
  effectiveDate: string;
  current: { decision: MandatoryChargeDecision; revision: number | null; reason: string | null };
  history: MandatorySigningPolicyVersion[];
}) {
  const [result, save, pending] = useActionState(saveMandatorySigningPolicyAction, { error: "", success: "" });
  return (
    <section className="space-y-3" aria-label="Mandatory quote categories">
      <p className="text-sm text-ink-soft">
        Record which other charges must be considered on every future all-in estimate.
        The original delivery, installation and removal dollar amounts remain in
        Business Settings; this policy decides whether each amount applies.
        Unknown means an estimate cannot be finalized. A dated policy revision
        never changes existing signed contracts or counts as CPA/counsel approval.
      </p>
      <p className="text-sm" role="status">
        {current.revision === null ? "No active owner policy — all categories require review."
          : `Effective revision ${current.revision}: ${current.reason}`}
      </p>
      <form action={save} className="space-y-3 rounded border border-line p-3">
        <label className="block text-sm">
          Effective from (Colorado business day)
          <input name="effectiveFromKey" type="date" defaultValue={effectiveDate} required
            disabled={!editable || pending} className="mt-1 block rounded border border-line bg-surface p-2" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {rules.map(rule => (
            <label key={rule.key} className="block text-sm">
              <span className="font-medium">{rule.label}</span>
              <span className="mt-1 block text-ink-soft">{rule.help}</span>
              <select name={rule.key} defaultValue={current.decision[rule.key]}
                disabled={!editable || pending} className="mt-1 w-full rounded border border-line bg-surface p-2">
                <option value="UNDECIDED">Review required</option>
                <option value="REQUIRED">Required (allocate before binding)</option>
                <option value="NOT_APPLICABLE">Not applicable</option>
              </select>
            </label>
          ))}
          <label className="block text-sm">
            <span className="font-medium">Colorado retail delivery fee</span>
            <span className="mt-1 block text-ink-soft">
              Determine applicability and statutory exemption with evidence, not an assumed rate.
            </span>
            <select name="retailDelivery" defaultValue={current.decision.retailDelivery}
              disabled={!editable || pending} className="mt-1 w-full rounded border border-line bg-surface p-2">
              <option value="UNDECIDED">Review required</option>
              <option value="REQUIRED">Required; rate still needs verification</option>
              <option value="EXEMPT">Documented exemption; verify before customer transaction</option>
            </select>
          </label>
        </div>
        <label className="block text-sm">
          Reason and dated decision evidence
          <textarea name="reason" rows={3} required minLength={10} maxLength={500}
            placeholder="Describe the owner decision and information used."
            disabled={!editable || pending} className="mt-1 w-full rounded border border-line bg-surface p-2" />
        </label>
        {result.error && <p role="alert" className="text-sm text-red-700">{result.error}</p>}
        {result.success && <p role="status" className="text-sm">{result.success}</p>}
        <button type="submit" disabled={!editable || pending}
          className="rounded bg-action px-4 py-2 text-sm text-on-action disabled:opacity-50">
          {pending ? "Saving…" : "Record dated owner policy"}
        </button>
        {!editable && <p className="text-sm text-ink-soft">Only the owner may change this policy.</p>}
      </form>
      {history.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">Prior and upcoming immutable revisions</p>
          <ul className="mt-2 space-y-1">
            {history.slice().reverse().map(version => (
              <li key={version.revision}>
                Revision {version.revision} — effective {version.effectiveFromKey} —
                recorded {version.recordedAt.slice(0, 10)}: {version.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-ink-soft">
        Even a complete owner policy does not remove IN-79, jurisdiction-level tax,
        legal contract review, hidden-public-pricing or Stripe money controls.
      </p>
    </section>
  );
}
