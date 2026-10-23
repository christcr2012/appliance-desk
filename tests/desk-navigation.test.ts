import { expect, it } from "vitest";
import { activeDeskHref, deskMoreLinks, deskNavigation } from "@/lib/desk-navigation";

it.each([
  ["OWNER", 14],
  ["ADMIN", 14],
] as const)(
  "keeps %s role-appropriate destinations discoverable with count %i",
  (role, expectedCount) => {
    const groups = deskNavigation(role);
    const links = groups.flatMap((g) => g.links);
    expect(links).toHaveLength(expectedCount);
    expect(new Set(links.map((l) => l.href)).size).toBe(expectedCount);
    expect(links).toContainEqual({ href: "/desk/communications", label: "Communications" });
    expect(groups.find((g) => g.label === "Money & taxes")?.links).toContainEqual({
      href: "/desk/billing",
      label: "Money",
    });
    expect(links).toContainEqual({ href: "/desk/dispatch", label: "Schedule" });
    expect(links).toContainEqual({ href: "/desk/more", label: "More" });
    expect(links).toContainEqual({
      href: "/desk/sales-tax", label: "Taxes",
    });
    // Privacy requests live on the More page, owner only.
    const more = deskMoreLinks(role).map((link) => link.href);
    expect(more.includes("/desk/privacy")).toBe(role === "OWNER");
    expect(more.includes("/desk/paperwork")).toBe(role === "OWNER");
    expect(more).toContain("/desk/automations");
  },
);

it("never serializes finance, settings, privacy, automations or purchasing destinations to staff", () => {
  const groups = deskNavigation("STAFF");
  expect(groups.flatMap((g) => g.links)).toHaveLength(10);
  expect(JSON.stringify(groups)).not.toMatch(
    /billing|revenue|reports|dashboard|fleet|estimates|purchase-orders|suppliers|launch|\/settings|\/privacy|\/automations|\/growth/,
  );
  expect(groups.flatMap((g) => g.links)).toContainEqual({
    href: "/desk/communications", label: "Communications",
  });
  expect(groups.flatMap((g) => g.links)).toContainEqual({
    href: "/desk/dispatch",
    label: "Schedule",
  });
});

it.each([undefined, "CUSTOMER", "anonymous"])("fails closed for %s", (role) => {
  expect(deskNavigation(role)).toEqual([]);
});

it("marks only the longest matching destination, never a similar prefix", () => {
  const groups = deskNavigation("OWNER");
  expect(activeDeskHref("/desk/customers/abc", groups)).toBe("/desk/customers");
  expect(activeDeskHref("/desk/customers-other", groups)).toBeUndefined();
  expect(activeDeskHref("/desk/tasks", groups)).toBe("/desk/tasks");
  // Screens that became tabs highlight their menu entry.
  expect(activeDeskHref("/desk/jobs/abc", groups)).toBe("/desk/dispatch");
  expect(activeDeskHref("/desk/parts", groups)).toBe("/desk/inventory");
  expect(activeDeskHref("/desk/revenue", groups)).toBe("/desk/billing");
  expect(activeDeskHref("/desk/privacy", groups)).toBe("/desk/more");
});
