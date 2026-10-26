"use client";
import { useActionState } from "react";
import { InfoTip } from "@/components/ui/info-tip";
import { saveUcccFilingAction } from "./uccc-filing-actions";

export function UcccFilingForm({ filedOn, editable }: { filedOn: string | null; editable: boolean }) {
  const [state, action, pending] = useActionState(saveUcccFilingAction, { error: "", success: "" });
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        {filedOn ? `Marked as filed on ${filedOn}.` : "Not marked as filed yet — not confirmed."} Needed before the first household rental over 4 months.{" "}
        <InfoTip term="uccc-filing" />
      </p>
      <form action={action} className="flex min-w-0 flex-wrap items-end gap-3">
        <label className="grid min-w-0 gap-1 text-sm font-medium">
          Day it was filed
          <input type="date" name="filedOn" defaultValue={filedOn ?? ""} disabled={!editable} className="min-w-0 rounded-control border border-line p-2" />
        </label>
        <button disabled={!editable || pending} type="submit" className="min-h-11 rounded-control border border-line px-4 font-medium">Save</button>
        <button disabled={!editable || pending} name="operation" value="clear" formNoValidate type="submit" className="min-h-11 rounded-control border border-line px-4 text-sm">Clear</button>
      </form>
      {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      {state.success ? <p role="status" className="text-sm text-ink">{state.success}</p> : null}
      {!editable ? <p className="text-sm text-ink-soft">Only the owner can change this.</p> : null}
    </div>
  );
}
