"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Field } from "@/components/ui";
import { completeRetiredPlansAction } from "../retired-actions";
import { ConfirmDialog } from "@/components/kit";

type Row = { id: string; title: string; detail: string; status: string; chip?: string; bulkEligible: boolean };

export function RetiredList({ rows, today }: { rows: Row[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [doneOn, setDoneOn] = useState(today);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligible = rows.filter((r) => r.bulkEligible);

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // AR-6 section 8: marking a truckload done is confirmed first, with
  // the date it went.
  function markDone() {
    setError(null);
    start(async () => {
      const result = await completeRetiredPlansAction([...picked], doneOn);
      if (result.status === "error") return setError(result.message);
      setConfirming(false);
      setPicked(new Set());
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 p-4">
            {row.bulkEligible ? (
              <Checkbox id={`pick-${row.id}`} label="" aria-label={`Select ${row.title}`} checked={picked.has(row.id)} onChange={() => toggle(row.id)} />
            ) : (
              <span className="w-6" aria-hidden="true" />
            )}
            <Link href={`/desk/inventory/${row.id}`} className="min-w-0 flex-1">
              <span className="block font-semibold text-ink">{row.title}</span>
              <span className="block truncate text-sm text-ink-soft">{row.detail}</span>
            </Link>
            <span className="flex items-center gap-2 text-sm text-ink-soft">
              {row.chip && (
                <span className="rounded-full bg-attention/15 px-2 py-0.5 text-xs font-semibold text-ink">
                  {row.chip}
                </span>
              )}
              {row.status}
            </span>
          </li>
        ))}
      </ul>
      {eligible.length > 0 && (
        <>
        <form onSubmit={(e) => { e.preventDefault(); setError(null); setConfirming(true); }} className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:max-w-md">
          <h2 className="text-lg font-semibold">Mark a truckload done</h2>
          <p className="text-sm text-ink-soft">Tick the scrap, throw-away and other appliances that are gone, then pick the date. Parts appliances are finished one at a time from their own page.</p>
          <Field id="bulk-done-on" label="Date they went" type="date" value={doneOn} max={today} onChange={(e) => setDoneOn(e.target.value)} required />
          <div><Button type="submit" disabled={pending || picked.size === 0}>{`Mark ${picked.size} done`}</Button></div>
          {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
        </form>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          spec={{
            title: `Mark ${picked.size} done?`,
            summary: `These appliances will be recorded as gone on ${doneOn}. This closes their retired plans.`,
            confirmLabel: pending ? "Saving…" : "Mark done",
          }}
          onConfirm={markDone}
        />
        </>
      )}
    </div>
  );
}
