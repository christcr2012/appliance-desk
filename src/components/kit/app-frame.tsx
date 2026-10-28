"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSyncExternalStore, ViewTransition, type ReactNode } from "react";
import { Icon } from "./icons";
import { OfflineBar } from "./offline-bar";
import { RememberList, followRememberedClick } from "./remember-list";
import { CommandBar } from "./command-bar";
import { InboxCountPill } from "./inbox-count-beacon";
import { ProfileMenu, type ProfileUser } from "./profile-menu";
import { activeArea, areaHome, type Area, type ProfileLink } from "@/lib/desk-areas";
import type { FeatureKey } from "@/domains/features/registry";
import type { HelpGuide } from "@/lib/help-guides";

export type AppFrameProps = {
  areas: Area[];
  profileLinks: ProfileLink[];
  user: ProfileUser;
  jobRoleScreens: readonly string[] | null;
  shown: FeatureKey[];
  helpGuides: HelpGuide[];
  children: ReactNode;
};

const SIDEBAR_EVENT = "desk:sidebar";
function subscribeSidebar(callback: () => void) {
  window.addEventListener(SIDEBAR_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(SIDEBAR_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
function sidebarSnapshot(): boolean {
  try { return localStorage.getItem("desk.sidebar") === "collapsed"; }
  catch { return false; }
}
function saveSidebarState(collapsed: boolean) {
  try {
    localStorage.setItem("desk.sidebar", collapsed ? "collapsed" : "expanded");
    window.dispatchEvent(new Event(SIDEBAR_EVENT));
  } catch { /* persist only where browser storage is available */ }
}

function AreaLink({ area, active, collapsed, mobile = false }: {
  area: Area; active: boolean; collapsed: boolean; mobile?: boolean;
}) {
  const router = useRouter();
  const target = areaHome(area);
  return <Link
    href={target}
    aria-current={active ? "page" : undefined}
    title={collapsed ? area.label : undefined}
    onClick={event => followRememberedClick(event, target, next => router.push(next))}
    className={mobile
      ? `relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 border-t-[3px] px-1 text-[11px] font-semibold ${active ? "border-primary text-primary" : "border-transparent text-ink-soft"}`
      : `flex min-h-11 items-center gap-3 rounded-field px-3 text-sm font-semibold ${active ? "bg-nav-current-bg text-nav-current-ink" : "hover:bg-white/10"}`}>
    <Icon name={area.icon} size={mobile ? 24 : 20} />
    <span className={collapsed && !mobile ? "sr-only" : "truncate"}>{area.label}</span>
    {area.key === "today" && <InboxCountPill />}
  </Link>;
}

export function Sidebar({ areas, active, profileLinks, user, collapsed, onToggle }: {
  areas: Area[]; active: string | null; profileLinks: ProfileLink[]; user: ProfileUser;
  collapsed: boolean; onToggle(): void;
}) {
  return <aside className={`fixed inset-y-0 left-0 z-30 hidden flex-col bg-nav-bg text-nav-ink lg:flex print:hidden ${collapsed ? "w-[72px]" : "w-[248px]"}`}>
    <Link href="/desk/today" className="flex min-h-16 items-center gap-3 px-4" title="Appliance Desk">
      <Image src="/brand/badge.svg" alt="" width={32} height={32} className="h-8 w-8 shrink-0" />
      {!collapsed && <span className="truncate font-bold">Appliance Desk</span>}
    </Link>
    <nav aria-label="Areas" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-4">
      {areas.map(area => <AreaLink key={area.key} area={area} active={area.key === active} collapsed={collapsed} />)}
    </nav>
    <div className="space-y-2 border-t border-white/20 p-2">
      <button type="button" onClick={onToggle} aria-label={collapsed ? "Expand menu" : "Collapse menu"}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-field hover:bg-white/10">
        <Icon name="collapse" />
        {!collapsed && <span className="text-sm">Collapse menu</span>}
      </button>
      <ProfileMenu user={user} links={profileLinks} />
    </div>
  </aside>;
}

export function BottomBar({ areas, active }: { areas: Area[]; active: string | null }) {
  return <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden"
    style={{ gridTemplateColumns: `repeat(${areas.length}, minmax(0, 1fr))` }}>
    {areas.map(area => <AreaLink key={area.key} area={area} active={area.key === active} collapsed={false} mobile />)}
  </nav>;
}

export function TopBar({ areas, active, profileLinks, user, jobRoleScreens, shown, helpGuides }: {
  areas: Area[]; active: string | null; profileLinks: ProfileLink[]; user: ProfileUser;
  jobRoleScreens: readonly string[] | null; shown: FeatureKey[]; helpGuides: HelpGuide[];
}) {
  const title = areas.find(a => a.key === active)?.label ?? "Appliance Desk";
  return <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b border-line bg-surface px-4 pt-[env(safe-area-inset-top)] print:hidden">
    <span className="min-w-0 truncate text-sm font-bold text-ink">{title}</span>
    <div className="flex shrink-0 items-center gap-3">
      <CommandBar areas={areas} role={user.role} screens={jobRoleScreens} profile={profileLinks}
        shown={shown} guides={helpGuides} />
      <div className="lg:hidden">
        <ProfileMenu user={user} links={profileLinks} mobile />
      </div>
    </div>
  </header>;
}

export function AppFrame({ areas, profileLinks, user, jobRoleScreens, shown, helpGuides, children }: AppFrameProps) {
  const pathname = usePathname() ?? "/desk/today";
  const search = useSearchParams();
  const active = activeArea(pathname, new URLSearchParams(search?.toString() ?? ""), areas)?.area ?? null;
  const collapsed = useSyncExternalStore(subscribeSidebar, sidebarSnapshot, () => false);
  return <div className={`desk-app min-h-screen w-full min-w-0 max-w-full bg-canvas print:pl-0 ${collapsed ? "lg:pl-[72px]" : "lg:pl-[248px]"}`}>
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-field focus:bg-primary focus:p-3 focus:text-on-primary">
      Skip to content
    </a>
    <Sidebar areas={areas} active={active} profileLinks={profileLinks} user={user} collapsed={collapsed}
      onToggle={() => saveSidebarState(!collapsed)} />
    <RememberList />
    <div className="min-w-0 w-full max-w-full">
      <OfflineBar />
      <TopBar areas={areas} active={active} profileLinks={profileLinks} user={user}
        jobRoleScreens={jobRoleScreens} shown={shown} helpGuides={helpGuides} />
      <main id="main" tabIndex={-1}
        className="mx-auto min-w-0 max-w-screen-2xl overscroll-y-contain p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-6 lg:p-8 lg:pb-8 print:max-w-none print:p-0">
        <ViewTransition key={pathname.split("/")[2] ?? "desk"} default="none"
          enter="desk-area-enter" exit="desk-area-exit">
          <div>{children}</div>
        </ViewTransition>
      </main>
    </div>
    <BottomBar areas={areas} active={active} />
  </div>;
}
