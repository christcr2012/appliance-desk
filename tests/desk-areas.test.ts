import { describe, expect, it } from "vitest";
import { activeArea, areaHome, DESK_AREAS, PROFILE_LINKS, visibleAreas, visibleProfileLinks } from "@/lib/desk-areas";
import { FEATURE_KEYS } from "@/domains/features/registry";

const all = new Set(FEATURE_KEYS);
const hrefs = (role: string, screens: string[] | null = null) =>
  visibleAreas(role, screens, all).flatMap(area => area.tabs.map(tab => tab.href));
const match = (path: string, qs = "") =>
  activeArea(path, new URLSearchParams(qs), visibleAreas("OWNER", null, all));

describe("AR-1 five desk areas", () => {
  it("keeps exactly five areas, their 22 named tabs and ten profile destinations", () => {
    expect(DESK_AREAS.map(area => area.key)).toEqual(["today", "customers", "schedule", "equipment", "money"]);
    expect(DESK_AREAS.map(area => area.tabs.map(tab => tab.key))).toEqual([
      ["inbox", "tasks"], ["leads", "customers", "quotes", "rentals", "messages"],
      ["board", "visits", "route", "repairs"],
      ["fleet", "purchases", "parts", "suppliers", "retired"],
      ["overview", "bills", "payments", "expenses", "books", "taxes"],
    ]);
    expect(PROFILE_LINKS.map(link => link.href)).toEqual([
      "/desk/settings", "/desk/account", "/desk/settings/website", "/desk/paperwork",
      "/desk/setup-guide", "/desk/privacy", "/desk/automations", "/desk/activity", "/desk/help", "/desk/feedback/new",
    ]);
  });

  it("does not serialize finance/owner-only destinations to staff or other user types", () => {
    for (const path of ["/desk/billing", "/desk/revenue", "/desk/sales-tax", "/desk/leads",
      "/desk/estimates", "/desk/purchases", "/desk/suppliers", "/desk/inventory/retired"]) {
      expect(hrefs("STAFF")).not.toContain(path);
      expect(hrefs("OWNER")).toContain(path);
    }
    expect(visibleAreas("CUSTOMER", null, all)).toEqual([]);
    expect(visibleAreas(undefined, null, all)).toEqual([]);
    expect(visibleProfileLinks("STAFF", null).map(link => link.href)).not.toContain("/desk/settings");
    expect(visibleProfileLinks("ACCOUNTANT", null).map(link => link.href)).toEqual([
      "/desk/account", "/desk/settings/decisions", "/desk/compliance", "/desk/reports", "/desk/paperwork",
    ]);
  });

  it("always narrows by job-role screens and feature navigation switches", () => {
    expect(visibleAreas("STAFF", ["customers"], all).some(area => area.key === "schedule")).toBe(false);
    expect(hrefs("STAFF", ["customers"])).not.toContain("/desk/dispatch");
    expect(hrefs("STAFF", ["customers"])).not.toContain("/desk/expenses");
    expect(hrefs("OWNER")).toContain("/desk/dispatch");
    expect(visibleAreas("OWNER", null, new Set()).flatMap(a => a.tabs.map(t => t.href))).not.toContain("/desk/dispatch");
    expect(visibleAreas("OWNER", null, all).some(a => a.key === "schedule")).toBe(true);
  });

  it("matches the longest route and query so only the right tab is active", () => {
    expect(match("/desk/billing")).toEqual({ area: "money", tab: "bills" });
    expect(match("/desk/billing", "view=deposits")).toEqual({ area: "money", tab: "payments" });
    expect(match("/desk/billing", "view=waiting")).toEqual({ area: "money", tab: "payments" });
    expect(match("/desk/billing/held-payments")).toEqual({ area: "money", tab: "payments" });
    expect(match("/desk/billing/customer/abc")).toEqual({ area: "money", tab: "bills" });
    expect(match("/desk/inventory/retired")).toEqual({ area: "equipment", tab: "retired" });
    expect(match("/desk/inventory/abc")).toEqual({ area: "equipment", tab: "fleet" });
    expect(match("/desk/inventory-other")).toBeNull();
    expect(match("/desk/settings")).toBeNull();
  });

  it("keeps a safe first tab after role and visibility filtering", () => {
    for (const area of visibleAreas("OWNER", null, all)) expect(areaHome(area)).toBe(area.tabs[0]?.href);
    const schedule = visibleAreas("OWNER", null, new Set()).find(a => a.key === "schedule")!;
    expect(areaHome(schedule)).toBe("/desk/jobs");
  });
});
