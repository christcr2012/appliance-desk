"use client";
// AR-8 kit (SETTINGS spec sections 2 + 3): SettingsLayout — the settings
// frame. Desktop: a sticky 260px left column with the "Settings" header,
// the search field and the section list (attention dot when a section has
// a row waiting). Phone: a back row to the section list, which is the
// settings home itself (SettingsIndex). Search filters the catalog's
// labels and keywords; picking a result goes to its row.

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon, type IconName } from "./icons";
import { ScreenHeader } from "./screen-header";
import { ALL_SETTING_ROWS, SETTINGS_SECTIONS_V2, type SettingsSectionId } from "@/domains/settings/catalog";

const SUBPAGE_SECTION: [prefix: string, section: SettingsSectionId][] = [
  ["/desk/settings/decisions", "decisions"],
  ["/desk/settings/goals", "business"],
  ["/desk/settings/price-changes", "prices"],
  ["/desk/settings/approvals", "team"],
  ["/desk/settings/permissions", "team"],
  ["/desk/settings/telecom", "messages"],
  ["/desk/settings/payment-links", "messages"],
  ["/desk/settings/lead-response", "rentals"],
  ["/desk/settings/unsigned-follow-up", "rentals"],
  ["/desk/settings/rental-endings", "rentals"],
  ["/desk/settings/history", "advanced"],
  ["/desk/settings/switches", "advanced"],
  ["/desk/settings/features", "advanced"],
  ["/desk/settings/preview-storage", "advanced"],
  ["/desk/settings/website", "website"],
  ["/desk/settings/feedback", "messages"],
];

type SearchHit = { key: string; label: string; section: SettingsSectionId; sectionLabel: string };

function searchCatalog(q: string): SearchHit[] {
  const needle = q.trim().toLocaleLowerCase();
  if (!needle) return [];
  const sectionLabel = new Map(SETTINGS_SECTIONS_V2.map((s) => [s.id, s.label]));
  return ALL_SETTING_ROWS.filter(
    (r) =>
      r.label.toLocaleLowerCase().includes(needle) ||
      r.keywords.some((k) => k.toLocaleLowerCase().includes(needle)) ||
      (sectionLabel.get(r.section) ?? "").toLocaleLowerCase().includes(needle),
  ).map((r) => ({ key: r.key, label: r.label, section: r.section, sectionLabel: sectionLabel.get(r.section) ?? "" }));
}

function SearchResults({ q }: { q: string }) {
  const hits = searchCatalog(q);
  if (!q.trim()) return null;
  if (hits.length === 0) {
    return <p className="px-1 py-3 text-sm text-ink-soft">No setting called “{q.trim()}”. Try another word.</p>;
  }
  return (
    <ul className="space-y-1">
      {hits.map((h) => (
        <li key={h.key}>
          <Link
            href={`/desk/settings?section=${h.section}#row-${h.key}`}
            className="block rounded-field px-2 py-2 text-sm hover:bg-tint"
          >
            <span className="font-medium text-ink">{h.label}</span>
            <span className="block text-xs text-ink-soft">{h.sectionLabel}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SectionNav({ current, attention }: { current?: SettingsSectionId; attention: SettingsSectionId[] }) {
  return (
    <ul className="space-y-1">
      {SETTINGS_SECTIONS_V2.map((s) => (
        <li key={s.id}>
          <Link
            href={`/desk/settings?section=${s.id}`}
            aria-current={current === s.id ? "page" : undefined}
            className={`flex min-h-11 items-center gap-2 rounded-field px-2 py-2 text-sm ${
              current === s.id ? "bg-primary-soft font-bold text-ink" : "text-ink hover:bg-tint"
            }`}
          >
            <Icon name={s.icon as IconName} />
            <span className="flex-1">{s.label}</span>
            {attention.includes(s.id) && (
              <span aria-label="Has a setting waiting" className="h-2 w-2 rounded-full bg-attention" />
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SettingsLayout({ attention, children }: { attention: SettingsSectionId[]; children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const current = useMemo<SettingsSectionId | undefined>(() => {
    const fromQuery = searchParams.get("section");
    if (pathname === "/desk/settings" && fromQuery) {
      const hit = SETTINGS_SECTIONS_V2.find((s) => s.id === fromQuery);
      if (hit) return hit.id;
    }
    return SUBPAGE_SECTION.find(([prefix]) => pathname.startsWith(prefix))?.[1];
  }, [pathname, searchParams]);

  return (
    <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8">
      <div className="lg:sticky lg:top-4 lg:self-start">
        <div className="hidden lg:block">
          <ScreenHeader title="Settings" />
          <label className="mb-3 block">
            <span className="sr-only">Search settings</span>
            <input
              data-kit-search
              type="search"
              placeholder="Search settings"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-ink"
            />
          </label>
          {query.trim() ? <SearchResults q={query} /> : <SectionNav current={current} attention={attention} />}
        </div>
        {pathname !== "/desk/settings" || searchParams.get("section") ? (
          <Link href="/desk/settings" className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-ink lg:hidden">
            <Icon name="back" /> Settings
          </Link>
        ) : null}
      </div>
      <div className="max-w-[760px]">
        {current ? (
          <div className="lg:hidden">
            <ScreenHeader title={SETTINGS_SECTIONS_V2.find((s) => s.id === current)!.label} />
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** The phone settings home: search + the section list as large rows (SETTINGS spec section 3). */
export function SettingsIndex({ attention, role }: { attention: SettingsSectionId[]; role: "OWNER" | "ADMIN" }) {
  const [query, setQuery] = useState("");
  return (
    <div>
      <ScreenHeader title="Settings" />
      <label className="mb-3 block lg:hidden">
        <span className="sr-only">Search settings</span>
        <input
          data-kit-search
          type="search"
          placeholder="Search settings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-ink"
        />
      </label>
      <div className="lg:hidden">{query.trim() ? <SearchResults q={query} /> : <SectionNav attention={attention} />}</div>
      <DesktopIndexRedirect role={role} />
    </div>
  );
}

/** On a wide screen the settings home goes straight to the first section (SETTINGS spec section 2). */
function DesktopIndexRedirect({ role }: { role: "OWNER" | "ADMIN" }) {
  const router = useRouter();
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      router.replace(`/desk/settings?section=${role === "OWNER" ? "decisions" : "business"}`);
    }
  }, [role, router]);
  return null;
}
