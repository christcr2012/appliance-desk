import { jobRoleAllowsPath } from "@/domains/team/job-role-rules";
import { isHrefHidden, type FeatureKey } from "@/domains/features/registry";
import type { Area, ProfileLink } from "@/lib/desk-areas";

export type CommandChoice = {
  group: "Go to" | "Do" | "Records" | "Help" | "Recent";
  label: string; href: string; detail?: string; id?: string;
};

type CommandAction = { label: string; href: string; synonyms: string[]; restriction?: "finance" };
export const COMMAND_ACTIONS: CommandAction[] = [
  { label: "New quote", href: "/desk/estimates/new", synonyms: ["estimate", "price"], restriction: "finance" },
  { label: "New rental", href: "/desk/agreements/new", synonyms: ["agreement", "contract"], restriction: "finance" },
  { label: "New customer", href: "/desk/customers/new", synonyms: ["client"], restriction: "finance" },
  { label: "New lead", href: "/desk/leads/new", synonyms: ["enquiry", "prospect"], restriction: "finance" },
  { label: "Schedule a visit", href: "/desk/jobs/new", synonyms: ["delivery", "pickup", "job"], restriction: "finance" },
  { label: "Add an expense", href: "/desk/expenses#add-expense", synonyms: ["receipt", "cost"], restriction: "finance" },
  { label: "Record a purchase", href: "/desk/purchases/new", synonyms: ["equipment", "buy"], restriction: "finance" },
  { label: "Add a supplier", href: "/desk/suppliers/new", synonyms: ["vendor"], restriction: "finance" },
  { label: "Take a payment", href: "/desk/billing?status=open", synonyms: ["pay", "charge", "card"], restriction: "finance" },
];

const matches = (label: string, synonyms: readonly string[], q: string) =>
  [label, ...synonyms].some(s => s.toLocaleLowerCase().includes(q));
const choice = (label: string, href: string, group: CommandChoice["group"]): CommandChoice =>
  ({ label, href, group });

/** Pure role/job-role/feature-narrowed navigation; never grant access via the command palette. */
export function commandLocalChoices(query: string, role: string, screens: readonly string[] | null,
  areas: Area[], profile: ProfileLink[], shown?: ReadonlySet<FeatureKey>): CommandChoice[] {
  const q = query.trim().toLocaleLowerCase();
  const usable = (href: string) => jobRoleAllowsPath(screens, href)
    && (!shown || !isHrefHidden(href, shown));
  if (!q) return areas.map(a => choice(a.label, a.tabs[0]?.href ?? "/desk/today", "Go to"));
  if (q.length < 2) return [];
  const go = areas.flatMap(a => [
    choice(a.label, a.tabs[0]?.href ?? "/desk/today", "Go to"),
    ...a.tabs.map(t => choice(t.label, t.href, "Go to")),
  ]).concat(profile.map(l => choice(l.label, l.href, "Go to")))
    .filter(item => item.label.toLocaleLowerCase().includes(q));
  const acts = COMMAND_ACTIONS.filter(a =>
    (!a.restriction || (role === "OWNER" || role === "ADMIN"))
    && usable(a.href)
    && matches(a.label, a.synonyms, q)
  ).map(a => choice(a.label, a.href, "Do"));
  return [...go, ...acts];
}

/** Stored record URLs are untrusted after role changes; discard any inaccessible prefix or external URL. */
export function recentCommandChoices(value: unknown, allowed: ReadonlySet<string>): CommandChoice[] {
  if (!Array.isArray(value)) return [];
  const selected: CommandChoice[] = [];
  for (const item of value.slice(0, 5)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.label !== "string" || row.label.length > 120
      || typeof row.href !== "string" || !row.href.startsWith("/desk/")
      || typeof row.id !== "string" || row.id.length > 220) continue;
    const path = row.href.split(/[?#]/)[0] ?? "";
    if (![...allowed].some(prefix => path === prefix || path.startsWith(prefix + "/"))) continue;
    selected.push({ group: "Recent", label: row.label, href: row.href, id: row.id });
  }
  return selected;
}
