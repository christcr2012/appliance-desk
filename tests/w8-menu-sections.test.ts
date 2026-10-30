import { describe, expect, it } from "vitest";
import { ACCESSIBILITY_ROUTES } from "../e2e/route-inventory";
import { DESK_AREAS, activeArea, visibleAreas, visibleProfileLinks } from "@/lib/desk-areas";

// AR-10: the old desk-navigation / desk-sections wrappers are deleted; the
// desk areas model (src/lib/desk-areas.ts) is the one source the kit shell,
// the area layouts and these tests all read.
const routePaths = new Set(ACCESSIBILITY_ROUTES.map(route => route.path));
const links = (role: string) => visibleAreas(role, null).flatMap(area => area.tabs);

describe("AR-1 five areas (desk-areas is the single navigation source)", () => {
  it("has the five approved areas and exactly named tabs for owner/admin", () => {
    const labels = links("OWNER").map(link => link.label);
    expect(labels).toEqual([
      "Inbox", "Tasks", "Leads", "Customers", "Quotes", "Rentals", "Messages", "Insights",
      "Board", "Visits", "My route", "Repairs",
      "Fleet", "Purchases", "Parts", "Suppliers", "Retired", "Insights",
      "Overview", "Bills", "Payments", "Expenses", "Books", "Taxes",
    ]);
    expect(links("ADMIN").map(link => link.label)).toEqual(labels);
  });
  it("staff sees only allowed tabs; finance links never leak from areas or profile links", () => {
    const staff = links("STAFF").map(l => l.href);
    expect(staff).toEqual([
      "/desk/today", "/desk/tasks", "/desk/customers", "/desk/agreements", "/desk/communications",
      "/desk/dispatch", "/desk/jobs", "/desk/driver", "/desk/maintenance",
      "/desk/inventory", "/desk/parts", "/desk/expenses",
    ]);
    const everything = [...staff, ...visibleProfileLinks("STAFF", null).map(l => l.href)];
    for (const restricted of [
      "/desk/billing", "/desk/revenue", "/desk/sales-tax", "/desk/leads", "/desk/estimates",
      "/desk/purchases", "/desk/suppliers", "/desk/inventory/retired",
      "/desk/privacy", "/desk/paperwork", "/desk/settings", "/desk/automations",
    ]) expect(everything).not.toContain(restricted);
  });
  it("area tab strips come from the same source the shell renders", () => {
    expect(DESK_AREAS.map(a => a.label)).toEqual(["Today", "Customers", "Schedule", "Equipment", "Money"]);
    for (const role of ["OWNER", "ADMIN", "STAFF"]) {
      const visible = visibleAreas(role, null);
      for (const area of visible) {
        const source = DESK_AREAS.find(a => a.key === area.key)!;
        // Every visible tab is a source tab with the same label, in source order.
        expect(area.tabs.map(t => t.label)).toEqual(
          source.tabs.filter(t => area.tabs.some(v => v.key === t.key)).map(t => t.label),
        );
      }
    }
    expect(visibleAreas("STAFF", null).find(a => a.key === "money")!.tabs.map(t => t.label)).toEqual(["Expenses"]);
    expect(visibleAreas("CUSTOMER", null)).toEqual([]);
    expect(visibleAreas(undefined, null)).toEqual([]);
  });
  it("matches area aliases and query-dependent Payments without widening a tab", () => {
    const areas = visibleAreas("OWNER", null);
    expect(activeArea("/desk/billing/held-payments", new URLSearchParams(), areas)).toEqual({ area: "money", tab: "payments" });
    expect(activeArea("/desk/billing/customer/x", new URLSearchParams(), areas)).toEqual({ area: "money", tab: "bills" });
    // AR-3: /desk/billing?view=waiting no longer renders — it redirects to /desk/payments, where the
    // Payments tab is current by href. The pre-redirect URL itself resolves to the Bills tab's page.
    expect(activeArea("/desk/billing", new URLSearchParams("view=waiting"), areas)).toEqual({ area: "money", tab: "bills" });
  });
  it("every primary tab and profile link refers to an existing route", () => {
    const hrefs = new Set<string>();
    for (const role of ["OWNER", "ADMIN", "STAFF"]) {
      for (const link of links(role)) hrefs.add(link.href.split(/[?#]/)[0]!);
      for (const link of visibleProfileLinks(role, null)) hrefs.add(link.href.split(/[?#]/)[0]!);
    }
    const missing = [...hrefs].filter(href => !routePaths.has(href));
    expect(missing).toEqual([]);
  });
  it("profile lists owner-only destinations and cannot expose internal tools to staff", () => {
    expect(visibleProfileLinks("OWNER", null).map(l => l.label)).toEqual([
      "Settings", "Your account", "Website", "Business paperwork", "Set up your business", "Privacy requests",
      "System health", "Activity log", "Help", "App feedback",
    ]);
    expect(visibleProfileLinks("ADMIN", null).map(l => l.label)).toEqual([
      "Settings", "Your account", "Website", "System health", "Activity log", "Help", "App feedback",
    ]);
    expect(visibleProfileLinks("STAFF", null).map(l => l.label)).toEqual(["Your account", "Activity log", "Help", "App feedback"]);
    expect(visibleProfileLinks("CUSTOMER", null)).toEqual([]);
    const all = JSON.stringify([visibleAreas("OWNER", null), visibleProfileLinks("OWNER", null)]);
    expect(all).not.toMatch(/preview-storage|\/desk\/more/);
  });
  it("the phone bar's areas are the visible areas, one per area, in order", () => {
    // The kit AppFrame derives its phone bar from these same visible areas.
    expect(visibleAreas("OWNER", null).map(a => a.label))
      .toEqual(["Today", "Customers", "Schedule", "Equipment", "Money"]);
    for (const role of ["ADMIN", "STAFF"]) {
      expect(visibleAreas(role, null).map(a => a.key))
        .toEqual(["today", "customers", "schedule", "equipment", "money"]);
    }
  });
});
