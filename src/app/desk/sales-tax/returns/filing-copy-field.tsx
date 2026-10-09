"use client";
import { useState } from "react";

export function FilingCopyField({ label, value }: { label: string; value: string }) {
  const [message, setMessage] = useState("");
  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm">
    <span><span className="font-medium">{label}:</span> <span className="font-mono">{value}</span></span>
    <button type="button" aria-label={`Copy ${label}`}
      className="rounded border border-border px-3 py-1 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setMessage("Copied"); }
        catch { setMessage("Copy unavailable; select the text above."); }
      }}>Copy</button>
    {message && <span role="status" className="w-full text-xs text-muted-foreground">{message}</span>}
  </div>;
}

