"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { saveServiceAreaAction } from "./row-actions";

/**
 * AR-8: the "Where you deliver" panel's editor — just the service-area
 * cities and ZIP codes the address check reads, saved against the
 * service-area section revision. (The full business-profile form used to
 * be mounted a second time for this panel; the catalog page already
 * carries that form once, for the profile panel.)
 */
export function ServiceAreaForm({
  cities,
  zips,
  revision,
  canEdit,
}: {
  cities: string;
  zips: string;
  revision: string;
  canEdit: boolean;
}) {
  const [citiesText, setCitiesText] = useState(cities);
  const [zipsText, setZipsText] = useState(zips);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const result = await saveServiceAreaAction(citiesText, zipsText, revision);
      setMessage(
        result.status === "success"
          ? { kind: "success", text: "Service area saved." }
          : { kind: "error", text: result.message },
      );
    } catch {
      setMessage({ kind: "error", text: "The service area could not be saved. Your entries are still in the form; please try again." });
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "mt-1 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-ink";

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm text-ink-soft">
        The cities and ZIP codes the public address check treats as inside your service area.
      </p>
      <label className="block text-sm font-medium text-ink">
        Cities (comma-separated)
        <input className={inputCls} value={citiesText} onChange={(e) => setCitiesText(e.target.value)} disabled={!canEdit || saving} />
      </label>
      <label className="block text-sm font-medium text-ink">
        ZIP codes (comma-separated)
        <input className={inputCls} value={zipsText} onChange={(e) => setZipsText(e.target.value)} disabled={!canEdit || saving} />
      </label>
      {canEdit ? (
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save service area"}
        </Button>
      ) : null}
      {message ? (
        <p role="status" className={message.kind === "success" ? "text-sm text-success" : "text-sm text-danger"}>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
