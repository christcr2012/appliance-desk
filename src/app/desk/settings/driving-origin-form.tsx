"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { verifyDrivingOriginAction } from "./actions";

/**
 * AR-8 review fix: the "Where deliveries are measured from" panel's editor.
 * The address delivery distances and zones are measured from is recorded
 * through the same verified-origin writer the estimates flow uses — a real
 * street address in Greeley plus the reference for how it was checked, kept
 * with the date it was verified.
 */
export function DrivingOriginForm({
  address,
  verifiedAt,
  sourceReference,
}: {
  address: string;
  verifiedAt: string | null;
  sourceReference: string | null;
}) {
  const [street, setStreet] = useState(address.startsWith("UNVERIFIED") ? "" : address);
  const [reference, setReference] = useState(sourceReference ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const result = await verifyDrivingOriginAction(street, reference);
      setMessage(
        result.ok
          ? { kind: "success", text: "Origin verified and saved. Delivery distances are measured from this address." }
          : { kind: "error", text: result.message },
      );
    } catch {
      setMessage({ kind: "error", text: "The origin could not be saved. Your entries are still in the form; please try again." });
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "mt-1 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-ink";

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm text-ink-soft">
        Delivery distances and zones are measured from this address. Record a street address in Greeley you have
        actually checked — not a ZIP code or the city center — and say how you checked it.
      </p>
      {verifiedAt ? (
        <p className="text-sm text-ink">
          Currently verified {new Date(verifiedAt).toLocaleDateString("en-US", { timeZone: "America/Denver" })}
          {sourceReference ? <> — recorded check: {sourceReference}</> : null}
        </p>
      ) : (
        <p className="text-sm text-ink">Not verified yet: distances cannot be quoted from an unverified origin.</p>
      )}
      <label className="block text-sm text-ink">
        Street address in Greeley
        <input className={inputCls} value={street} onChange={(e) => setStreet(e.target.value)} autoComplete="street-address" />
      </label>
      <label className="block text-sm text-ink">
        How you checked it
        <input
          className={inputCls}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="For example: drove it on 2026-10-28, 1,240 miles on the odometer log"
        />
      </label>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-danger" : "text-sm text-ink"}>
          {message.text}
        </p>
      )}
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Verify and save"}
      </Button>
    </form>
  );
}
