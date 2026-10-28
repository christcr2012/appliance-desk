"use client";
// AR-8 kit (SETTINGS spec sections 3 + 5): SettingRow — one setting as a
// row with its explanation, last change, state pill, and Change / Restore /
// History in a Sheet — plus PanelRow (the existing editor behind a summary
// row) and the section list that renders them in order.

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "./confirm-dialog";
import { Icon } from "./icons";
import { Sheet } from "./sheet";
import { toast } from "./toaster";
import { formatShortDate } from "@/lib/business-date";
import { saveSettingRowAction, undoSettingRowAction, rowHistoryAction, type RowHistoryEntry } from "@/app/desk/settings/row-actions";
import type { SettingKind } from "@/domains/settings/catalog";

export type SettingRowData = {
  key: string;
  label: string;
  kind: SettingKind;
  choices?: { value: string; label: string }[];
  min?: number;
  max?: number;
  what: string;
  why?: string;
  who: "owner" | "finance";
  effect: string;
  value: unknown;
  display: string;
  recommended?: unknown;
  recommendedDisplay?: string;
  lastChange: { by: string; at: string } | null;
  state?: "starting" | "confirmed" | "needs-setup";
  editable: boolean;
  revision: string;
};

/** The scalar display format, mirroring domains/settings/history's formatSettingValue for row kinds. */
export function formatRowValue(kind: SettingKind, value: unknown): string {
  if (value === null || value === undefined || value === "") return "not set";
  if (kind === "money" && typeof value === "number") return `$${(value / 100).toFixed(2)}`;
  if (kind === "hours" && typeof value === "number") {
    const h = ((value % 24) + 24) % 24;
    return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;
  }
  if (kind === "percent" && typeof value === "number") return `${value}%`;
  if (kind === "yesno" || typeof value === "boolean") return value ? "On" : "Off";
  if (Array.isArray(value)) return value.length ? value.map(String).join(", ") : "none";
  if (typeof value === "object") return "changed (see the settings screen)";
  return String(value);
}

function InfoPopover({ row }: { row: SettingRowData }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-label={`About ${row.label}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-soft hover:bg-tint"
      >
        <Icon name="info" />
      </button>
      {open && (
        <span className="absolute left-0 top-7 z-30 block w-72 rounded-card border border-line bg-surface p-3 text-left text-sm font-normal text-ink shadow-raise">
          <span className="block">{row.what}</span>
          {row.recommendedDisplay && (
            <span className="mt-2 block text-ink-soft">
              Starting value: {row.recommendedDisplay}
              {row.why ? ` — ${row.why}` : ""}
            </span>
          )}
          {row.effect && <span className="mt-2 block text-ink-soft">{row.effect}</span>}
          <span className="mt-2 block text-ink-soft">
            Who can change it: {row.who === "owner" ? "the owner" : "the owner or an admin"}
          </span>
        </span>
      )}
    </span>
  );
}

function EditorInput({ row, draft, setDraft }: { row: SettingRowData; draft: unknown; setDraft: (v: unknown) => void }) {
  const inputCls = "w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-ink";
  switch (row.kind) {
    case "money":
      return (
        <label className="block text-sm text-ink">
          Amount ($)
          <input type="number" min={0} step="0.01" className={`mt-1 ${inputCls}`} value={typeof draft === "number" ? draft : ""} onChange={(e) => setDraft(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
      );
    case "days":
    case "hours":
    case "minutes":
    case "number":
    case "percent":
      return (
        <label className="block text-sm text-ink">
          {row.kind === "percent" ? "Percent" : row.kind === "hours" ? "Hour (0–23)" : "Amount"}
          <input type="number" min={row.min} max={row.max} step={row.kind === "percent" ? "0.1" : "1"} className={`mt-1 ${inputCls}`} value={typeof draft === "number" ? draft : ""} onChange={(e) => setDraft(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
      );
    case "yesno":
      return (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="h-4 w-4" checked={draft === true} onChange={(e) => setDraft(e.target.checked)} />
          On
        </label>
      );
    case "text":
      return (
        <label className="block text-sm text-ink">
          {row.label}
          <input type="text" className={`mt-1 ${inputCls}`} value={typeof draft === "string" ? draft : ""} onChange={(e) => setDraft(e.target.value)} />
        </label>
      );
    case "choice": {
      const current = (draft && typeof draft === "object" ? draft : {}) as Record<string, boolean>;
      return (
        <div className="space-y-2">
          {(row.choices ?? []).map((c) => (
            <label key={c.value} className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4" checked={current[c.value] === true} onChange={(e) => setDraft({ ...current, [c.value]: e.target.checked })} />
              {c.label}
            </label>
          ))}
        </div>
      );
    }
    case "list":
      return (
        <label className="block text-sm text-ink">
          One per line
          <textarea className={`mt-1 ${inputCls}`} rows={4} value={Array.isArray(draft) ? draft.join("\n") : ""} onChange={(e) => setDraft(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
        </label>
      );
    default:
      return null;
  }
}

export function SettingRow({ row }: { row: SettingRowData }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<"change" | "history" | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [draft, setDraft] = useState<unknown>(row.kind === "money" && typeof row.value === "number" ? row.value / 100 : row.value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<RowHistoryEntry[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const changeButtonRef = useRef<HTMLButtonElement>(null);

  const showRestore =
    row.recommended !== undefined && JSON.stringify(row.value ?? null) !== JSON.stringify(row.recommended ?? null);

  async function save(value: unknown) {
    setBusy(true);
    setError(null);
    const result = await saveSettingRowAction(row.key, value, row.revision);
    setBusy(false);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    setSheet(null);
    const auditId = result.auditId;
    toast({
      message: `Saved ${row.label}`,
      undo: auditId
        ? async () => {
            await undoSettingRowAction(auditId, row.key);
            router.refresh();
          }
        : undefined,
    });
    router.refresh();
  }

  async function openHistory() {
    setSheet("history");
    setHistory(null);
    setHistory(await rowHistoryAction(row.key));
  }

  return (
    <div id={`row-${row.key}`} className="flex min-h-14 flex-col justify-center border-b border-line py-2 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="font-semibold text-ink">{row.label}</span>
          <InfoPopover row={row} />
          {row.state === "starting" && (
            <span className="ml-2 rounded-full bg-attention-soft px-2 py-0.5 text-xs font-medium text-attention-ink">Starting value — not confirmed</span>
          )}
          {row.state === "needs-setup" && (
            <span className="ml-2 rounded-full bg-attention-soft px-2 py-0.5 text-xs font-medium text-attention-ink">Needs setup</span>
          )}
          <p className="text-sm text-ink-soft">
            {row.lastChange ? `Changed by ${row.lastChange.by} · ${formatShortDate(new Date(row.lastChange.at))}` : "Not changed yet"}
          </p>
          {note && <p className="text-sm text-attention-ink">{note}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="mr-1 text-right text-sm font-medium text-ink">{row.display}</span>
          {row.editable ? (
            <>
              <button ref={changeButtonRef} type="button" onClick={() => { setDraft(row.kind === "money" && typeof row.value === "number" ? row.value / 100 : row.value); setError(null); setSheet("change"); }} className="rounded-control px-2 py-1 text-sm font-medium text-primary hover:bg-tint">
                Change…
              </button>
              <button type="button" aria-label={`More actions for ${row.label}`} onClick={openHistory} className="inline-flex h-8 w-8 items-center justify-center rounded-control text-ink-soft hover:bg-tint">
                <Icon name="more" />
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setNote("Only the owner can change this.")} className="rounded-control px-2 py-1 text-sm text-ink-soft">
              View
            </button>
          )}
        </div>
      </div>

      <Sheet open={sheet === "change"} onOpenChange={(o) => !o && setSheet(null)} title={row.label} footer={
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => save(draft)} className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50">Save</button>
          <button type="button" onClick={() => setSheet(null)} className="rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-ink">Cancel</button>
        </div>
      }>
        <div className="space-y-4">
          <EditorInput row={row} draft={draft} setDraft={setDraft} />
          {row.effect && <p className="text-sm text-ink-soft">{row.effect}</p>}
          <p className="text-sm text-ink">
            From {row.display} to {formatRowValue(row.kind, row.kind === "money" && typeof draft === "number" ? Math.round(draft * 100) : draft)}
          </p>
          {showRestore && (
            <button type="button" onClick={() => setConfirmRestore(true)} className="text-sm font-medium text-primary hover:underline">
              Restore recommended
            </button>
          )}
          <button type="button" onClick={openHistory} className="block text-sm font-medium text-primary hover:underline">History</button>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      </Sheet>

      <Sheet open={sheet === "history"} onOpenChange={(o) => !o && setSheet(null)} title={`History — ${row.label}`}>
        {history === null ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-ink-soft">Not changed yet.</p>
        ) : (
          <ul className="space-y-3">
            {history.map((h) => (
              <li key={h.auditId} className="border-b border-line pb-3 text-sm last:border-b-0">
                <p className="text-ink">{h.from} → {h.to}</p>
                <p className="text-ink-soft">{h.by} · {formatShortDate(new Date(h.at))}</p>
                {h.undoable ? (
                  <button type="button" className="mt-1 font-medium text-primary hover:underline" onClick={async () => {
                    const r = await undoSettingRowAction(h.auditId, row.key);
                    if (r.status === "success") { setSheet(null); toast({ message: `Undid ${row.label}` }); router.refresh(); }
                  }}>Undo</button>
                ) : h.undoReason ? (
                  <p className="mt-1 text-ink-soft">{h.undoReason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmRestore}
        onOpenChange={setConfirmRestore}
        spec={{
          title: `Set ${row.label} back to ${row.recommendedDisplay ?? formatRowValue(row.kind, row.recommended)}?`,
          summary: row.what,
          confirmLabel: "Restore",
        }}
        onConfirm={() => {
          setConfirmRestore(false);
          void save(row.kind === "money" && typeof row.recommended === "number" ? row.recommended / 100 : row.recommended);
        }}
        returnFocusRef={changeButtonRef}
      />
    </div>
  );
}

export function PanelRow({ label, what, summary, href, children }: {
  label: string;
  what: string;
  summary?: string;
  href?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (href) {
    return (
      <Link href={href} className="flex min-h-14 items-center justify-between gap-3 border-b border-line py-2 last:border-b-0">
        <span>
          <span className="block font-semibold text-ink">{label}</span>
          <span className="block text-sm text-ink-soft">{summary || what}</span>
        </span>
        <Icon name="back" className="rotate-180 text-ink-soft" />
      </Link>
    );
  }
  return (
    <div className="border-b border-line py-2 last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-14 w-full items-center justify-between gap-3 text-left">
        <span>
          <span className="block font-semibold text-ink">{label}</span>
          <span className="block text-sm text-ink-soft">{summary || what}</span>
        </span>
        <span className="flex items-center gap-2 text-sm font-medium text-primary">
          Change…
          <Icon name="down" className={open ? "rotate-180" : ""} />
        </span>
      </button>
      {open && <div className="pb-4 pt-2">{children}</div>}
    </div>
  );
}

/** Scrolls to the row named by the URL hash and flashes it briefly (SETTINGS spec section 3). */
export function RowAnchorFlash() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#row-")) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    if (window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
      el.classList.add("bg-attention-soft");
      const t = setTimeout(() => el.classList.remove("bg-attention-soft"), 1500);
      return () => clearTimeout(t);
    }
  }, []);
  return null;
}
