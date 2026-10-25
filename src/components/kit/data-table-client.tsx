"use client";
// Client pieces of DataTable: opening the side panel from a row, sort links in headers and bulk selection.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import { ConfirmDialog } from "./confirm-dialog";
import { runFormAction } from "./run-action";
import type { ConfirmSpec, FormAction } from "./types";

/** Same URL with ?{panelParam}=key (other params kept). */
export function panelHref(pathname: string, search: string, panelParam: string, key: string): string {
  const params = new URLSearchParams(search);
  params.set(panelParam, key);
  return `${pathname}?${params.toString()}`;
}

/** Same URL with ?sort=value, without `cursor`. */
export function sortHref(pathname: string, search: string, value: string): string {
  const params = new URLSearchParams(search);
  params.set("sort", value);
  params.delete("cursor");
  return `${pathname}?${params.toString()}`;
}

function usePanelHref(panelParam: string, rowKey: string): string {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams()?.toString() ?? "";
  return panelHref(pathname, search, panelParam, rowKey);
}

/** A desktop table row: a click anywhere outside its own controls opens the side panel, keeping the scroll position. */
export function PanelRow({
  rowKey,
  panelParam,
  selected,
  children,
}: {
  rowKey: string;
  panelParam: string;
  selected: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const href = usePanelHref(panelParam, rowKey);
  const onClick = (event: MouseEvent<HTMLTableRowElement>) => {
    if ((event.target as HTMLElement).closest("a,button,input,label,select,textarea,[role=menu]")) return;
    router.push(href, { scroll: false });
  };
  return (
    <tr
      onClick={onClick}
      data-row-key={rowKey}
      aria-selected={selected || undefined}
      className={`cursor-pointer border-b border-line last:border-b-0 ${selected ? "bg-success-soft" : "hover:bg-tint"}`}
    >
      {children}
    </tr>
  );
}

/** The first cell's link (Enter on it opens the panel, like a row click). */
export function PanelLink({ rowKey, panelParam, children }: { rowKey: string; panelParam: string; children: ReactNode }) {
  const href = usePanelHref(panelParam, rowKey);
  return (
    <Link href={href} scroll={false} className="font-bold text-ink hover:underline">
      {children}
    </Link>
  );
}

export function SortHeaderLink({ value, current, children }: { value: string; current?: string; children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams()?.toString() ?? "";
  const active = (current ?? new URLSearchParams(search).get("sort")) === value;
  return (
    <Link
      href={sortHref(pathname, search, value)}
      scroll={false}
      aria-label={`Sort by ${typeof children === "string" ? children : value}`}
      aria-current={active ? "true" : undefined}
      className={`inline-flex items-center gap-1 hover:text-ink ${active ? "text-ink underline" : ""}`}
    >
      {children}
    </Link>
  );
}

type BulkAction = { label: string; action: FormAction; confirm?: ConfirmSpec };
type BulkState = { selected: Set<string>; toggle: (key: string, on: boolean) => void; setAll: (keys: string[], on: boolean) => void };
const BulkContext = createContext<BulkState | null>(null);

export function BulkSelection({ children, actions }: { children: ReactNode; actions: BulkAction[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const state: BulkState = {
    selected,
    toggle: (key, on) =>
      setSelected((previous) => {
        const next = new Set(previous);
        if (on) next.add(key);
        else next.delete(key);
        return next;
      }),
    setAll: (keys, on) => setSelected(on ? new Set(keys) : new Set()),
  };
  return (
    <BulkContext.Provider value={state}>
      {children}
      {selected.size > 0 ? <BulkBar actions={actions} selected={[...selected]} onDone={() => setSelected(new Set())} /> : null}
    </BulkContext.Provider>
  );
}

export function BulkCheckbox({ rowKey, label }: { rowKey: string; label: string }) {
  const bulk = useContext(BulkContext);
  if (!bulk) return null;
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="h-5 w-5 accent-primary"
      checked={bulk.selected.has(rowKey)}
      onChange={(event) => bulk.toggle(rowKey, event.target.checked)}
    />
  );
}

export function BulkAllCheckbox({ keys }: { keys: string[] }) {
  const bulk = useContext(BulkContext);
  if (!bulk) return null;
  const all = keys.length > 0 && keys.every((key) => bulk.selected.has(key));
  return (
    <input
      type="checkbox"
      aria-label="Select all rows"
      className="h-5 w-5 accent-primary"
      checked={all}
      onChange={(event) => bulk.setAll(keys, event.target.checked)}
    />
  );
}

function BulkSubmit({
  label,
  onConfirmFirst,
  buttonRef,
}: {
  label: string;
  onConfirmFirst?: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      ref={buttonRef}
      type="submit"
      disabled={pending}
      onClick={
        onConfirmFirst
          ? (event) => {
              event.preventDefault();
              onConfirmFirst();
            }
          : undefined
      }
      className="inline-flex min-h-11 items-center rounded-field bg-on-primary px-4 text-[15px] font-bold text-primary disabled:opacity-60 lg:h-10 lg:min-h-0"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

function BulkActionForm({ action, selected, onDone }: { action: BulkAction; selected: string[]; onDone: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  return (
    <form
      ref={formRef}
      action={async (data: FormData) => {
        const ok = await runFormAction({ kind: "form", label: action.label, action: action.action, confirm: action.confirm }, data);
        if (ok) onDone();
      }}
    >
      {selected.map((key) => (
        <input key={key} type="hidden" name="id" value={key} />
      ))}
      <BulkSubmit
        label={action.label}
        buttonRef={buttonRef}
        onConfirmFirst={action.confirm ? () => setConfirming(true) : undefined}
      />
      {action.confirm ? (
        <ConfirmDialog open={confirming} onOpenChange={setConfirming} spec={action.confirm} onConfirm={() => formRef.current?.requestSubmit()} returnFocusRef={buttonRef} />
      ) : null}
    </form>
  );
}

function BulkBar({ actions, selected, onDone }: { actions: BulkAction[]; selected: string[]; onDone: () => void }) {
  return (
    <div
      role="region"
      aria-label="Selected rows"
      className="sticky bottom-0 z-20 mt-3 flex flex-wrap items-center gap-3 rounded-card bg-primary px-4 py-3 text-on-primary shadow-raise"
    >
      <span className="text-[15px] font-bold tabular-nums">{selected.length} selected</span>
      <div className="ml-auto flex flex-wrap gap-2">
        {actions.map((action) => (
          <BulkActionForm key={action.label} action={action} selected={selected} onDone={onDone} />
        ))}
      </div>
    </div>
  );
}
