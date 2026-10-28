"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/kit";
import { approveAssistantAction, declineAssistantAction } from "./assistant-activity-actions";

type Change = { label: string; now: string; after: string };
export function AssistantActivityControls({
  operationId, summary, changes, costNote,
}: { operationId: string; summary: string; changes: Change[]; costNote: string | null }) {
  const [open, setOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <form ref={form} action={approveAssistantAction}>
        <input name="operationId" type="hidden" value={operationId} />
        <button ref={trigger} type="button" onClick={() => setOpen(true)}
          className="min-h-11 rounded-field bg-primary px-4 font-bold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2">
          Approve
        </button>
      </form>
      <form action={declineAssistantAction}>
        <input name="operationId" type="hidden" value={operationId} />
        <button type="submit" className="min-h-11 rounded-field border border-line-strong px-4 font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2">
          Decline
        </button>
      </form>
      <ConfirmDialog open={open} onOpenChange={setOpen} returnFocusRef={trigger}
        spec={{ title: "Approve assistant action?", summary, confirmLabel: "Approve this action" }}
        onConfirm={() => form.current?.requestSubmit()}
        details={
          <div className="max-h-64 overflow-y-auto text-sm">
            {costNote ? <p className="mb-2 font-medium">{costNote}</p> : null}
            <table className="w-full text-left">
              <caption className="sr-only">Changes this action will make</caption>
              <thead><tr><th scope="col" className="p-2">Setting</th><th scope="col" className="p-2">Current</th><th scope="col" className="p-2">After</th></tr></thead>
              <tbody>{changes.map((change, index) => (
                <tr key={index} className="border-t border-line"><th scope="row" className="p-2">{change.label}</th>
                  <td className="p-2">{change.now}</td><td className="p-2">{change.after}</td></tr>
              ))}</tbody>
            </table>
          </div>
        }
      />
    </div>
  );
}
