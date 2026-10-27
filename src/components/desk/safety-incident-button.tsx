"use client";

import { useState, useTransition } from "react";
import { Button, Textarea } from "@/components/ui";
import { markSafetyIncidentAction } from "@/app/desk/recalls/actions";

/**
 * "Injury or safety incident" on a repair request or a visit. Marking it puts a high To do on the owner's list:
 * decide within 24 hours whether to report it to the U.S. Consumer Product Safety Commission.
 */
export function SafetyIncidentButton({ maintenanceRequestId, jobId, applianceId }: { maintenanceRequestId?: string; jobId?: string; applianceId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    start(async () => {
      const result = await markSafetyIncidentAction({ description: text, maintenanceRequestId: maintenanceRequestId ?? null, jobId: jobId ?? null, applianceId: applianceId ?? null });
      if (result.status === "error") return setMessage({ ok: false, text: result.message });
      setMessage({ ok: true, text: result.status === "success" ? result.message ?? "Marked." : "Marked." });
      setOpen(false);
      setText("");
    });
  }

  return (
    <div className="mt-4">
      {!open && <Button type="button" variant="secondary" onClick={() => setOpen(true)}>Injury or safety incident</Button>}
      {open && (
        <form onSubmit={submit} className="grid max-w-md gap-2 rounded-card border border-line bg-surface p-4">
          <Textarea id="safety-incident-text" label="What happened?" value={text} onChange={(e) => setText(e.target.value)} help="For example: someone was hurt, a smell of gas, sparks, smoke, or a fire. The owner decides within 24 hours whether to report it." required />
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Mark it"}</Button>
            <Button type="button" variant="quiet" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}
      {message && <p role={message.ok ? "status" : "alert"} className={`mt-2 text-sm font-semibold ${message.ok ? "text-ink" : "text-danger"}`}>{message.text}</p>}
    </div>
  );
}
