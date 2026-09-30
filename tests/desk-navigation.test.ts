import { expect, it } from "vitest";
import { activeDeskHref, deskNavigation } from "@/lib/desk-navigation";
it.each(["OWNER", "ADMIN"])(
  "keeps all 23 destinations discoverable for %s",
  (role) => {
    const groups = deskNavigation(role);
    const links = groups.flatMap((g) => g.links);
    expect(links).toHaveLength(23);
    expect(new Set(links.map((l) => l.href)).size).toBe(23);
    expect(groups.find((g) => g.label === "Money")?.links).toContainEqual({
      href: "/desk/dashboard",
      label: "Business overview",
    });
  },
);
it("never serializes finance, settings or purchasing destinations to staff", () => {
  const groups = deskNavigation("STAFF");
  expect(groups.flatMap((g) => g.links)).toHaveLength(12);
  expect(JSON.stringify(groups)).not.toMatch(
    /billing|revenue|reports|dashboard|fleet|estimates|purchase-orders|suppliers|launch|\/settings|\/growth/,
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
