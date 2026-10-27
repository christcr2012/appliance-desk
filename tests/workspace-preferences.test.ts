import { describe, expect, it } from "vitest";
import { ApplianceStatus, JobStatus } from "@prisma/client";
import {
  MAX_PINNED, MAX_SAVED_VIEWS, OPTIONAL_TODAY_CARDS, SAVED_VIEW_ROUTES, describeSavedView, readPreferences, savedViewHref, usablePins, validatePreferences,
  type SavedView,
} from "@/domains/workspace/preferences";
import { OWNER_ACTIONS, visibleOwnerActions } from "@/lib/owner-actions";

const view = (over: Partial<SavedView> = {}): SavedView => ({ id: "v-abc12345", label: "Rented out", routeKey: "inventory", filters: { status: "RENTED" }, ...over });
const base = { pinnedActionIds: [], hiddenOptionalCardIds: [], savedViews: [] };

describe("workspace preferences: strict check on anything submitted", () => {
  it("accepts empty and valid values", () => {
    expect(validatePreferences({}).ok).toBe(true);
    expect(validatePreferences({ ...base, pinnedActionIds: ["website"], hiddenOptionalCardIds: ["GOAL_BEHIND"], savedViews: [view()] }).ok).toBe(true);
  });
  it("rejects unknown pins, duplicates and too many", () => {
    expect(validatePreferences({ ...base, pinnedActionIds: ["nope"] }).ok).toBe(false);
    expect(validatePreferences({ ...base, pinnedActionIds: ["website", "website"] }).ok).toBe(false);
    const all = OWNER_ACTIONS.slice(0, MAX_PINNED + 1).map((a) => a.id);
    expect(validatePreferences({ ...base, pinnedActionIds: all }).ok).toBe(false);
    expect(validatePreferences({ ...base, pinnedActionIds: all.slice(0, MAX_PINNED) }).ok).toBe(true);
  });
  it("mandatory Today items cannot be hidden", () => {
    for (const bad of ["APPROVAL_REQUEST", "OVERDUE_INVOICE", "__proto__", ""]) expect(validatePreferences({ ...base, hiddenOptionalCardIds: [bad] }).ok, bad).toBe(false);
    for (const c of OPTIONAL_TODAY_CARDS) expect(validatePreferences({ ...base, hiddenOptionalCardIds: [c.id] }).ok).toBe(true);
  });
  it("saved views: allowlisted screens and filter values only", () => {
    expect(validatePreferences({ ...base, savedViews: [view({ routeKey: "unknown" as never })] }).ok).toBe(false);
    expect(validatePreferences({ ...base, savedViews: [view({ filters: { status: "DROP TABLE" } })] }).ok).toBe(false);
    expect(validatePreferences({ ...base, savedViews: [view({ filters: { search: "Jane Smith" } })] }).ok).toBe(false);
    expect(validatePreferences({ ...base, savedViews: [view({ filters: {} })] }).ok).toBe(false);
    expect(validatePreferences({ ...base, savedViews: [view({ routeKey: "jobs", filters: { status: "RENTED" } })] }).ok).toBe(false);
    expect(validatePreferences({ ...base, savedViews: [view({ filters: { __proto__: "x" } as never })] }).ok).toBe(false);
  });
  it("accepts actual Bills and Customers filters but not unknown inputs", () => {
    const bill = view({ routeKey: "billing", filters: { status: "past-due", due: "this-month", autopay: "off" } });
    const customer = view({ id: "v-customer123", routeKey: "customers", filters: { status: "active", kind: "pm" } });
    expect(validatePreferences({ ...base, savedViews: [bill, customer] }).ok).toBe(true);
    expect(savedViewHref(bill)).toBe("/desk/billing?status=past-due&due=this-month&autopay=off");
    expect(savedViewHref(customer)).toBe("/desk/customers?status=active&kind=pm");
    for (const invalid of [
      view({routeKey:"billing", filters:{q:"alice"}}),
      view({routeKey:"billing", filters:{status:"paid",view:"deposits"}}),
      view({routeKey:"billing", filters:{status:"paid",autopay:"unknown"}}),
      view({routeKey:"customers",filters:{owes:"yes"}}),
    ]) expect(validatePreferences({...base,savedViews:[invalid]}).ok).toBe(false);
  });
  it("saved views: names 1-60 characters, unique ids, at most 20", () => {
    expect(validatePreferences({ ...base, savedViews: [view({ label: "   " })] }).ok).toBe(false);
    expect(validatePreferences({ ...base, savedViews: [view({ label: "x".repeat(61) })] }).ok).toBe(false);
    expect(validatePreferences({ ...base, savedViews: [view({ label: "x".repeat(60) })] }).ok).toBe(true);
    expect(validatePreferences({ ...base, savedViews: [view(), view()] }).ok).toBe(false);
    const many = Array.from({ length: MAX_SAVED_VIEWS + 1 }, (_, i) => view({ id: `v-number${i}0` }));
    expect(validatePreferences({ ...base, savedViews: many }).ok).toBe(false);
  });
  it("rejects non-objects and wrong shapes", () => {
    for (const bad of [null, "x", 5, [], { pinnedActionIds: "website" }, { savedViews: {} }]) expect(validatePreferences(bad).ok).toBe(false);
  });
});

describe("workspace preferences: tolerant read of what is stored", () => {
  it("drops unreadable parts instead of failing", () => {
    expect(readPreferences(null)).toEqual(base);
    expect(readPreferences("garbage")).toEqual(base);
    const read = readPreferences({ pinnedActionIds: ["website", "gone", 5], hiddenOptionalCardIds: ["GOAL_BEHIND", "APPROVAL_REQUEST"], savedViews: [view(), { id: "x" }, null] });
    expect(read.pinnedActionIds).toEqual(["website"]);
    expect(read.hiddenOptionalCardIds).toEqual(["GOAL_BEHIND"]);
    expect(read.savedViews).toHaveLength(1);
  });
});

describe("saved view links and pins", () => {
  it("builds links only from the allowlist", () => {
    expect(savedViewHref(view())).toBe("/desk/inventory?status=RENTED");
    expect(savedViewHref(view({ routeKey: "tasks", filters: { due: "overdue", view: "mine" } }))).toBe("/desk/tasks?due=overdue&view=mine");
    expect(describeSavedView(view())).toBe("Equipment · Status: Rented");
  });
  it("every offered filter value is a value the real screen accepts", () => {
    const inv = SAVED_VIEW_ROUTES.inventory.filters.status.options.map((o) => o.value);
    expect(inv.sort()).toEqual(Object.values(ApplianceStatus).sort());
    const jobs = SAVED_VIEW_ROUTES.jobs.filters.status.options.map((o) => o.value);
    expect(jobs.sort()).toEqual(Object.values(JobStatus).sort());
  });
  it("pins the person can no longer use are dropped", () => {
    const prefs = { ...base, pinnedActionIds: ["website", "permissions", "business-profile"] };
    const admin = usablePins(prefs, visibleOwnerActions("ADMIN", ["EDIT_SETTINGS"])).map((a) => a.id);
    expect(admin).toEqual(["website"]);
    expect(usablePins(prefs, visibleOwnerActions("OWNER")).map((a) => a.id)).toEqual(["website", "permissions", "business-profile"]);
    expect(usablePins(prefs, visibleOwnerActions("STAFF"))).toEqual([]);
  });
});

describe("saved view values for tasks match the real tasks screen", () => {
  it("due and view options are accepted by the screen's own parsers", async () => {
    const { vi } = await import("vitest");
    vi.doMock("@/lib/session", () => ({ requireRole: vi.fn() }));
    vi.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { parseTaskFilter, parseTaskView } = await import("@/domains/tasks/workspace");
    for (const o of SAVED_VIEW_ROUTES.tasks.filters.due.options) expect(parseTaskFilter(o.value)).toBe(o.value);
    for (const o of SAVED_VIEW_ROUTES.tasks.filters.view.options) expect(parseTaskView(o.value)).toBe(o.value);
  });
});
