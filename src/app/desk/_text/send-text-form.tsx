"use client";

import { useActionState, useId, useState } from "react";
import type { WorkflowTextPreview } from "@/domains/messaging/workflow-text";
import { recordTextConsentAction, sendTextAction, type TextActionState } from "./actions";

const METHODS: [string, string][] = [["PHONE", "They agreed on the phone"], ["WRITTEN", "They agreed in writing or by email"], ["IN_PERSON", "They agreed in person"]];

export function SendTextForm({ preview, subjectId, path, principal }: {
  preview: WorkflowTextPreview; subjectId: string; path: string; principal: { leadId?: string; customerId?: string };
}) {
  const screenId = useId().replace(/[^A-Za-z0-9]/g, "").padEnd(10, "0").slice(0, 26);
  const [round, setRound] = useState(0);
  const token = `${screenId}r${round}`;
  // Each finished attempt starts a new round, so a deliberate "send again" is a new text, while a double click
  // inside one round is still recognised as the same send.
  const [sendState, send, sending] = useActionState<TextActionState, FormData>(async (prev, form) => {
    const result = await sendTextAction(prev, form);
    setRound((r) => r + 1);
    return result;
  }, null);
  const [consentState, consent, saving] = useActionState<TextActionState, FormData>(recordTextConsentAction, null);
  const duplicate = preview.blockers.some((b) => b.code === "RECENT_DUPLICATE");
  const hard = preview.blockers.filter((b) => b.code !== "RECENT_DUPLICATE" && b.code !== "NEEDS_CONSENT");
  const needsConsent = preview.blockers.some((b) => b.code === "NEEDS_CONSENT");
  const canSend = hard.length === 0 && !needsConsent && Boolean(preview.text);
  return <div className="rounded border border-line p-3">
    <h3 className="font-semibold">{preview.label}</h3>
    {preview.maskedPhone && <p className="text-sm">To {preview.recipientName || "this person"} at {preview.maskedPhone}</p>}
    {preview.text && <blockquote className="mt-2 rounded bg-surface-soft p-2 text-sm">{preview.text}
      <span className="block text-xs text-ink-soft">{preview.segments} text part{preview.segments === 1 ? "" : "s"}</span></blockquote>}
    <p className="mt-1 text-xs text-ink-soft">{preview.quietHours}</p>
    {hard.length > 0 && <div role="status" className="mt-2 text-sm"><ul className="list-disc pl-5">{hard.map((b) => <li key={b.code}>{b.message}</li>)}</ul></div>}
    {needsConsent && hard.length === 0 && !preview.canRecordConsent && <p role="status" className="mt-2 text-sm">
      There is no recorded permission to text this number. Ask the office to record it first.</p>}
    {needsConsent && hard.length === 0 && preview.canRecordConsent && <form action={consent} className="mt-2 space-y-2 rounded border border-line p-2">
      <p className="text-sm">There is no recorded permission to text this number. If they have agreed to get texts from you, record how.</p>
      <input type="hidden" name="path" value={path} />
      {principal.leadId && <input type="hidden" name="leadId" value={principal.leadId} />}
      {principal.customerId && <input type="hidden" name="customerId" value={principal.customerId} />}
      <label className="block text-sm">How did they agree?
        <select name="method" required className="ml-2 rounded border border-line p-1">
          <option value="">Choose</option>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <button disabled={saving} className="rounded border border-line px-3 py-1 text-sm">Save permission</button>
      {consentState && <p role="status" className="text-sm">{consentState.message}</p>}
    </form>}
    <form action={send} className="mt-2">
      <input type="hidden" name="family" value={preview.family} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <input type="hidden" name="clientToken" value={token} />
      <input type="hidden" name="textHash" value={preview.textHash ?? ""} />
      <input type="hidden" name="path" value={path} />
      {duplicate && <label className="mb-2 block text-sm"><input type="checkbox" name="sendAgain" value="yes" className="mr-2" />
        {preview.blockers.find((b) => b.code === "RECENT_DUPLICATE")?.message} Send it again anyway.</label>}
      <button disabled={!canSend || sending} className="rounded bg-brand px-3 py-1 text-sm text-white disabled:opacity-50">
        {sending ? "Sending…" : "Send text"}</button>
      {sendState && <p role="status" className="mt-2 text-sm">{sendState.message}</p>}
    </form>
  </div>;
}
