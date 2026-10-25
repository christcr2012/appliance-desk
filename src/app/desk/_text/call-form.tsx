"use client";

import { useActionState, useId, useState } from "react";
import { setClickToCallAction, startCallAction, type TextActionState } from "./actions";

export function CallForm({ type, subjectId, path, customerName, customerPhone, staffPhone, businessNumber }: {
  type: "Job" | "Lead" | "MaintenanceRequest"; subjectId: string; path: string;
  customerName: string; customerPhone: string; staffPhone: string; businessNumber: string;
}) {
  const screenId = useId().replace(/[^A-Za-z0-9]/g, "").padEnd(10, "0").slice(0, 26);
  const [round, setRound] = useState(0);
  const [state, act, pending] = useActionState<TextActionState, FormData>(async (prev, form) => {
    const result = await startCallAction(prev, form);
    setRound((r) => r + 1);
    return result;
  }, null);
  return <form action={act} className="mt-2">
    <input type="hidden" name="type" value={type} />
    <input type="hidden" name="subjectId" value={subjectId} />
    <input type="hidden" name="path" value={path} />
    <input type="hidden" name="clientToken" value={`${screenId}r${round}`} />
    <p className="text-sm">Your phone ({staffPhone}) rings first. Press 1 and it connects you to {customerName || "the customer"} at {customerPhone}.
      They see the business number {businessNumber}.</p>
    <button disabled={pending} className="mt-2 rounded bg-brand px-3 py-1 text-sm text-white disabled:opacity-50">
      {pending ? "Calling…" : "Call from the desk"}</button>
    {state && <p role="status" className="mt-2 text-sm">{state.message}</p>}
  </form>;
}

export function ClickToCallSwitch({ enabled, voiceReady, version }: { enabled: boolean; voiceReady: boolean; version: number }) {
  const [state, act, pending] = useActionState<TextActionState, FormData>(setClickToCallAction, null);
  return <form action={act} className="mt-2">
    <input type="hidden" name="version" value={version} />
    <input type="hidden" name="enabled" value={enabled ? "no" : "yes"} />
    <p className="text-sm">Calls from the desk are <strong>{enabled ? "on" : "off"}</strong>.
      {!voiceReady && " Phone call routing must be set up and switched on first."}</p>
    <button disabled={pending || (!enabled && !voiceReady)} className="mt-1 rounded border border-line px-3 py-1 text-sm disabled:opacity-50">
      {enabled ? "Switch off" : "Switch on"}</button>
    {state && <p role="status" className="mt-1 text-sm">{state.message}</p>}
  </form>;
}
