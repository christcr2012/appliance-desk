"use client";

// TFA-1: the Change form for one rule, in a kit Sheet. It opens from the
// ?change=<key> link on the Rules list; closing drops the param. Money
// fields are dollars on screen, cents in storage.
import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Sheet, toast } from "@/components/kit";
import { businessDateKey } from "@/lib/business-date";
import { saveRuleChangeAction } from "./actions";
import type { RuleChangeKind, RuleField } from "@/domains/rules/registry";

function fieldDefault(field: RuleField, current: unknown): string {
  const obj = current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown> : {};
  const raw = field.name === "value" && typeof current === "number" ? current : obj[field.name];
  if (typeof raw !== "number") return typeof raw === "string" ? raw : "";
  if (field.kind === "money") return (raw / 100).toFixed(2);
  return String(raw);
}

export function RuleChangeSheet({
  ruleKey, def, current,
}: {
  ruleKey: string;
  // Only the title, explanation, change kind and fields are read here; the
  // structural type keeps every RuleDef<T> assignable (RuleDef is invariant in T).
  def: { title: string; explain: string; change: RuleChangeKind; fields: RuleField[] };
  current: unknown;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/desk/sales-tax/rules";
  const search = useSearchParams()?.toString() ?? "";
  const [open, setOpen] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const todayKey = businessDateKey(new Date());
  const [effectiveFrom, setEffectiveFrom] = useState(todayKey);
  const late = effectiveFrom < todayKey;

  function close() {
    setOpen(false);
    const params = new URLSearchParams(search);
    params.delete("change");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const hint = def.change === "FIXED_JUL_1"
    ? "Colorado sets this each July 1."
    : def.change === "FIXED_JAN_1"
      ? "This changes each Jan 1."
      : "This can change on any date.";

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) close(); }} title={`Change: ${def.title}`}>
      <form
        ref={formRef}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const data = new FormData(e.currentTarget);
          startTransition(async () => {
            const result = await saveRuleChangeAction(ruleKey, data);
            if (result.status === "error") {
              setError(result.message);
              return;
            }
            toast({ message: "Rule changed", tone: "good" });
            close();
            router.refresh();
          });
        }}
      >
        <p className="text-sm text-ink-soft">{hint} {def.explain}</p>
        {def.fields.map((field) => (
          <label key={field.name} className="grid gap-1 text-sm font-medium">
            {field.label}
            <input
              name={field.name}
              type={field.kind === "text" ? "text" : field.kind === "month-day" ? "text" : "number"}
              inputMode={field.kind === "money" ? "decimal" : "numeric"}
              step={field.kind === "money" ? "0.01" : field.kind === "percent" ? "0.1" : "1"}
              min={field.min}
              max={field.max}
              defaultValue={fieldDefault(field, current)}
              required
              className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm"
            />
          </label>
        ))}
        <label className="grid gap-1 text-sm font-medium">
          Starts on
          <input
            name="effectiveFrom"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            required
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm"
          />
        </label>
        {late && (
          <p role="alert" className="rounded-md border border-warning-ink bg-warning-bg p-3 text-sm">
            This start date has already passed. Bills already sent will not change.
            If the new value costs customers more, the business pays the difference;
            if it saves them money, they get a credit on their next bill.
          </p>
        )}
        <label className="grid gap-1 text-sm font-medium">
          Why is this changing?
          <textarea
            name="reason"
            rows={2}
            maxLength={500}
            required
            placeholder="e.g. Colorado published the July 2026 rate"
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm"
          />
        </label>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save change"}
          </button>
          <button type="button" disabled={isPending} onClick={close} className="min-h-11 text-sm text-ink underline">
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}
