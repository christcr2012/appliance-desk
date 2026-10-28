/** @deprecated AR-1: new pages use DESK_AREAS and AreaLayout. These exports remain through AR-10. */
import { DESK_AREAS, visibleAreas } from "./desk-areas";
import type { Restriction } from "./desk-areas";

export type DeskSectionKey = "schedule" | "equipment" | "money";
export type DeskSectionTab = { href: string; label: string; restriction?: Restriction };
const sectionKeys: DeskSectionKey[] = ["schedule", "equipment", "money"];

export const DESK_SECTIONS: Record<DeskSectionKey, { label: string; tabs: DeskSectionTab[] }> =
  Object.fromEntries(sectionKeys.map(key => {
    const area = DESK_AREAS.find(a => a.key === key)!;
    return [key, { label: area.label, tabs: area.tabs.map(tab => ({
      href: tab.href, label: tab.label, restriction: tab.restriction,
    })) }];
  })) as Record<DeskSectionKey, { label: string; tabs: DeskSectionTab[] }>;

export function deskSectionTabs(section: DeskSectionKey, role?: string): DeskSectionTab[] {
  const area = visibleAreas(role, null).find(a => a.key === section);
  return area?.tabs.map(tab => ({ href: tab.href, label: tab.label, restriction: tab.restriction })) ?? [];
}
export function activeSectionTab(pathname: string, tabs: DeskSectionTab[]): string | null {
  return tabs.filter(tab => {
    const path = tab.href.split(/[?#]/)[0]!;
    return pathname === path || pathname.startsWith(path + "/");
  }).sort((a,b) => b.href.length - a.href.length)[0]?.href ?? null;
}
