import { describe, expect, it } from "vitest";
import { ACCESSIBILITY_ROUTES } from "../e2e/route-inventory";
import {
  DESK_NAV_ALIASES, activeDeskHref, deskBottomTabLinks, deskMoreLinks, deskNavigation,
} from "@/lib/desk-navigation";
import { DESK_SECTIONS, activeSectionTab, deskSectionTabs } from "@/lib/desk-sections";
import { DESK_AREAS, activeArea, visibleAreas } from "@/lib/desk-areas";

const routePaths = new Set(ACCESSIBILITY_ROUTES.map(route => route.path));
const links = (role: string) => deskNavigation(role).flatMap(group => group.links);

describe("AR-1 five areas (W-8 backward-compatible tab helpers)", () => {
  it("has the five approved areas and exactly named tabs for owner/admin", () => {
    const labels = links("OWNER").map(link => link.label);
    expect(labels).toEqual([
      "Inbox", "Tasks", "Leads", "Customers", "Quotes", "Rentals", "Messages",
      "Board", "Visits", "My route", "Repairs",
      "Fleet", "Purchases", "Parts", "Suppliers", "Retired",
      "Overview", "Bills", "Payments", "Expenses", "Books", "Taxes",
    ]);
    expect(links("ADMIN").map(link => link.label)).toEqual(labels);
  });
  it("staff sees only allowed tabs; finance links never leak from either wrapper", () => {
    const staff = links("STAFF").map(l => l.href);
    expect(staff).toEqual([
      "/desk/today", "/desk/tasks", "/desk/customers", "/desk/agreements", "/desk/communications",
      "/desk/dispatch", "/desk/jobs", "/desk/driver", "/desk/maintenance",
      "/desk/inventory", "/desk/parts", "/desk/expenses",
    ]);
    const everything = [...staff, ...deskMoreLinks("STAFF").map(l => l.href),
      ...deskSectionTabs("schedule", "STAFF").map(t => t.href),
      ...deskSectionTabs("equipment", "STAFF").map(t => t.href),
      ...deskSectionTabs("money", "STAFF").map(t => t.href)];
    for (const restricted of [
      "/desk/billing", "/desk/revenue", "/desk/sales-tax", "/desk/leads", "/desk/estimates",
      "/desk/purchases", "/desk/suppliers", "/desk/inventory/retired",
      "/desk/privacy", "/desk/paperwork", "/desk/settings", "/desk/automations",
    ]) expect(everything).not.toContain(restricted);
  });
  it("sends Schedule, Equipment and Money tabs through the same pure source", () => {
    expect(DESK_SECTIONS.schedule.tabs.map(t => t.label)).toEqual(["Board", "Visits", "My route", "Repairs"]);
    expect(DESK_SECTIONS.equipment.tabs.map(t => t.label)).toEqual(["Fleet", "Purchases", "Parts", "Suppliers", "Retired"]);
    expect(DESK_SECTIONS.money.tabs.map(t => t.label)).toEqual(["Overview", "Bills", "Payments", "Expenses", "Books", "Taxes"]);
    for (const role of ["OWNER", "ADMIN", "STAFF"]) {
      const visible = visibleAreas(role, null);
      for (const area of visible.filter(a => ["schedule", "equipment", "money"].includes(a.key))) {
        expect(deskSectionTabs(area.key as "schedule", role).map(t => t.label)).toEqual(area.tabs.map(t => t.label));
      }
    }
    expect(deskSectionTabs("money", "STAFF").map(t => t.label)).toEqual(["Expenses"]);
    expect(deskSectionTabs("schedule", "CUSTOMER")).toEqual([]);
    expect(deskSectionTabs("money", undefined)).toEqual([]);
  });
  it("matches area aliases and query-dependent Payments without widening a tab", () => {
    const areas = visibleAreas("OWNER", null);
    expect(activeArea("/desk/billing/held-payments", new URLSearchParams(), areas)).toEqual({ area: "money", tab: "payments" });
    expect(activeArea("/desk/billing/customer/x", new URLSearchParams(), areas)).toEqual({ area: "money", tab: "bills" });
    expect(activeArea("/desk/billing", new URLSearchParams("view=waiting"), areas)).toEqual({ area: "money", tab: "payments" });
    expect(activeSectionTab("/desk/inventory/x", deskSectionTabs("equipment", "OWNER"))).toBe("/desk/inventory");
    expect(activeSectionTab("/desk/today", deskSectionTabs("money", "OWNER"))).toBeNull();
    const groups = deskNavigation("OWNER");
    for (const [entry, aliases] of Object.entries(DESK_NAV_ALIASES)) {
      for (const alias of aliases) {
        // Deprecated wrapper may not know query semantics, but must still identify a parent route.
        if (entry === "/desk/billing") {
          expect(activeDeskHref(alias, groups)?.startsWith("/desk/billing")).toBe(true);
        } else if (alias !== "/desk/compliance") {
          expect(activeDeskHref(alias, groups)).toBe(entry);
        }
      }
    }
  });
  it("every primary tab and profile link refers to an existing route", () => {
    const hrefs = new Set<string>();
    for (const role of ["OWNER", "ADMIN", "STAFF"]) {
      for (const link of links(role)) hrefs.add(link.href.split(/[?#]/)[0]!);
      for (const link of deskMoreLinks(role)) hrefs.add(link.href.split(/[?#]/)[0]!);
    }
    const missing = [...hrefs].filter(href => !routePaths.has(href));
    expect(missing).toEqual([]);
  });
  it("profile lists owner-only destinations and cannot expose internal tools to staff", () => {
    expect(deskMoreLinks("OWNER").map(l => l.label)).toEqual([
      "Settings", "Your account", "Website", "Business paperwork", "Privacy requests",
      "System health", "Activity log", "Help",
    ]);
    expect(deskMoreLinks("ADMIN").map(l => l.label)).toEqual([
      "Settings", "Your account", "Website", "System health", "Activity log", "Help",
    ]);
    expect(deskMoreLinks("STAFF").map(l => l.label)).toEqual(["Your account", "Activity log", "Help"]);
    expect(deskMoreLinks("CUSTOMER")).toEqual([]);
    const all = JSON.stringify([deskNavigation("OWNER"), deskMoreLinks("OWNER"), DESK_SECTIONS]);
    expect(all).not.toMatch(/preview-storage|\/desk\/more/);
  });
  it("phone bar derives one link per visible area, not from a different menu", () => {
    for (const role of ["OWNER", "ADMIN", "STAFF"]) {
      const nav = deskNavigation(role);
      const tabs = deskBottomTabLinks(role, nav);
      expect(tabs.map(t => t.label)).toEqual(nav.map(g => g.label));
    }
    expect(deskBottomTabLinks("OWNER", deskNavigation("OWNER")).map(t => t.label))
      .toEqual(["Today", "Customers", "Schedule", "Equipment", "Money"]);
  });
});
