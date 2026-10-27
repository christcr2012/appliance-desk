import { describe, expect, it } from "vitest";
import { ACCESSIBILITY_ROUTES } from "../e2e/route-inventory";
import {
  DESK_NAV_ALIASES, activeDeskHref, deskBottomTabLinks, deskMoreLinks, deskNavigation,
} from "@/lib/desk-navigation";
import { DESK_SECTIONS, activeSectionTab, deskSectionTabs } from "@/lib/desk-sections";

const routePaths = new Set(ACCESSIBILITY_ROUTES.map((route) => route.path));
const links = (role: string) => deskNavigation(role).flatMap((group) => group.links);

describe("W-8 simpler menu", () => {
  it("has the 14 named entries for owner and admin, in a sensible order", () => {
    const labels = links("OWNER").map((link) => link.label);
    expect(labels).toEqual([
      "Today", "Tasks", "Leads", "Customers", "Quotes", "Communications", "Rentals",
      "Schedule", "Repairs", "Equipment", "Money", "Taxes", "Settings", "More",
    ]);
    expect(links("ADMIN").map((link) => link.label)).toEqual(labels);
  });

  it("gives staff the 10 entries they can open and nothing financial", () => {
    expect(links("STAFF").map((link) => link.label)).toEqual([
      "Today", "Tasks", "Leads", "Customers", "Communications", "Rentals", "Schedule", "Repairs", "Equipment", "More",
    ]);
    const text = JSON.stringify([deskNavigation("STAFF"), deskMoreLinks("STAFF"), ...["schedule", "equipment", "money"].map(
      (key) => deskSectionTabs(key as "schedule", "STAFF"))]);
    expect(text).not.toMatch(/billing|revenue|reports|fleet|dashboard|purchases|purchase-orders|suppliers|settings|privacy|automations|growth|launch|estimates/);
  });

  it("reaches Dispatch, Jobs and Driver view as one Schedule entry with three views", () => {
    expect(DESK_SECTIONS.schedule.tabs.map((tab) => tab.label)).toEqual(["Dispatch board", "Jobs", "Driver view"]);
    for (const role of ["OWNER", "ADMIN", "STAFF"]) {
      expect(deskSectionTabs("schedule", role)).toHaveLength(3);
    }
    const nav = deskNavigation("OWNER");
    for (const path of ["/desk/dispatch", "/desk/jobs", "/desk/jobs/new", "/desk/driver"]) {
      expect(activeDeskHref(path, nav)).toBe("/desk/dispatch");
    }
  });

  it("shows Money and Equipment tabs only to people who can open them", () => {
    expect(deskSectionTabs("money", "OWNER").map((tab) => tab.label)).toEqual(
      ["Billing", "Disputes", "Past due", "Shop sales", "Revenue", "Books", "Fleet", "Reports", "Business overview"]);
    expect(deskSectionTabs("money", "STAFF")).toEqual([]);
    expect(deskSectionTabs("equipment", "STAFF").map((tab) => tab.label)).toEqual(["Inventory", "Parts"]);
    expect(deskSectionTabs("equipment", "ADMIN").map((tab) => tab.label)).toEqual(
      ["Inventory", "Retired", "Recalls", "Parts", "Purchases", "Purchase orders"]);
    expect(deskSectionTabs("money", undefined)).toEqual([]);
    expect(deskSectionTabs("schedule", "CUSTOMER")).toEqual([]);
  });

  it("highlights the right tab and the right menu entry on every tab screen", () => {
    const tabs = deskSectionTabs("money", "OWNER");
    expect(activeSectionTab("/desk/reports/export", tabs)).toBe("/desk/reports");
    expect(activeSectionTab("/desk/billing/held-payments", tabs)).toBe("/desk/billing");
    expect(activeSectionTab("/desk/today", tabs)).toBeNull();
    const nav = deskNavigation("OWNER");
    for (const [entry, aliases] of Object.entries(DESK_NAV_ALIASES)) {
      for (const alias of aliases) expect(activeDeskHref(alias, nav)).toBe(entry);
    }
  });

  it("every menu entry, tab and More link opens a page that exists", () => {
    const hrefs = new Set<string>();
    for (const role of ["OWNER", "ADMIN", "STAFF"]) {
      for (const link of links(role)) hrefs.add(link.href);
      for (const link of deskMoreLinks(role)) hrefs.add(link.href);
      for (const key of Object.keys(DESK_SECTIONS)) {
        for (const tab of deskSectionTabs(key as "schedule", role)) hrefs.add(tab.href);
      }
    }
    const missing = [...hrefs].filter((href) => !routePaths.has(href));
    expect(missing).toEqual([]);
  });

  it("More lists the rarely used screens by role, and never the developer-only storage check", () => {
    expect(deskMoreLinks("OWNER").map((link) => link.label)).toEqual(
      ["Expenses", "Suppliers", "Growth signals", "Launch list", "System health", "Manage my business", "Website", "Business paperwork", "Insurance", "Privacy requests", "App feedback", "Activity", "My account"]);
    expect(deskMoreLinks("ADMIN").map((link) => link.label)).toEqual(
      ["Expenses", "Suppliers", "Growth signals", "Launch list", "System health", "Manage my business", "Website", "App feedback", "Activity", "My account"]);
    expect(deskMoreLinks("STAFF").map((link) => link.label)).toEqual(["Expenses", "Activity", "My account"]);
    expect(deskMoreLinks("CUSTOMER")).toEqual([]);
    const everything = JSON.stringify([deskNavigation("OWNER"), deskMoreLinks("OWNER"), DESK_SECTIONS]);
    expect(everything).not.toMatch(/preview-storage/);
  });

  it("uses the same names on the phone bottom bar as in the menu", () => {
    const menuLabels = new Set(links("OWNER").map((link) => link.label));
    for (const role of ["OWNER", "STAFF"]) {
      for (const tab of deskBottomTabLinks(role, deskNavigation(role))) {
        expect(menuLabels.has(tab.label)).toBe(true);
      }
    }
    expect(deskBottomTabLinks("OWNER", deskNavigation("OWNER")).map((tab) => tab.label)).toEqual(
      ["Today", "Schedule", "Customers", "Money"]);
  });
});
