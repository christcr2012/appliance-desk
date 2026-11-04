"use client";
import { useActionState, useState } from "react";
import { createOpsAgentKeyAction, revokeOpsAgentKeyAction } from "./actions";
import { opsHandoffText } from "@/domains/system-issues/ops-contract";

type KeyRow = { id: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };

export function OpsKeyPanel({ keys, baseUrl }: { keys: KeyRow[]; baseUrl: string }) {
  const [result, createAction, pending] = useActionState(createOpsAgentKeyAction, { key: null, error: null });
  const [copied, setCopied] = useState(false);
  const handoff = result.key ? opsHandoffText({ baseUrl, key: result.key }) : null;
  return <section aria-label="AI check-up keys" className="my-6 rounded-control border border-line p-4 space-y-4">
    <h2 className="text-lg font-semibold text-ink">AI check-up keys</h2>
    <p className="text-sm text-ink-soft">Private, read-mostly access for an AI assistant. A new key is shown only once, together with a hand-off block that gives the assistant everything it needs — this app&apos;s address, how to call, and the check-up job. Copy the whole block and paste it to the assistant. Never include a key in a GitHub issue or commit.</p>
    <form action={createAction} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm text-ink">
        Key label
        <input name="label" minLength={2} maxLength={80} required className="rounded-control border border-line bg-surface px-3 py-2" placeholder="Morning check-up" />
      </label>
      <button type="submit" disabled={pending} className="rounded-control bg-ink px-4 py-2 text-sm text-surface">Create AI check-up key</button>
    </form>
    {result.error && <p role="alert" className="text-sm text-danger">{result.error}</p>}
    {result.key && handoff && <div className="rounded-control border border-line bg-subtle p-3 space-y-3">
      <p className="font-semibold text-sm">Copy now — this key will not be shown again.</p>
      <output aria-label="New AI check-up key" className="block break-all font-mono text-sm">{result.key}</output>
      <p className="text-sm text-ink-soft">The key on its own is not enough — the assistant would not know where to call or what to do. Give it this whole block instead:</p>
      <label className="block text-sm text-ink">
        Hand-off for the assistant
        <textarea aria-label="AI check-up hand-off block" readOnly rows={14} value={handoff} className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 font-mono text-xs" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(handoff); setCopied(true); } catch { setCopied(false); }
        }} className="rounded-control bg-ink px-4 py-2 text-sm text-surface">Copy hand-off block</button>
        {copied && <span role="status" className="text-sm text-ink-soft">Copied — paste the whole block to the assistant.</span>}
      </div>
    </div>}
    {keys.length === 0 ? <p className="text-sm text-ink-soft">No keys issued.</p> : <ul className="space-y-2">
      {keys.map(key => <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line p-2 text-sm">
        <div><strong>{key.label}</strong><span className="block text-ink-soft">Created {key.createdAt}; last used {key.lastUsedAt ?? "never"}; {key.revokedAt ? "revoked" : "active"}</span></div>
        {!key.revokedAt && <form action={revokeOpsAgentKeyAction}>
          <input type="hidden" name="keyId" value={key.id} />
          <button type="submit" className="rounded-control border border-line px-3 py-2">Revoke key</button>
        </form>}
      </li>)}
    </ul>}
  </section>;
}
