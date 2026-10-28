import { describe, expect, it } from "vitest";
import { activeDeskHref, deskMoreLinks, deskNavigation } from "@/lib/desk-navigation";
import { DESK_AREAS, activeArea, visibleAreas, visibleProfileLinks } from "@/lib/desk-areas";

const hrefs = (role: string) => deskNavigation(role).flatMap(g => g.links.map(l => l.href));

describe("AR-1 five-area navigation compatibility and security", () => {
  it.each(["OWNER", "ADMIN"] as const)("%s sees five named areas and 22 tabs", role => {
    const groups = deskNavigation(role);
    expect(groups.map(g => g.label)).toEqual(["Today", "Customers", "Schedule", "Equipment", "Money"]);
    expect(groups.flatMap(g => g.links)).toHaveLength(22);
    expect(new Set(hrefs(role)).size).toBe(22);
    expect(groups.find(g => g.label === "Customers")?.links).toContainEqual({ href: "/desk/communications", label: "Messages" });
    expect(groups.find(g => g.label === "Schedule")?.links).toContainEqual({ href: "/desk/dispatch", label: "Board" });
    expect(hrefs(role)).toContain("/desk/sales-tax");
    expect(hrefs(role)).not.toContain("/desk/more");
    const profile = deskMoreLinks(role).map(l => l.href);
    expect(profile.includes("/desk/privacy")).toBe(role === "OWNER");
    expect(profile.includes("/desk/paperwork")).toBe(role === "OWNER");
    expect(profile).toContain("/desk/automations");
  });
  it("never serializes finance, settings, privacy or purchasing links for staff", () => {
    const links = hrefs("STAFF");
    expect(links).toHaveLength(12);
    for (const forbidden of [
      "/desk/billing", "/desk/revenue", "/desk/sales-tax", "/desk/leads",
      "/desk/estimates", "/desk/purchases", "/desk/suppliers", "/desk/inventory/retired",
    ]) expect(links).not.toContain(forbidden);
    expect(links).toEqual(expect.arrayContaining([
      "/desk/today", "/desk/customers", "/desk/communications", "/desk/dispatch",
      "/desk/inventory", "/desk/expenses",
    ]));
    expect(deskMoreLinks("STAFF").map(l => l.href)).toEqual(["/desk/account", "/desk/activity", "/desk/help", "/desk/feedback/new"]);
  });
  it.each([undefined, "CUSTOMER", "anonymous"] as const)("fails closed for %s", role => {
    expect(deskNavigation(role)).toEqual([]);
    expect(visibleProfileLinks(role, null)).toEqual([]);
  });
  it("resolves active tabs by longest path and query, not a similar path prefix", () => {
    const groups = deskNavigation("OWNER");
    expect(activeDeskHref("/desk/customers/abc", groups)).toBe("/desk/customers");
    expect(activeDeskHref("/desk/customers-other", groups)).toBeUndefined();
    const areas = visibleAreas("OWNER", null);
    const active = (path: string, qs = "") => activeArea(path, new URLSearchParams(qs), areas);
    expect(active("/desk/jobs/abc")).toEqual({ area: "schedule", tab: "visits" });
    expect(active("/desk/parts")).toEqual({ area: "equipment", tab: "parts" });
    expect(active("/desk/revenue")).toEqual({ area: "money", tab: "overview" });
    // AR-3: ?view=waiting redirects to /desk/payments (Payments current by href); the old URL itself is the Bills page.
    expect(active("/desk/billing", "view=waiting")).toEqual({ area: "money", tab: "bills" });
    expect(active("/desk/privacy")).toBeNull();
  });
  it("uses one source for public area metadata", () => {
    expect(DESK_AREAS.map(a => a.label)).toEqual(["Today", "Customers", "Schedule", "Equipment", "Money"]);
    expect(deskNavigation("OWNER").map(g => g.label)).toEqual(DESK_AREAS.map(a => a.label));
  });
});
