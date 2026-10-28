// AR-1: the single, pure source of truth for five desk areas and profile destinations.
// Roles and job-role limits are applied before any navigation reaches the browser.
import type { IconName } from "@/components/kit/icons";
import { jobRoleAllowsPath } from "@/domains/team/job-role-rules";
import { isHrefHidden, type FeatureKey } from "@/domains/features/registry";

export type AreaKey = "today" | "customers" | "schedule" | "equipment" | "money";
export type Restriction = "finance" | "owner";
export type AreaTab = {
  key: string; href: string; label: string; restriction?: Restriction;
  matches?: string[]; query?: { param: string; values: string[] }; feature?: FeatureKey;
};
export type Area = { key: AreaKey; label: string; icon: IconName; tabs: AreaTab[] };
export type ProfileLink = { href: string; label: string; restriction?: Restriction };

export const DESK_AREAS: Area[] = [
  { key: "today", label: "Today", icon: "today", tabs: [
    { key: "inbox", label: "Inbox", href: "/desk/today", matches: ["/desk/dashboard", "/desk/control-center", "/desk/approvals", "/desk/notices", "/desk/launch"] },
    { key: "tasks", label: "Tasks", href: "/desk/tasks" },
  ] },
  { key: "customers", label: "Customers", icon: "customers", tabs: [
    { key: "leads", label: "Leads", href: "/desk/leads", restriction: "finance" },
    { key: "customers", label: "Customers", href: "/desk/customers", matches: ["/desk/growth"] },
    { key: "quotes", label: "Quotes", href: "/desk/estimates", restriction: "finance" },
    { key: "rentals", label: "Rentals", href: "/desk/agreements", matches: ["/desk/phone-orders"] },
    { key: "messages", label: "Messages", href: "/desk/communications" },
  ] },
  { key: "schedule", label: "Schedule", icon: "schedule", tabs: [
    { key: "board", label: "Board", href: "/desk/dispatch", feature: "team" },
    { key: "visits", label: "Visits", href: "/desk/jobs" },
    { key: "route", label: "My route", href: "/desk/driver" },
    { key: "repairs", label: "Repairs", href: "/desk/maintenance" },
  ] },
  { key: "equipment", label: "Equipment", icon: "equipment", tabs: [
    { key: "fleet", label: "Fleet", href: "/desk/inventory", matches: ["/desk/fleet"] },
    { key: "purchases", label: "Purchases", href: "/desk/purchases", restriction: "finance", matches: ["/desk/purchase-orders"] },
    { key: "parts", label: "Parts", href: "/desk/parts" },
    { key: "suppliers", label: "Suppliers", href: "/desk/suppliers", restriction: "finance" },
    { key: "retired", label: "Retired", href: "/desk/inventory/retired", restriction: "finance" },
  ] },
  { key: "money", label: "Money", icon: "money", tabs: [
    { key: "overview", label: "Overview", href: "/desk/revenue", restriction: "finance", matches: ["/desk/reports"] },
    { key: "bills", label: "Bills", href: "/desk/billing", restriction: "finance", matches: ["/desk/sales", "/desk/billing/customer"] },
    { key: "payments", label: "Payments", href: "/desk/billing?view=deposits", restriction: "finance",
      matches: ["/desk/billing/held-payments", "/desk/billing/reconciliation", "/desk/billing/deposits"],
      query: { param: "view", values: ["deposits", "waiting"] } },
    { key: "expenses", label: "Expenses", href: "/desk/expenses" },
    { key: "books", label: "Books", href: "/desk/books", restriction: "finance" },
    { key: "taxes", label: "Taxes", href: "/desk/sales-tax", restriction: "finance" },
  ] },
];

export const PROFILE_LINKS: ProfileLink[] = [
  { href: "/desk/settings", label: "Settings", restriction: "finance" },
  { href: "/desk/account", label: "Your account" },
  { href: "/desk/settings/website", label: "Website", restriction: "finance" },
  { href: "/desk/paperwork", label: "Business paperwork", restriction: "owner" },
  { href: "/desk/privacy", label: "Privacy requests", restriction: "owner" },
  { href: "/desk/automations", label: "System health", restriction: "finance" },
  { href: "/desk/activity", label: "Activity log" },
  { href: "/desk/help", label: "Help" },
];

function roleAllows(role: string | undefined, restriction?: Restriction): boolean {
  if (!["OWNER", "ADMIN", "STAFF"].includes(role ?? "")) return false;
  return !restriction || (restriction === "finance" && ["OWNER", "ADMIN"].includes(role!))
    || (restriction === "owner" && role === "OWNER");
}
function pathOf(href: string): string { return href.split(/[?#]/)[0] ?? href; }
function matches(path: string, prefix: string): boolean { return path === prefix || path.startsWith(prefix + "/"); }

/** Restrict in this order: session role, job-role path, owner-chosen navigation visibility. */
export function visibleAreas(role: string | undefined, screens: readonly string[] | null,
  shown?: ReadonlySet<FeatureKey>): Area[] {
  if (role === "ACCOUNTANT") {
    // Existing accountant capability: books/tax links, never a new money action.
    const money = DESK_AREAS.find(a => a.key === "money")!;
    return [{ ...money, tabs: money.tabs.filter(t => t.key === "books" || t.key === "taxes") }];
  }
  if (!["OWNER", "ADMIN", "STAFF"].includes(role ?? "")) return [];
  return DESK_AREAS.map(area => ({
    ...area,
    tabs: area.tabs.filter(tab =>
      roleAllows(role, tab.restriction)
      && jobRoleAllowsPath(screens, tab.href)
      && (!shown || !isHrefHidden(tab.href, shown))
    ),
  })).filter(area => area.tabs.length > 0);
}

export function areaHome(area: Area): string { return area.tabs[0]?.href ?? "/desk/today"; }

/** Longest matching path wins. Query rules apply only to the tab's own href. */
export function activeArea(pathname: string, search: URLSearchParams, areas: Area[]): { area: AreaKey; tab: string } | null {
  let best: { area: AreaKey; tab: string; score: number } | null = null;
  for (const area of areas) for (const tab of area.tabs) {
    const hrefPath = pathOf(tab.href);
    const paths = [hrefPath, ...(tab.matches ?? [])];
    for (const match of paths) {
      if (!matches(pathname, match)) continue;
      const own = match === hrefPath && pathname === hrefPath;
      if (own && tab.query && !tab.query.values.includes(search.get(tab.query.param) ?? "")) continue;
      if (pathname !== hrefPath && match === hrefPath && tab.query) continue;
      const score = match.length * 100 + (own && tab.query ? 2 : 0);
      if (!best || score > best.score) best = { area: area.key, tab: tab.key, score };
    }
  }
  return best ? { area: best.area, tab: best.tab } : null;
}

export function visibleProfileLinks(role: string | undefined, screens: readonly string[] | null): ProfileLink[] {
  if (role === "ACCOUNTANT") return [
    { href: "/desk/account", label: "Your account" },
    { href: "/desk/settings/decisions", label: "Decisions & reviews" },
    { href: "/desk/compliance", label: "Compliance" },
    { href: "/desk/reports", label: "Money reports" },
    { href: "/desk/paperwork", label: "Business paperwork" },
  ];
  return PROFILE_LINKS.filter(link => roleAllows(role, link.restriction) && jobRoleAllowsPath(screens, link.href));
}
