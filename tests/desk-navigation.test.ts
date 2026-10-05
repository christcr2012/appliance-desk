import { expect, it } from "vitest";
import { activeDeskHref, deskNavigation } from "@/lib/desk-navigation";

it.each([
  ["OWNER", 24],
  ["ADMIN", 23],
] as const)(
  "keeps all %i role-appropriate destinations discoverable for %s",
  (role, expectedCount) => {
    const groups = deskNavigation(role);
    const links = groups.flatMap((g) => g.links);
    expect(links).toHaveLength(expectedCount);
    expect(new Set(links.map((l) => l.href)).size).toBe(expectedCount);
    expect(groups.find((g) => g.label === "Money")?.links).toContainEqual({
      href: "/desk/dashboard",
      label: "Business overview",
    });
    if (role === "OWNER") {
      expect(links).toContainEqual({
        href: "/desk/privacy",
        label: "Privacy requests",
      });
    } else {
      expect(links).not.toContainEqual({
        href: "/desk/privacy",
        label: "Privacy requests",
      });
    }
  },
);

it("never serializes finance, settings, privacy or purchasing destinations to staff", () => {
  const groups = deskNavigation("STAFF");
  expect(groups.flatMap((g) => g.links)).toHaveLength(12);
  expect(JSON.stringify(groups)).not.toMatch(
    /billing|revenue|reports|dashboard|fleet|estimates|purchase-orders|suppliers|launch|\/settings|\/privacy|\/growth/,
  );
  expect(groups.flatMap((g) => g.links)).toContainEqual({
    href: "/desk/driver",
    label: "Driver view",
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
});
