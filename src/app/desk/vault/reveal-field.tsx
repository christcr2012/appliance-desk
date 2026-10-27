"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { REVEAL_HIDE_SECONDS } from "@/domains/vault/rules";
import { revealFieldAction } from "./actions";

/**
 * VAULT-2: one secret field on the login page. The value is fetched only
 * when the owner taps Show or Copy (the server checks the unlock and writes
 * an audit row), shown for 30 seconds, then hidden again; a copied value
 * clears the clipboard after 30 seconds where the browser allows it.
 */
export function RevealField({
  credentialId,
  field,
  label,
  hasValue,
}: {
  credentialId: string;
  field: "username" | "password" | "notes";
  label: string;
  hasValue: boolean;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (clipTimer.current) clearTimeout(clipTimer.current);
    };
  }, []);

  async function fetchValue(purpose: "show" | "copy"): Promise<string | null> {
    setBusy(true);
    setError(null);
    const result = await revealFieldAction(credentialId, field, purpose);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return null;
    }
    return result.value;
  }

  async function show() {
    const fetched = await fetchValue("show");
    if (fetched == null) return;
    setValue(fetched);
    setNote(null);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setValue(null), REVEAL_HIDE_SECONDS * 1000);
  }

  async function copy() {
    const fetched = await fetchValue("copy");
    if (fetched == null) return;
    try {
      await navigator.clipboard.writeText(fetched);
      setNote(`Copied. It clears from the clipboard in ${REVEAL_HIDE_SECONDS} seconds where your browser allows.`);
      if (clipTimer.current) clearTimeout(clipTimer.current);
      clipTimer.current = setTimeout(() => {
        navigator.clipboard.writeText("").catch(() => undefined);
      }, REVEAL_HIDE_SECONDS * 1000);
    } catch {
      // Clipboard blocked: fall back to showing the value so it can be copied by hand.
      setValue(fetched);
      setNote("Copying was blocked by the browser, so the value is shown instead.");
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setValue(null), REVEAL_HIDE_SECONDS * 1000);
    }
  }

  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="mt-1 text-sm">
        {!hasValue ? (
          <span className="text-ink-soft">Not saved</span>
        ) : value != null ? (
          <span className="break-all font-mono">{value}</span>
        ) : (
          <span className="text-ink-soft">Saved (encrypted)</span>
        )}
      </dd>
      {hasValue && (
        <div className="mt-2 flex flex-wrap gap-2">
          {value == null ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={show}>
              {busy ? "Checking…" : "Show"}
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setValue(null)}>
              Hide
            </Button>
          )}
          <Button type="button" variant="secondary" disabled={busy} onClick={copy}>
            Copy
          </Button>
        </div>
      )}
      {note && <p className="mt-2 text-sm text-ink-soft">{note}</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">{error}</p>
      )}
    </div>
  );
}
