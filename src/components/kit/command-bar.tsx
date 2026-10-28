"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import Link from "next/link";
import { Icon } from "./icons";
import { Sheet } from "./sheet";
import { commandLocalChoices, recentCommandChoices, type CommandChoice } from "@/lib/desk-command";
import type { Area, ProfileLink } from "@/lib/desk-areas";
import type { FeatureKey } from "@/domains/features/registry";
import { searchHelpGuides, type HelpGuide } from "@/lib/help-guides";
import { commandSearchAction } from "@/app/desk/command-actions";

const GROUPS: CommandChoice["group"][] = ["Go to", "Do", "Records", "Help", "Recent"];
const SAFE_RECENT = ["customers", "inventory", "leads", "purchases", "suppliers"];
function keepRecent(item: CommandChoice) {
  if (item.group !== "Records" || !item.id) return;
  try {
    const old: unknown = JSON.parse(localStorage.getItem("desk.recent") ?? "[]");
    const rows: CommandChoice[] = Array.isArray(old) ? old : [];
    localStorage.setItem("desk.recent", JSON.stringify([
      { id: item.id, label: item.label, href: item.href },
      ...rows.filter(r => r.href !== item.href),
    ].slice(0, 5)));
  } catch { /* private storage */ }
}
export function CommandBar({ role, screens, areas, profile, guides, shown }: {
  role: string; screens: readonly string[] | null; areas: Area[];
  profile: ProfileLink[]; guides: HelpGuide[]; shown: FeatureKey[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommandChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<CommandChoice[]>([]);
  const [help, setHelp] = useState<HelpGuide | null>(null);
  const request = useRef(0);
  const shownSet = useMemo(() => new Set(shown), [shown]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setOpen(v => !v);
      }
    };
    const openFromShortcut = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("desk:open-command", openFromShortcut);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("desk:open-command", openFromShortcut);
    };
  }, []);
  useEffect(() => {
    if (!open) { setQuery(""); setResults([]); return; }
    try {
      const validPrefixes = new Set(
        SAFE_RECENT.filter(s => areas.some(a => a.tabs.some(t => t.href.startsWith("/desk/" + s))))
      );
      const stored = JSON.parse(localStorage.getItem("desk.recent") ?? "[]") as unknown;
      const allow = new Set([...validPrefixes].map(s => "/desk/" + s));
      setRecent(recentCommandChoices(stored, allow));
    } catch { setRecent([]); }
  }, [open, areas]);
  useEffect(() => {
    const q = query.trim();
    const seq = ++request.current;
    if (!open || q.length < 2) { setResults([]); setBusy(false); return; }
    setBusy(true);
    const timer = setTimeout(() => {
      commandSearchAction(q).then(items => {
        if (seq === request.current) setResults(items);
      }).catch(() => {
        if (seq === request.current) setResults([]);
      }).finally(() => { if (seq === request.current) setBusy(false); });
    }, 150);
    return () => clearTimeout(timer);
  }, [query, open]);

  const local = commandLocalChoices(query, role, screens, areas, profile, shownSet);
  const guidesShown = query.trim().length >= 2 ?
    searchHelpGuides(guides, query).slice(0, 3).map((g): CommandChoice => ({
      group: "Help", label: g.question, href: g.href, id: g.id,
    })) : [];
  const entries = [
    ...local,
    ...results,
    ...guidesShown,
    ...(query ? [] : recent),
  ];
  function pick(item: CommandChoice, newTab = false) {
    if (item.group === "Help") {
      const guide = guides.find(g => g.id === item.id);
      setOpen(false);
      if (guide) setHelp(guide);
      return;
    }
    keepRecent(item); setOpen(false);
    if (newTab) window.open(item.href, "_blank", "noopener,noreferrer");
    else router.push(item.href);
  }
  return <>
    <button type="button" onClick={() => setOpen(true)}
      aria-label="Search or jump to anything"
      aria-keyshortcuts="Control+K Meta+K"
      className="flex min-h-11 items-center gap-2 rounded-field border border-line bg-surface px-3 text-left text-sm text-ink-soft hover:bg-tint lg:w-[360px]">
      <Icon name="search" /> <span className="hidden min-w-0 flex-1 truncate lg:inline">Search or jump to anything…</span>
      <kbd className="hidden rounded bg-tint px-2 py-1 text-xs lg:inline">Ctrl K</kbd>
    </button>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/45" />
        <Dialog.Content aria-describedby={undefined}
          className="fixed inset-x-0 top-0 z-50 mx-auto h-dvh overflow-hidden border border-line bg-surface text-ink shadow-raise sm:top-[15vh] sm:h-auto sm:max-h-[75dvh] sm:w-[640px] sm:rounded-card">
          <Dialog.Title className="sr-only">Search or jump to anything</Dialog.Title>
          <Command shouldFilter={false} className="flex h-full max-h-[75dvh] flex-col">
            <div className="flex items-center gap-2 border-b border-line p-4">
              <Icon name="search" />
              <Command.Input autoFocus value={query} onValueChange={setQuery}
                placeholder="Search customers, appliances, bills… or type what you want to do"
                aria-label="Search the desk"
                className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none" />
              <Dialog.Close aria-label="Close search" className="min-h-11 min-w-11 rounded-field border border-line">Esc</Dialog.Close>
            </div>
            <Command.List className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Search results">
              {GROUPS.map(group => {
                const rows = entries.filter(r => r.group === group);
                return rows.length ? <Command.Group key={group} heading={group} className="mt-3 px-1 text-xs font-bold text-ink-soft">
                  {rows.map(item => <Command.Item key={group + item.href + item.label}
                    value={group + item.label + item.href} data-command-href={item.href}
                    onSelect={() => pick(item)}
                    onKeyDown={event => {
                      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault(); pick(item, true);
                      }
                    }}
                    className="flex min-h-11 cursor-pointer items-center rounded-field px-3 text-sm text-ink data-[selected=true]:bg-tint"
                  >
                    <span className="min-w-0 flex-1 truncate font-semibold">{item.label}</span>
                    {item.detail && <span className="ml-3 max-w-56 truncate text-xs text-ink-soft">{item.detail}</span>}
                  </Command.Item>)}
                </Command.Group> : null;
              })}
              {busy && <p role="status" className="p-3 text-sm">Searching…</p>}
              {!entries.length && !busy && query.trim().length >= 2 && <p className="p-3 text-sm">Nothing found. Try a name, phone number or appliance number.</p>}
              {query.trim().length >= 2 && <Command.Item value={"all:" + query}
                onSelect={() => { setOpen(false); router.push("/desk/search?q=" + encodeURIComponent(query.trim())); }}
                className="mt-3 min-h-11 cursor-pointer rounded-field px-3 py-2 text-sm font-bold text-primary data-[selected=true]:bg-tint">
                See all results for “{query.trim()}”
              </Command.Item>}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <Sheet open={!!help} onOpenChange={v => { if (!v) setHelp(null); }} title={help?.question ?? "Help"}>
      {help && <>
        <ol className="list-decimal space-y-3 pl-5 text-sm">{help.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
        <Link href={help.href} onClick={() => setHelp(null)} className="mt-4 inline-flex min-h-11 items-center rounded-field bg-primary px-4 font-bold text-on-primary">Open this screen</Link>
      </>}
    </Sheet>
  </>;
}
