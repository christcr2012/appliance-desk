"use client";
// AR-7 (BOOKS-TAXES 1.4): each asset's "Change how long this one lasts…" sheet, which posts
// the same bookAssetPolicyAction the old page used (future months only). The header's
// owner-only "Record missing months now" rides ScreenHeader's overflow prop instead.
import { useState } from "react";
import { Sheet } from "@/components/kit";
import { bookAssetPolicyAction } from "./actions";

export function AssetPolicySheet({ applianceId, version, lifeMonths, salvagePercent }: {
  applianceId: string; version: number; lifeMonths: number; salvagePercent: number;
}) {
  const [open, setOpen] = useState(false);
  const field = "mt-1 w-full rounded-field border border-line bg-surface px-3 py-2";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-field border border-line px-3 py-2 text-sm font-bold">
        Change how long this one lasts…
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Change how long this one lasts">
        <form action={bookAssetPolicyAction} className="flex flex-col gap-4">
          <input type="hidden" name="applianceId" value={applianceId} />
          <input type="hidden" name="version" value={version} />
          <label className="text-sm font-semibold">Months it lasts on your books
            <input className={field} name="lifeMonths" type="number" min={1} max={360} defaultValue={lifeMonths} required />
          </label>
          <label className="text-sm font-semibold">Value left at the end (%)
            <input className={field} name="salvagePercent" type="number" min={0} max={95} defaultValue={salvagePercent} required />
          </label>
          <p className="text-sm text-ink-soft">Applies to future months only. Months already recorded stay as they are.</p>
          <button className="min-h-11 rounded-field bg-evergreen px-4 font-bold text-white" type="submit">Save</button>
        </form>
      </Sheet>
    </>
  );
}
