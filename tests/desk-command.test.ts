import { describe, expect, it } from "vitest";
import { COMMAND_ACTIONS, commandLocalChoices, recentCommandChoices } from "@/lib/desk-command";
import { visibleAreas, visibleProfileLinks } from "@/lib/desk-areas";
import { FEATURE_KEYS } from "@/domains/features/registry";

const features = new Set(FEATURE_KEYS);
const choices = (query: string, role: string, screens: string[] | null = null) =>
  commandLocalChoices(query, role, screens, visibleAreas(role, screens, features),
    visibleProfileLinks(role, screens), features);

describe("AR-1 command bar choices", () => {
  it("starts with the five accessible areas and waits for two typed characters", () => {
    expect(choices("", "OWNER").map(c => c.label)).toEqual(["Today", "Customers", "Schedule", "Equipment", "Money"]);
    expect(choices("x", "OWNER")).toEqual([]);
    expect(choices("", "CUSTOMER")).toEqual([]);
  });
  it("finds synonyms and does not display finance actions to staff", () => {
    expect(choices("estimate", "OWNER").map(c => c.label)).toContain("New quote");
    expect(choices("charge", "OWNER").map(c => c.label)).toContain("Take a payment");
    expect(choices("delivery", "OWNER").map(c => c.label)).toContain("Schedule a visit");
    const staff = choices("charge", "STAFF");
    expect(staff).not.toContainEqual(expect.objectContaining({ label: "Take a payment" }));
    expect(choices("lead", "STAFF").some(c => c.href.startsWith("/desk/leads"))).toBe(false);
    expect(choices("settings", "STAFF").some(c => c.href.startsWith("/desk/settings"))).toBe(false);
    expect(COMMAND_ACTIONS.map(c => c.label)).toHaveLength(9);
  });
  it("honors job-role and feature visibility before serializing any action", () => {
    expect(choices("customer", "STAFF", ["dispatch"])).toEqual([]);
    const onlyCustomers = choices("customer", "OWNER", ["customers"]);
    expect(onlyCustomers.some(c => c.group === "Do" && c.href.startsWith("/desk/customers"))).toBe(true);
    expect(onlyCustomers.some(c => c.href.startsWith("/desk/billing"))).toBe(false);
  });
  it("never trusts a stored record link without an allowed route or shaped ID", () => {
    const allowed = new Set(["/desk/customers"]);
    expect(recentCommandChoices([
      { id: "one", label: "Sample customer", href: "/desk/customers/one" },
      { id: "two", label: "Unsafe", href: "https://example.net" },
      { id: "three", label: "Money", href: "/desk/billing/three" },
      { id: "four", label: "Escape", href: "/desk/customers-other" },
    ], allowed)).toEqual([{ group: "Recent", id: "one", label: "Sample customer", href: "/desk/customers/one" }]);
  });
});
