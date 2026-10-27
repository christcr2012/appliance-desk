"use client";
// AR-0 kit 4.4: search, Filter, Sort and Views for a list. The URL is the state: every control writes search params
// and drops `cursor` so the list starts again from the top.
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import { Icon } from "./icons";
import { runFormAction } from "./run-action";
import { Sheet } from "./sheet";
import type { FormAction } from "./types";
import { DESKTOP_QUERY, useMediaQuery } from "./use-media-query";

export type FilterOption = { value: string; label: string };
export type FilterDef =
  | { kind: "select"; param: string; label: string; options: FilterOption[] }
  | { kind: "multi"; param: string; label: string; options: FilterOption[] } // comma-joined
  | { kind: "date"; param: string; label: string } // presets: this-month, last-month, last-30, custom (from,to)
  | { kind: "toggle"; param: string; label: string };
export type SortDef = { value: string; label: string };
export type ViewDef = { id: string; label: string; href: string; builtIn: boolean };

export type ToolbarProps = {
  search?: { param?: string; placeholder: string; label: string };
  filters?: FilterDef[];
  sorts?: SortDef[];
  currentSort?: string;
  views?: ViewDef[];
  currentViewId?: string;
  /** "Save this view": a server action (O-7 saved views) that receives `label` and `filters` (JSON of the URL params). */
  saveViewAction?: FormAction;
};

export const SEARCH_DEBOUNCE_MS = 250;
export const DATE_PRESETS: FilterOption[] = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "last-30", label: "Last 30 days" },
  { value: "custom", label: "Pick dates" },
];
/** Params that describe where you are in a list, not what it shows; never saved in a view or counted as filters. */
const POSITION_PARAMS = ["cursor", "open", "view"];

type Values = Record<string, string>;

/** The params each filter owns (a custom date range also owns `from` and `to`). */
function ownedParams(def: FilterDef): string[] {
  return def.kind === "date" ? [def.param, "from", "to"] : [def.param];
}

export function readFilterValues(filters: FilterDef[], params: URLSearchParams): Values {
  const values: Values = {};
  for (const def of filters) for (const name of ownedParams(def)) values[name] = params.get(name) ?? "";
  return values;
}

export function activeFilterCount(filters: FilterDef[], params: URLSearchParams): number {
  return filters.filter((def) => (params.get(def.param) ?? "") !== "").length;
}

/** The URL after applying `values` for these filters: empty values are removed, as is `cursor`. */
export function applyFilters(pathname: string, search: string, filters: FilterDef[], values: Values): string {
  const params = new URLSearchParams(search);
  for (const def of filters) {
    for (const name of ownedParams(def)) {
      const value = values[name] ?? "";
      const keep = value !== "" && (name === def.param || values[def.param] === "custom");
      if (keep) params.set(name, value);
      else params.delete(name);
    }
  }
  params.delete("cursor");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function withParam(pathname: string, search: string, name: string, value: string): string {
  const params = new URLSearchParams(search);
  if (value) params.set(name, value);
  else params.delete(name);
  params.delete("cursor");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function valueLabel(def: FilterDef, values: Values): string {
  const value = values[def.param] ?? "";
  if (def.kind === "toggle") return "Yes";
  if (def.kind === "date") {
    if (value === "custom") return [values.from, values.to].filter(Boolean).join(" to ") || "Pick dates";
    return DATE_PRESETS.find((preset) => preset.value === value)?.label ?? value;
  }
  const labels = value.split(",").map((part) => def.options.find((option) => option.value === part)?.label ?? part);
  return labels.join(", ");
}

const CONTROL =
  "inline-flex min-h-11 items-center gap-2 rounded-field border border-line-strong bg-surface px-3 text-[15px] font-bold text-ink hover:bg-tint lg:h-10 lg:min-h-0";
const FIELD = "mt-1 block min-h-11 w-full rounded-field border border-line-strong bg-surface px-3 text-[15px] text-ink";

function SearchBox({ param, placeholder, label }: { param: string; placeholder: string; label: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  const [value, setValue] = useState(searchParams?.get(param) ?? "");
  const [pending, startTransition] = useTransition();
  const id = useId();
  const latest = useRef({ pathname, search });
  useEffect(() => {
    latest.current = { pathname, search };
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const { pathname: path, search: query } = latest.current;
      if ((new URLSearchParams(query).get(param) ?? "") === value.trim()) return;
      startTransition(() => router.replace(withParam(path, query, param, value.trim()), { scroll: false }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, param, router]);
  return (
    <div className="relative min-w-0 flex-1 lg:max-w-[360px]">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft" />
      <input
        id={id}
        data-kit-search
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        className="min-h-11 w-full rounded-field border border-line-strong bg-surface pr-10 pl-10 text-[15px] text-ink placeholder:text-ink-soft lg:h-10 lg:min-h-0"
      />
      {pending ? (
        <span className="absolute top-1/2 right-3 -translate-y-1/2" data-testid="search-pending">
          <span className="block h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-primary motion-reduce:animate-none" />
          <span className="sr-only">Searching…</span>
        </span>
      ) : null}
    </div>
  );
}

function FilterControls({ filters, values, onChange }: { filters: FilterDef[]; values: Values; onChange: (next: Values) => void }) {
  const set = (name: string, value: string) => onChange({ ...values, [name]: value });
  return (
    <div className="flex flex-col gap-4">
      {filters.map((def) => {
        const value = values[def.param] ?? "";
        if (def.kind === "select") {
          return (
            <label key={def.param} className="block text-sm font-bold text-ink">
              {def.label}
              <select className={FIELD} value={value} onChange={(event) => set(def.param, event.target.value)}>
                <option value="">Any</option>
                {def.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        if (def.kind === "multi") {
          const chosen = value ? value.split(",") : [];
          return (
            <fieldset key={def.param}>
              <legend className="text-sm font-bold text-ink">{def.label}</legend>
              <div className="mt-1 flex flex-col">
                {def.options.map((option) => (
                  <label key={option.value} className="flex min-h-11 items-center gap-3 text-[15px] text-ink">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-primary"
                      checked={chosen.includes(option.value)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...chosen, option.value]
                          : chosen.filter((part) => part !== option.value);
                        set(def.param, def.options.map((o) => o.value).filter((v) => next.includes(v)).join(","));
                      }}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        }
        if (def.kind === "date") {
          return (
            <fieldset key={def.param}>
              <legend className="text-sm font-bold text-ink">{def.label}</legend>
              <select
                aria-label={def.label}
                className={FIELD}
                value={value}
                onChange={(event) => set(def.param, event.target.value)}
              >
                <option value="">Any time</option>
                {DATE_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
              {value === "custom" ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="block text-sm font-bold text-ink">
                    From
                    <input type="date" className={FIELD} value={values.from ?? ""} onChange={(event) => set("from", event.target.value)} />
                  </label>
                  <label className="block text-sm font-bold text-ink">
                    To
                    <input type="date" className={FIELD} value={values.to ?? ""} onChange={(event) => set("to", event.target.value)} />
                  </label>
                </div>
              ) : null}
            </fieldset>
          );
        }
        return (
          <label key={def.param} className="flex min-h-11 items-center gap-3 text-[15px] font-bold text-ink">
            <input
              type="checkbox"
              className="h-5 w-5 accent-primary"
              checked={value === "1"}
              onChange={(event) => set(def.param, event.target.checked ? "1" : "")}
            />
            {def.label}
          </label>
        );
      })}
    </div>
  );
}

function FilterButton({ filters }: { filters: FilterDef[] }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const search = useSearchParams()?.toString() ?? "";
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Values>({});
  useLayoutEffect(() => () => setOpen(false), []);
  const count = activeFilterCount(filters, new URLSearchParams(search));
  const label = count > 0 ? `Filter · ${count}` : "Filter";
  const openWith = (next: boolean) => {
    if (next) setDraft(readFilterValues(filters, new URLSearchParams(search)));
    setOpen(next);
  };
  const apply = () => {
    setOpen(false);
    router.replace(applyFilters(pathname, search, filters, draft), { scroll: false });
  };
  const clear = () => setDraft(Object.fromEntries(Object.keys(draft).map((name) => [name, ""])));
  const buttons = (
    <div className="flex gap-2">
      <button type="button" onClick={clear} className={`${CONTROL} flex-1 justify-center`}>
        Clear all
      </button>
      <button
        type="button"
        onClick={apply}
        className="inline-flex min-h-11 flex-1 items-center justify-center rounded-field bg-primary px-4 text-[15px] font-bold text-on-primary lg:h-10 lg:min-h-0"
      >
        Show results
      </button>
    </div>
  );
  const trigger = (
    <>
      <Icon name="filter" />
      <span>{label}</span>
    </>
  );

  if (desktop) {
    return (
      <Popover.Root open={open} onOpenChange={openWith}>
        <Popover.Trigger className={CONTROL}>{trigger}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            aria-label="Filter"
            align="start"
            sideOffset={6}
            collisionPadding={16}
            className="z-50 flex w-[360px] flex-col gap-4 rounded-card border border-line bg-surface p-4 text-ink shadow-raise"
          >
            <FilterControls filters={filters} values={draft} onChange={setDraft} />
            {buttons}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }
  return (
    <>
      <button type="button" className={CONTROL} onClick={() => openWith(true)} aria-haspopup="dialog">
        {trigger}
      </button>
      <Sheet open={open} onOpenChange={openWith} title="Filter" footer={buttons}>
        <FilterControls filters={filters} values={draft} onChange={setDraft} />
      </Sheet>
    </>
  );
}

function SortMenu({ sorts, currentSort }: { sorts: SortDef[]; currentSort?: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const search = useSearchParams()?.toString() ?? "";
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => () => setOpen(false), []);
  const current = currentSort ?? sorts[0]?.value ?? "";
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger className={CONTROL}>
        <Icon name="sort" />
        <span>Sort</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} collisionPadding={16} className="z-50 min-w-[220px] rounded-card border border-line bg-surface p-1.5 text-ink shadow-raise">
          <DropdownMenu.RadioGroup
            value={current}
            onValueChange={(value) => router.replace(withParam(pathname, search, "sort", value), { scroll: false })}
          >
            {sorts.map((sort) => (
              <DropdownMenu.RadioItem
                key={sort.value}
                value={sort.value}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-field px-3 text-[15px] font-semibold outline-none data-[highlighted]:bg-tint lg:min-h-10"
              >
                <span className="inline-flex w-5 justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Icon name="check" />
                  </DropdownMenu.ItemIndicator>
                </span>
                {sort.label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ViewsMenu({ views, currentViewId, saveViewAction }: { views: ViewDef[]; currentViewId?: string; saveViewAction?: FormAction }) {
  const search = useSearchParams()?.toString() ?? "";
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  useLayoutEffect(() => () => setOpen(false), []);
  const ordered = [...views.filter((view) => view.builtIn), ...views.filter((view) => !view.builtIn)];
  const currentLabel = views.find((view) => view.id === currentViewId)?.label;
  const save = () => {
    if (!saveViewAction || !name.trim()) return;
    const params = new URLSearchParams(search);
    for (const position of POSITION_PARAMS) params.delete(position);
    const data = new FormData();
    data.set("label", name.trim());
    data.set("filters", JSON.stringify(Object.fromEntries(params.entries())));
    startTransition(async () => {
      const ok = await runFormAction({ kind: "form", label: "Save this view", action: saveViewAction, successMessage: `Saved view "${name.trim()}"` }, data);
      if (ok) {
        setSaving(false);
        setName("");
      }
    });
  };
  return (
    <>
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger className={CONTROL}>
          <span>{currentLabel ? `View: ${currentLabel}` : "Views"}</span>
          <Icon name="down" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} collisionPadding={16} className="z-50 min-w-[240px] rounded-card border border-line bg-surface p-1.5 text-ink shadow-raise">
            {ordered.map((view) => (
              <DropdownMenu.Item key={view.id} asChild className="flex min-h-11 items-center gap-2 rounded-field px-3 text-[15px] font-semibold outline-none data-[highlighted]:bg-tint lg:min-h-10">
                <Link href={view.href} aria-current={view.id === currentViewId ? "true" : undefined}>
                  <span className="inline-flex w-5 justify-center">{view.id === currentViewId ? <Icon name="check" /> : null}</span>
                  {view.label}
                </Link>
              </DropdownMenu.Item>
            ))}
            {saveViewAction ? (
              <>
                {ordered.length > 0 ? <DropdownMenu.Separator className="my-1 h-px bg-line" /> : null}
                <DropdownMenu.Item
                  onSelect={() => setSaving(true)}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-field px-3 text-[15px] font-bold outline-none data-[highlighted]:bg-tint lg:min-h-10"
                >
                  <span className="inline-flex w-5 justify-center">
                    <Icon name="plus" />
                  </span>
                  Save this view
                </DropdownMenu.Item>
              </>
            ) : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {saveViewAction ? (
        <Sheet
          open={saving}
          onOpenChange={setSaving}
          title="Save this view"
          footer={
            <button
              type="button"
              onClick={save}
              disabled={pending || !name.trim()}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-field bg-primary px-4 text-[15px] font-bold text-on-primary disabled:opacity-60 lg:h-10 lg:min-h-0"
            >
              {pending ? "Saving…" : "Save view"}
            </button>
          }
        >
          <label className="block text-sm font-bold text-ink">
            Name
            <input className={FIELD} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
          </label>
        </Sheet>
      ) : null}
    </>
  );
}

/** One removable chip per active filter, plus "Clear all". Shown under the toolbar. */
export function ActiveFilterChips({ filters }: { filters: FilterDef[] }) {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams()?.toString() ?? "";
  const params = new URLSearchParams(search);
  const values = readFilterValues(filters, params);
  const active = filters.filter((def) => values[def.param] !== "");
  if (active.length === 0) return null;
  const cleared = (defs: FilterDef[]) =>
    applyFilters(pathname, search, defs, Object.fromEntries(defs.flatMap((def) => ownedParams(def).map((name) => [name, ""]))));
  return (
    <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2 pt-2">
      {active.map((def) => (
        <li key={def.param}>
          <Link
            href={cleared([def])}
            scroll={false}
            aria-label={`Remove filter ${def.label}: ${valueLabel(def, values)}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-tint lg:min-h-9"
          >
            {def.label}: {valueLabel(def, values)}
            <Icon name="close" className="h-4 w-4" />
          </Link>
        </li>
      ))}
      <li>
        <Link href={cleared(filters)} scroll={false} className="inline-flex min-h-11 items-center px-2 text-sm font-bold text-primary underline lg:min-h-9">
          Clear all
        </Link>
      </li>
    </ul>
  );
}

export function Toolbar({ search, filters, sorts, currentSort, views, currentViewId, saveViewAction }: ToolbarProps) {
  const hasFilters = (filters?.length ?? 0) > 0;
  return (
    <div className="pb-3">
      <div role="search" className="flex flex-col gap-2 lg:flex-row lg:items-center">
        {search ? <SearchBox param={search.param ?? "q"} placeholder={search.placeholder} label={search.label} /> : null}
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          {hasFilters ? <FilterButton filters={filters!} /> : null}
          {sorts && sorts.length > 0 ? <SortMenu sorts={sorts} currentSort={currentSort} /> : null}
          {(views && views.length > 0) || saveViewAction ? (
            <ViewsMenu views={views ?? []} currentViewId={currentViewId} saveViewAction={saveViewAction} />
          ) : null}
        </div>
      </div>
      {hasFilters ? <ActiveFilterChips filters={filters!} /> : null}
    </div>
  );
}
