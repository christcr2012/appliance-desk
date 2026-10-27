import { ApplianceStatus, JobStatus } from "@prisma/client";
import { OWNER_ACTIONS, type OwnerAction } from "@/lib/owner-actions";

// O-7: the private workspace DTO. Pure code: parsing, checking and building links. Nothing here touches the database.

export const MAX_PINNED = 12;
export const MAX_SAVED_VIEWS = 20;
export const MAX_VIEW_LABEL = 60;
export const PREFERENCES_VERSION = 1;

/** Soft notes that may be hidden from Today. Everything else on Today (money, safety, deadlines) can never be hidden. */
export const OPTIONAL_TODAY_CARDS = [
  { id: "GOAL_BEHIND", label: "Behind on a monthly goal" },
  { id: "IDLE_APPLIANCES", label: "Appliances sitting idle" },
  { id: "LOW_UTILIZATION", label: "Fleet is mostly sitting idle" },
] as const;
const OPTIONAL_IDS: ReadonlySet<string> = new Set(OPTIONAL_TODAY_CARDS.map((c) => c.id));

const human = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: human(v) }));

/** Only filters the real screens understand. A saved view is a link with these choices, never a stored URL. */
export const SAVED_VIEW_ROUTES = {
  // Only filter keys and values that the real page parser/DB query understands may be persisted.
  billing: { label: "Bills", path: "/desk/billing", filters: {
    status: { label: "Status", options: [
      { value: "open", label: "Open" }, { value: "past-due", label: "Past due" },
      { value: "being-confirmed", label: "Being confirmed" }, { value: "paid", label: "Paid" },
      { value: "closed", label: "Closed" }, { value: "drafts", label: "Drafts" },
    ] },
    due: { label: "Due", options: [
      { value: "this-month", label: "This month" },
      { value: "last-month", label: "Last month" },
      { value: "last-30", label: "Last 30 days" },
    ] },
    autopay: { label: "Autopay", options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }] },
  } },
  customers: { label: "Customers", path: "/desk/customers", filters: {
    status: { label: "Status", options: [{ value: "active", label: "Renting now" }] },
    kind: { label: "Kind", options: [{ value: "pm", label: "Property managers" }] },
  } },
  inventory: { label: "Equipment", path: "/desk/inventory", filters: { status: { label: "Status", options: opts(Object.values(ApplianceStatus)) } } },
  jobs: { label: "Visits", path: "/desk/jobs", filters: { status: { label: "Status", options: opts(Object.values(JobStatus)) } } },
  tasks: {
    label: "Tasks", path: "/desk/tasks",
    filters: {
      due: { label: "Due", options: [{ value: "overdue", label: "Overdue" }, { value: "today", label: "Due today" }, { value: "upcoming", label: "Upcoming" }, { value: "undated", label: "No due date" }] },
      view: { label: "Whose", options: [{ value: "mine", label: "Mine" }, { value: "unassigned", label: "Unassigned" }, { value: "completed", label: "Completed" }] },
    },
  },
} as const;
export type SavedViewRoute = keyof typeof SAVED_VIEW_ROUTES;
export const SAVED_VIEW_ROUTE_KEYS = Object.keys(SAVED_VIEW_ROUTES) as SavedViewRoute[];

export type SavedView = { id: string; label: string; routeKey: SavedViewRoute; filters: Record<string, string> };
export type WorkspacePreferences = {
  pinnedActionIds: string[]; hiddenOptionalCardIds: string[]; savedViews: SavedView[];
  /** DEC-1b: the Colorado date the weekly "Decisions waiting" Today card was last shown (YYYY-MM-DD). */
  decisionsCardShownOn?: string;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
function shownOn(raw: Record<string, unknown>): { decisionsCardShownOn?: string } {
  const value = raw.decisionsCardShownOn;
  return typeof value === "string" && DATE_KEY.test(value) ? { decisionsCardShownOn: value } : {};
}

export const EMPTY_PREFERENCES: WorkspacePreferences = { pinnedActionIds: [], hiddenOptionalCardIds: [], savedViews: [] };
const ACTION_IDS: ReadonlySet<string> = new Set(OWNER_ACTIONS.map((a) => a.id));

function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text.length >= 1 && text.length <= MAX_VIEW_LABEL ? text : null;
}

function filterProblem(routeKey: SavedViewRoute, filters: unknown): { filters?: Record<string, string>; problem?: string } {
  if (typeof filters !== "object" || filters === null || Array.isArray(filters)) return { problem: "That view has a filter this screen does not understand." };
  const spec = SAVED_VIEW_ROUTES[routeKey].filters as Record<string, { options: ReadonlyArray<{ value: string }> }>;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters as Record<string, unknown>)) {
    if (!Object.hasOwn(spec, key)) return { problem: "That view has a filter this screen does not understand." };
    if (typeof value !== "string" || !spec[key].options.some((o) => o.value === value)) return { problem: "That view has a filter choice this screen does not understand." };
    out[key] = value;
  }
  if (Object.keys(out).length === 0) return { problem: "Pick at least one filter to save." };
  return { filters: out };
}

/** Strict check for anything a person submits. Returns the cleaned value or one plain reason. */
export function validatePreferences(input: unknown): { ok: true; value: WorkspacePreferences } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "Those settings could not be read." };
  const raw = input as Record<string, unknown>;
  const pinned = raw.pinnedActionIds ?? [];
  const hidden = raw.hiddenOptionalCardIds ?? [];
  const views = raw.savedViews ?? [];
  if (!Array.isArray(pinned) || !Array.isArray(hidden) || !Array.isArray(views)) return { ok: false, error: "Those settings could not be read." };
  if (pinned.length > MAX_PINNED) return { ok: false, error: `You can pin up to ${MAX_PINNED} shortcuts. Unpin one first.` };
  if (views.length > MAX_SAVED_VIEWS) return { ok: false, error: `You can save up to ${MAX_SAVED_VIEWS} views. Remove one first.` };
  if (!pinned.every((id) => typeof id === "string" && ACTION_IDS.has(id)) || new Set(pinned).size !== pinned.length) return { ok: false, error: "One of those shortcuts is not available." };
  if (!hidden.every((id) => typeof id === "string" && OPTIONAL_IDS.has(id)) || new Set(hidden).size !== hidden.length) return { ok: false, error: "Only the optional notes can be hidden. Important items always show." };
  const savedViews: SavedView[] = [];
  const seen = new Set<string>();
  for (const v of views) {
    if (typeof v !== "object" || v === null) return { ok: false, error: "A saved view could not be read." };
    const r = v as Record<string, unknown>;
    const label = cleanLabel(r.label);
    if (!label) return { ok: false, error: `Give each view a name of 1 to ${MAX_VIEW_LABEL} characters.` };
    if (typeof r.id !== "string" || !/^[a-z0-9-]{6,40}$/.test(r.id) || seen.has(r.id)) return { ok: false, error: "A saved view could not be read." };
    if (typeof r.routeKey !== "string" || !Object.hasOwn(SAVED_VIEW_ROUTES, r.routeKey)) return { ok: false, error: "That screen cannot have saved views." };
    const checked = filterProblem(r.routeKey as SavedViewRoute, r.filters);
    if (!checked.filters) return { ok: false, error: checked.problem! };
    seen.add(r.id);
    savedViews.push({ id: r.id, label, routeKey: r.routeKey as SavedViewRoute, filters: checked.filters });
  }
  return { ok: true, value: { pinnedActionIds: [...pinned] as string[], hiddenOptionalCardIds: [...hidden] as string[], savedViews, ...shownOn(raw) } };
}

/** Lenient read of what is stored: anything unreadable is dropped so a bad row can never break a page. */
export function readPreferences(stored: unknown): WorkspacePreferences {
  const strict = validatePreferences(stored);
  if (strict.ok) return strict.value;
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return { ...EMPTY_PREFERENCES };
  const raw = stored as Record<string, unknown>;
  const pinned = Array.isArray(raw.pinnedActionIds) ? raw.pinnedActionIds.filter((id): id is string => typeof id === "string" && ACTION_IDS.has(id)) : [];
  const hidden = Array.isArray(raw.hiddenOptionalCardIds) ? raw.hiddenOptionalCardIds.filter((id): id is string => typeof id === "string" && OPTIONAL_IDS.has(id)) : [];
  const views = Array.isArray(raw.savedViews) ? raw.savedViews.flatMap((v) => {
    const one = validatePreferences({ savedViews: [v] });
    return one.ok ? one.value.savedViews : [];
  }) : [];
  return {
    pinnedActionIds: [...new Set(pinned)].slice(0, MAX_PINNED),
    hiddenOptionalCardIds: [...new Set(hidden)],
    savedViews: views.slice(0, MAX_SAVED_VIEWS),
    ...shownOn(raw),
  };
}

/** The link a saved view opens. Built only from the allowlist above, so it can never point anywhere else. */
export function savedViewHref(view: SavedView): string {
  const route = SAVED_VIEW_ROUTES[view.routeKey];
  const params = new URLSearchParams();
  for (const key of Object.keys(route.filters)) if (view.filters[key]) params.set(key, view.filters[key]);
  const qs = params.toString();
  return qs ? `${route.path}?${qs}` : route.path;
}

export function describeSavedView(view: SavedView): string {
  const route = SAVED_VIEW_ROUTES[view.routeKey];
  const spec = route.filters as Record<string, { label: string; options: ReadonlyArray<{ value: string; label: string }> }>;
  const parts = Object.entries(view.filters).map(([k, v]) => `${spec[k]?.label ?? k}: ${spec[k]?.options.find((o) => o.value === v)?.label ?? v}`);
  return `${route.label} · ${parts.join(", ")}`;
}

/** Pinned shortcuts this person may use right now. Permission changes silently drop stale pins here. */
export function usablePins(prefs: WorkspacePreferences, visible: readonly OwnerAction[]): OwnerAction[] {
  const byId = new Map(visible.map((a) => [a.id, a]));
  return prefs.pinnedActionIds.flatMap((id) => byId.get(id) ?? []);
}
