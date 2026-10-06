"use client";

import { useState } from "react";
import { Button, Field } from "@/components/ui";
import {
  DEFAULT_LEAD_SCORING_POLICY,
  type LeadScoringPolicy,
  type LeadScoringPolicyInput,
} from "@/domains/leads/scoring-policy-config";
import { updateLeadScoringPolicyAction } from "./lead-scoring-actions";

const FIELDS: Array<{
  key: keyof Omit<LeadScoringPolicyInput, "termPoints">;
  label: string;
  help: string;
}> = [
  { key: "additionalUnitPoints", label: "Each additional unit", help: "Points for every unit after the first." },
  { key: "businessAccountPoints", label: "Business account", help: "Points when the lead is a business account." },
  { key: "multiUnitPropertyManagerPoints", label: "Multi-unit property manager", help: "Extra points only when a property manager needs more than one unit." },
  { key: "highValueThreshold", label: "High-value threshold", help: "A score at or above this number is flagged high-value." },
];

export function LeadScoringForm({ policy }: { policy: LeadScoringPolicy }) {
  const [values, setValues] = useState<LeadScoringPolicyInput>({
    termPoints: { ...policy.termPoints },
    additionalUnitPoints: policy.additionalUnitPoints,
    businessAccountPoints: policy.businessAccountPoints,
    multiUnitPropertyManagerPoints: policy.multiUnitPropertyManagerPoints,
    highValueThreshold: policy.highValueThreshold,
  });
  const [version, setVersion] = useState(policy.version);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const result = await updateLeadScoringPolicyAction(values);
      if (result.status === "success") {
        setVersion(result.version);
        setMessage({ kind: "success", text: `Lead scoring policy v${result.version} saved. Existing lead scores were not changed.` });
      } else {
        setMessage({ kind: "error", text: result.message });
      }
    } catch {
      setMessage({ kind: "error", text: "Lead scoring settings could not be saved. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  const setTerm = (term: keyof LeadScoringPolicyInput["termPoints"], value: number) =>
    setValues((current) => ({ ...current, termPoints: { ...current.termPoints, [term]: value } }));

  return (
    <form onSubmit={save} className="mb-6 rounded-card border border-line bg-subtle p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-ink">Lead scoring</h3>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            These explainable weights rank new leads. Saving creates a new policy version; existing leads keep the score and version they already earned.
          </p>
        </div>
        <span className="text-xs text-ink-soft">Current policy: v{version}</span>
      </div>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className="mt-3 text-sm text-ink">
          {message.text}
        </p>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(["month-to-month", "6-month", "12-month"] as const).map((term) => (
          <Field
            key={term}
            label={`${term} term`}
            type="number"
            min={0}
            max={1000}
            value={values.termPoints[term]}
            onChange={(event) => setTerm(term, Number(event.target.value))}
          />
        ))}
        {FIELDS.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            help={field.help}
            type="number"
            min={0}
            max={field.key === "highValueThreshold" ? 10000 : 1000}
            value={values[field.key]}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                [field.key]: Number(event.target.value),
              }))
            }
          />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save lead scoring"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setValues({
              termPoints: { ...DEFAULT_LEAD_SCORING_POLICY.termPoints },
              additionalUnitPoints: DEFAULT_LEAD_SCORING_POLICY.additionalUnitPoints,
              businessAccountPoints: DEFAULT_LEAD_SCORING_POLICY.businessAccountPoints,
              multiUnitPropertyManagerPoints: DEFAULT_LEAD_SCORING_POLICY.multiUnitPropertyManagerPoints,
              highValueThreshold: DEFAULT_LEAD_SCORING_POLICY.highValueThreshold,
            })
          }
        >
          Restore v1 weights
        </Button>
      </div>
    </form>
  );
}
