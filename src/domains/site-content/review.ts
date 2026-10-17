import { siteFieldSpec, SITE_PLACEHOLDERS, type SitePlaceholder } from "./fields";
import { pageForRegistryPage } from "./pages";
import type { SiteLinkTarget, SiteValue } from "./types";

/**
 * V-C4: what the owner reads before publishing. Pure functions over typed values, so the same review is shown in the
 * editor and checked in tests. Nothing here reads the database.
 */

export type LinkSummary = { label: string; destination: string };
export type ValueSummary =
  | { kind: "text"; text: string }
  | { kind: "link"; label: string; destination: string }
  | { kind: "image"; assetId: string; alt: string; decorative: boolean; focalX: number; focalY: number }
  | { kind: "promotion"; title: string; body: string; enabled: boolean; startsAtUtc?: string; endsAtUtc?: string; cta?: LinkSummary; image?: { assetId: string; alt: string; decorative: boolean; focalX: number; focalY: number } }
  | { kind: "items"; count: number }
  | { kind: "hidden" };

export function describeDestination(target: SiteLinkTarget): string {
  switch (target.type) {
    case "page": return target.anchor ? `The page ${target.path}, section “${target.anchor}”` : `The page ${target.path}`;
    case "external": return `Another website: ${target.url}`;
    case "phone": return "Your business phone number (from Settings)";
    case "email": return "Your business email address (from Settings)";
  }
}

export function summarizeValue(value: SiteValue | undefined): ValueSummary | null {
  if (!value) return null;
  switch (value.kind) {
    case "text": return { kind: "text", text: value.text };
    case "link": return { kind: "link", label: value.label, destination: describeDestination(value.target) };
    case "image": return { kind: "image", assetId: value.assetId, alt: value.alt, decorative: value.decorative, focalX: value.focalX, focalY: value.focalY };
    case "items": return { kind: "items", count: value.items.length };
    case "hidden": return { kind: "hidden" };
    case "promotion":
      return {
        kind: "promotion", title: value.title, body: value.body, enabled: value.enabled,
        ...(value.startsAtUtc ? { startsAtUtc: value.startsAtUtc } : {}),
        ...(value.endsAtUtc ? { endsAtUtc: value.endsAtUtc } : {}),
        ...(value.cta ? { cta: { label: value.cta.label, destination: describeDestination(value.cta.target) } } : {}),
        ...(value.image ? { image: { assetId: value.image.assetId, alt: value.image.alt, decorative: value.image.decorative, focalX: value.image.focalX, focalY: value.image.focalY } } : {}),
      };
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sameValue(a: SiteValue | undefined, b: SiteValue | undefined): boolean {
  return canonical(a) === canonical(b);
}

export type ReviewChange = {
  key: string;
  label: string;
  /** The page name the owner knows. */
  pageName: string;
  pageId: string | null;
  where: string;
  valueKind: string;
  before: ValueSummary | null;
  after: ValueSummary | null;
};

/**
 * The items whose effective value differs between what is live and what the draft would make live. Both sides must
 * already have the starting values filled in, so "never changed" and "set back to the starting words" compare equal.
 */
export function diffValues(live: Record<string, SiteValue>, draft: Record<string, SiteValue>): ReviewChange[] {
  const out: ReviewChange[] = [];
  const keys = new Set([...Object.keys(live), ...Object.keys(draft)]);
  for (const key of keys) {
    const spec = siteFieldSpec(key);
    if (!spec) continue;
    if (sameValue(live[key], draft[key])) continue;
    const page = pageForRegistryPage(spec.page);
    out.push({
      key, label: spec.label, pageName: page?.name ?? spec.page, pageId: page?.id ?? null, where: spec.where, valueKind: spec.valueKind,
      before: summarizeValue(live[key]), after: summarizeValue(draft[key]),
    });
  }
  return out.sort((a, b) => a.pageName.localeCompare(b.pageName) || a.label.localeCompare(b.label));
}

export type PageEffect = { pageId: string | null; pageName: string; count: number };

export function pagesAffected(changes: ReviewChange[]): PageEffect[] {
  const map = new Map<string, PageEffect>();
  for (const change of changes) {
    const id = change.pageId ?? change.pageName;
    const row = map.get(id) ?? { pageId: change.pageId, pageName: change.pageName, count: 0 };
    row.count += 1;
    map.set(id, row);
  }
  return [...map.values()].sort((a, b) => a.pageName.localeCompare(b.pageName));
}

const FACT_LABELS: Record<SitePlaceholder, string> = {
  businessName: "Business name", name: "Appliance name", phone: "Phone number", email: "Email address", city: "City",
  graceDays: "Late-fee grace days", serviceCities: "Cities you serve", contents: "Set contents", amount: "Monthly saving", year: "Year",
};

export type FactUse = { placeholder: SitePlaceholder; label: string; value: string | null };

function textsOf(summary: ValueSummary | null): string[] {
  if (!summary) return [];
  switch (summary.kind) {
    case "text": return [summary.text];
    case "link": return [summary.label];
    case "promotion": return [summary.title, summary.body, summary.cta?.label ?? ""];
    default: return [];
  }
}

/**
 * The facts the changed words mention, with the value each has right now in its owner. The owner sees that
 * “{phone}” will read as their real number; a fact that cannot be filled in here shows no value.
 */
export function factsUsed(changes: ReviewChange[], current: Partial<Record<SitePlaceholder, string>>): FactUse[] {
  const used = new Set<SitePlaceholder>();
  for (const change of changes) {
    for (const text of textsOf(change.after)) {
      for (const match of text.matchAll(/\{(\w+)\}/g)) {
        if ((SITE_PLACEHOLDERS as ReadonlyArray<string>).includes(match[1])) used.add(match[1] as SitePlaceholder);
      }
    }
  }
  return [...used].sort().map((placeholder) => ({ placeholder, label: FACT_LABELS[placeholder], value: current[placeholder] ?? null }));
}

/** "Visible now / starts… / ended" wording lives in promotions.ts; this only names what a promotion change is. */
export function changeKindName(change: ReviewChange): string {
  if (!change.before && change.after) return "Added";
  if (change.before && !change.after) return "Removed";
  if (change.after?.kind === "hidden") return "Hidden";
  return "Changed";
}
