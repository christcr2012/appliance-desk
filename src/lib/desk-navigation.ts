import { DESK_AREAS, visibleAreas, visibleProfileLinks } from "./desk-areas";
import type { FeatureKey } from "@/domains/features/registry";

export type DeskNavGroup = { label: string; links: { href: string; label: string }[] };
export type DeskMoreLink = { href: string; label: string; detail: string };

const pathOf = (href: string) => href.split(/[?#]/)[0] ?? href;
const within = (path: string, root: string) => path === root || path.startsWith(root + "/");

/**
 * @deprecated AR-1: use DESK_AREAS/visibleAreas directly.
 * Kept temporarily for older widgets and tests until AR-10.
 * Aliases are derived from the same source as activeArea and do not create access.
 */
export const DESK_NAV_ALIASES: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const area of DESK_AREAS) for (const tab of area.tabs) {
    if (tab.matches?.length) {
      const path = pathOf(tab.href);
      out[path] = [...new Set([...(out[path] ?? []), ...tab.matches])];
    }
  }
  // Existing accountant Compliance screen remains under Taxes without being a new area tab.
  out["/desk/sales-tax"] = [...new Set([...(out["/desk/sales-tax"] ?? []), "/desk/compliance"])];
  return out;
})();

/** @deprecated Use visibleProfileLinks. Still filters role and job role before serialization. */
export function deskMoreLinks(role?: string, jobRoleScreens: readonly string[] | null = null,
  _shown?: ReadonlySet<FeatureKey>): DeskMoreLink[] {
  return visibleProfileLinks(role, jobRoleScreens).map(link => ({
    ...link, detail: "Open " + link.label.toLocaleLowerCase() + ".",
  }));
}

/** @deprecated Use visibleAreas. The five area groups are now the only primary navigation. */
export function deskNavigation(role?: string, jobRoleScreens: readonly string[] | null = null,
  shown?: ReadonlySet<FeatureKey>): DeskNavGroup[] {
  return visibleAreas(role, jobRoleScreens, shown).map(area => ({
    label: area.label,
    links: area.tabs.map(tab => ({ href: tab.href, label: tab.label })),
  }));
}

/** @deprecated Use activeArea(pathname, searchParams, visibleAreas). */
export function activeDeskHref(pathname: string, groups: DeskNavGroup[]): string | undefined {
  return groups.flatMap(group => group.links)
    .flatMap(link => {
      const root = pathOf(link.href);
      return [root, ...(DESK_NAV_ALIASES[root] ?? [])]
        .filter(match => within(pathname, match))
        .map(match => ({ href: link.href, length: match.length }));
    }).sort((a, b) => b.length - a.length)[0]?.href;
}

/** @deprecated Use visibleAreas().map(area => ({label:area.label,href:areaHome(area)})). */
export function deskBottomTabLinks(
  _role: string, groups: DeskNavGroup[],
): { href: string; label: string }[] {
  return groups.flatMap(group => group.links[0]
    ? [{ href: group.links[0].href, label: group.label }] : []);
}
