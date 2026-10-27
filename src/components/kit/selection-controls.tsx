"use client";
// AR-12: one accessible way to choose values across the desk. Choices stay native; only long record lists use cmdk.
import * as Popover from "@radix-ui/react-popover";
import { Command, CommandInput, CommandItem, CommandList } from "cmdk";
import Link from "next/link";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { InfoTip } from "./info-tip";
import { Sheet } from "./sheet";
import { useDeskOffline } from "./offline-bar";
import { useOptimisticAction } from "./use-optimistic-action";
import { useMediaQuery, DESKTOP_QUERY } from "./use-media-query";
import type { GlossaryKey } from "./types";

type Choice = { value: string; label: string };
const FIELD = "min-h-11 w-full rounded-field border border-line-strong bg-surface px-3 text-[15px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const LABEL = "mb-1.5 block text-sm font-bold text-ink";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

export function SegmentedControl({ name, label, options, value, onChange }: {
  name: string; label: string; options: Choice[]; value: string; onChange?: (v: string) => void;
}) {
  if (process.env.NODE_ENV !== "production" && (options.length < 2 || options.length > 4)) {
    throw new Error("Choose between two and four options for a segmented control.");
  }
  return <fieldset className="min-w-0">
    <legend className={LABEL}>{label}</legend>
    <div className="flex min-h-11 overflow-hidden rounded-field border border-line-strong" role="group">
      {options.slice(0, 4).map((option) => (
        <label key={option.value} className="relative min-w-0 flex-1 cursor-pointer border-r border-line-strong last:border-r-0">
          <input type="radio" name={name} value={option.value} checked={onChange ? value === option.value : undefined}
            defaultChecked={!onChange ? value === option.value : undefined}
            onChange={onChange ? () => onChange(option.value) : undefined} className="peer sr-only" />
          <span className="flex min-h-11 items-center justify-center px-2 text-center text-sm font-bold text-ink peer-checked:bg-primary peer-checked:text-on-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[-2px] peer-focus-visible:outline-focus-ring">
            {option.label}
          </span>
        </label>
      ))}
    </div>
  </fieldset>;
}

export function Select({ name, label, options, value, placeholder, required, error }: {
  name: string; label: string; options: Choice[]; value?: string; placeholder?: string; required?: boolean; error?: string;
}) {
  const id = useId(), errorId = id + "-error";
  return <div className="min-w-0">
    <label htmlFor={id} className={LABEL}>{label}</label>
    <div className="relative">
      <select id={id} name={name} defaultValue={value ?? ""} required={required}
        aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
        className={FIELD + " appearance-none pr-10"}>
        {placeholder ? <option value="" disabled>{placeholder}</option> : null}
        {!placeholder && value === undefined ? <option value="">Choose one</option> : null}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <Icon name="down" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft" />
    </div>
    {error ? <p id={errorId} className="mt-1 text-sm font-semibold text-danger">{error}</p> : null}
  </div>;
}

export function OptionCards({ name, label, options, value }: {
  name: string; label: string;
  options: { value: string; title: string; line: string; info?: GlossaryKey; recommended?: boolean }[];
  value: string;
}) {
  return <fieldset>
    <legend className={LABEL}>{label}</legend>
    <div className="grid gap-2.5 md:grid-cols-2">
      {options.map((choice) => <div key={choice.value} className="relative min-w-0">
        <label className="block cursor-pointer">
          <input type="radio" name={name} value={choice.value} defaultChecked={value === choice.value} className="peer sr-only" />
          <span className="block min-h-11 rounded-field border border-line-strong bg-surface px-4 py-3 text-ink peer-checked:border-primary peer-checked:bg-success-soft peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus-ring">
            <span className="flex items-center gap-2 font-bold">
              {choice.title}
              {choice.recommended ? <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-bold text-success">Recommended</span> : null}
            </span>
            <span className="mt-1 block pr-7 text-sm font-normal text-ink-soft">{choice.line}</span>
          </span>
        </label>
        {choice.info ? <span className="absolute right-4 bottom-4"><InfoTip term={choice.info} /></span> : null}
      </div>)}
    </div>
  </fieldset>;
}

type PickedRecord = { id: string; label: string; detail?: string };
export const PICKER_DEBOUNCE_MS = 200;
export const PICKER_MIN_CHARS = 2;

export function SearchablePicker({ name, label, search, value, addNew }: {
  name: string; label: string;
  search: (q: string) => Promise<PickedRecord[]>;
  value?: PickedRecord;
  addNew?: { label: string; href: string };
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Local selection only overrides its matching input prop; a changed server value takes precedence.
  const [selection, setSelection] = useState<{ source: PickedRecord | undefined; record: PickedRecord } | null>(null);
  const choice = selection !== null && selection.source === value ? selection.record : value;
  const [result, setResult] = useState<{ query: string; rows: PickedRecord[] } | null>(null);
  const [loadingQuery, setLoadingQuery] = useState<string | null>(null);
  const [errorQuery, setErrorQuery] = useState<string | null>(null);
  const activeQuery = query.trim();
  const failed = errorQuery === activeQuery;
  const loading = activeQuery.length >= PICKER_MIN_CHARS &&
    (loadingQuery === activeQuery || (!failed && result?.query !== activeQuery));
  // Never display previous query's results while another search is pending.
  const found = !loading && !failed && result?.query === activeQuery ? result.rows : [];
  useEffect(() => {
    const trimmed = query.trim();
    if (!open || trimmed.length < PICKER_MIN_CHARS) return;
    let alive = true;
    const handle = setTimeout(() => {
      setLoadingQuery(trimmed); setErrorQuery(null);
      search(trimmed).then((rows) => {
        if (alive) setResult({ query: trimmed, rows: rows.slice(0, 30) });
      }).catch(() => {
        if (alive) { setErrorQuery(trimmed); setResult(null); }
      }).finally(() => { if (alive) setLoadingQuery(null); });
    }, PICKER_DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(handle); };
  }, [query, open, search]);
  const setVisible = (next: boolean) => {
    setOpen(next);
    if (!next) { setQuery(""); setResult(null); setErrorQuery(null); setLoadingQuery(null); }
  };
  const body: ReactNode = <Command shouldFilter={false} label={"Choose " + label} className="text-ink">
    <CommandInput value={query} onValueChange={setQuery} placeholder="Type 2 letters to search"
      aria-label={"Search " + label} className={FIELD + " mb-2"} />
    {query.trim().length < PICKER_MIN_CHARS ? <p className="py-3 text-sm text-ink-soft">Type 2 letters to search.</p> :
      <CommandList className="max-h-64 overflow-y-auto">
        {loading ? <p role="status" className="py-3 text-sm text-ink-soft">Searching…</p> : null}
        {failed ? <p role="alert" className="py-3 text-sm text-danger">Search did not work. Try again.</p> : null}
        {!loading && !failed && found.length === 0 ? <p className="py-3 text-sm text-ink-soft">No matches found</p> : null}
        {!loading && !failed && found.map((record) => <CommandItem key={record.id} value={record.id}
          onSelect={() => {
            if (result?.query !== query.trim()) return;
            setSelection({ source: value, record });
            setVisible(false);
          }}
          className={"flex min-h-11 cursor-pointer flex-col justify-center rounded-field px-3 py-2 text-sm text-ink data-[selected=true]:bg-tint " + FOCUS}>
          <span className="font-bold">{record.label}</span>
          {record.detail ? <span className="text-ink-soft">{record.detail}</span> : null}
        </CommandItem>)}
      </CommandList>}
    {addNew ? <Link href={addNew.href} onClick={() => setVisible(false)}
      className={"mt-2 flex min-h-11 items-center gap-2 border-t border-line pt-2 text-sm font-bold text-primary " + FOCUS}>
      <Icon name="plus" /> {addNew.label}
    </Link> : null}
  </Command>;
  const trigger = <button type="button" id={id} aria-label={choice ? `${label}: ${choice.label}` : `Choose ${label.toLowerCase()}`} aria-haspopup="dialog" aria-expanded={open}
    onClick={() => setVisible(true)} className={FIELD + " flex items-center justify-between gap-2 text-left"}>
    <span className={choice ? "truncate" : "truncate text-ink-soft"}>{choice?.label ?? "Choose " + label.toLowerCase()}</span>
    <Icon name="down" />
  </button>;
  return <div className="min-w-0">
    <label htmlFor={id} className={LABEL}>{label}</label>
    <input type="hidden" name={name} value={choice?.id ?? ""} readOnly />
    {desktop ? <Popover.Root open={open} onOpenChange={setVisible}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal><Popover.Content aria-label={"Choose " + label} sideOffset={6} collisionPadding={16}
        className="z-50 w-[360px] max-w-[90vw] rounded-card border border-line bg-surface p-3 shadow-raise">
        {body}
      </Popover.Content></Popover.Portal>
    </Popover.Root> : <>
      {trigger}
      <Sheet open={open} onOpenChange={setVisible} title={"Choose " + label}>{body}</Sheet>
    </>}
  </div>;
}

export function Switch({ label, checked, action, fields = {}, info, onText, offText }: {
  label: string; checked: boolean;
  action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
  fields?: Record<string, string>; info?: GlossaryKey; onText: string; offText: string;
}) {
  const offline = useDeskOffline();
  const [saving, setSaving] = useState(false);
  const wrapped = useCallback(async (form: FormData) => {
    setSaving(true);
    try { return await action(form); }
    finally { setSaving(false); }
  }, [action]);
  const optimistic = useOptimisticAction<boolean, boolean>([checked], (_previous, next) => [next], wrapped);
  const current = optimistic.items[0];
  const toggle = () => {
    if (saving || offline) return;
    const next = !current;
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set("checked", String(next));
    optimistic.run(next, form, { success: next ? onText : offText });
  };
  return <div className="flex min-h-11 items-center justify-between gap-3">
    <div className="flex min-w-0 items-center gap-2">
      <span id={label.replace(/\W+/g, "-").toLowerCase()} className="text-[15px] font-bold text-ink">{label}</span>
      {info ? <InfoTip term={info} /> : null}
    </div>
    <button type="button" role="switch" aria-label={label} aria-checked={current} disabled={saving || offline}
      aria-describedby={offline ? "offline-switch-reason" : undefined} onClick={toggle}
      className={"relative flex min-h-11 min-w-14 items-center rounded-full px-1 disabled:opacity-60 " + FOCUS}>
      <span className={"relative block h-7 w-12 rounded-full transition-colors motion-reduce:transition-none " + (current ? "bg-primary" : "bg-line-strong")}>
        <span className={"absolute top-1 h-5 w-5 rounded-full bg-surface shadow-sm transition-transform motion-reduce:transition-none " + (current ? "translate-x-6" : "translate-x-1")} />
      </span>
    </button>
    {offline ? <span id="offline-switch-reason" className="sr-only">Offline. Changes are paused.</span> : null}
  </div>;
}
